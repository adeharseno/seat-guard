# SeatGuard — Trial Booking Reliability

A minimal trial-booking slice for Ottodot: pick a child, pick a trial class, pay,
get confirmed — correctly, even when two parents grab the last seat at the same
moment.

## How to run

```bash
npm install
npm run seed   # wipes and reseeds seatguard.sqlite with demo data
npm run dev    # http://localhost:3000
npm test       # vitest — duplicate booking, payment failure, last-seat race
```

No external services or env vars needed. Everything runs on a local SQLite file.

### Try it manually

```bash
# See classes and seat availability
curl localhost:3000/api/classes

# Book a trial (starts as pending_payment, no seat held yet)
curl -X POST localhost:3000/api/bookings \
  -H 'content-type: application/json' \
  -d '{"studentId": 1, "classId": 2}'

# Pay (mock; omit "result" for a 90% success simulation)
curl -X POST localhost:3000/api/bookings/<id>/pay \
  -H 'content-type: application/json' \
  -d '{"result": "success"}'

# Roster (confirmed bookings only)
curl localhost:3000/api/classes/2/roster
```

## What I built

- Booking creation (`POST /api/bookings`) — a child + class, no payment yet.
- Mock payment (`POST /api/bookings/:id/pay`) — settles the booking, and is
  where the seat actually gets claimed.
- Roster (`GET /api/classes/:id/roster`) — confirmed students for a class.
- Class listing (`GET /api/classes`) — seats available per class.
- No regular-enrollment flow, no real payment gateway, no auth — out of scope
  per the brief.

## Time spent

~4 hours, in a few sessions.

## Assumptions

- A trial class always caps at 4 confirmed students (`capacity` is a column,
  not hardcoded, in case that changes later).
- "Duplicate booking" means the same child confirmed twice for the same
  class — a child can have multiple *past* `payment_failed`/`failed_no_seat`
  attempts on a class and try again; only a `confirmed` row blocks a repeat.
- Payment is mocked. A booking only ever reaches `confirmed` after the mock
  payment call returns and a seat is actually available.
- One booking system process talking to one SQLite file. If this became a
  multi-instance deployment, SQLite would need to move to Postgres, but the
  same atomic-`UPDATE` pattern (see below) still works there — it doesn't
  depend on being single-process.

## Backend / design

### Data model

```
parents(id, name)
students(id, parent_id, name)
trial_classes(id, subject, starts_at, capacity, seats_taken)
bookings(id, student_id, class_id, status, created_at)
payment_attempts(id, booking_id, result, created_at)
```

`bookings.status` is one of: `pending_payment`, `confirmed`, `payment_failed`,
`failed_no_seat`, `cancelled`.

I split `payment_failed` (the mock payment itself was declined) from
`failed_no_seat` (payment succeeded, but the seat was gone by the time it
settled — the last-seat race loser) instead of collapsing both into one
status. They have different real-world follow-ups: the first tells the parent
to retry payment, the second means a refund and "sorry, that class filled up."

### Key endpoints

| Endpoint | Purpose |
|---|---|
| `GET /api/classes` | list classes with `seats_available` |
| `GET /api/classes/:id/roster` | confirmed students for a class |
| `POST /api/bookings` | create a `pending_payment` booking |
| `POST /api/bookings/:id/pay` | mock payment; confirms or fails the booking |

### Preventing duplicate confirmed bookings

A partial unique index is the actual guarantee:

```sql
CREATE UNIQUE INDEX idx_no_duplicate_confirmed
  ON bookings(student_id, class_id)
  WHERE status = 'confirmed';
```

The API also checks for an existing confirmed booking before creating a new
one, but that's just a friendlier error message — the index is what makes it
impossible even if two requests race past that check.

### Preventing overbooking / the last-seat race

This was the actual design problem, so — the approach I chose:

**Don't reserve a seat when a booking is created. Claim it atomically only
when payment succeeds, as one SQL statement:**

```sql
UPDATE trial_classes
SET seats_taken = seats_taken + 1
WHERE id = ? AND seats_taken < capacity
```

If this updates 0 rows, the class was already full — the booking becomes
`failed_no_seat` instead of `confirmed`. This runs inside the same DB
transaction as the status update, so there's no window between "check seats"
and "write booking" for another request to sneak into.

**Why this approach over alternatives:**
- *Counting confirmed bookings, then inserting if under capacity* — the
  classic bug. Two requests can both pass the count check before either
  writes, and both confirm. I didn't use this.
- *App-level locking (mutex/semaphore per class)* — works, but only within a
  single process, and adds a moving part (lock acquisition, timeouts, cleanup
  on crash) that this problem doesn't need.
- *Optimistic locking with a version column + retry* — also correct, but
  requires a retry loop for the loser, which adds complexity for no benefit
  here: the loser's booking *should* fail, not retry into a full class.

The one-`UPDATE`-with-a-`WHERE` approach needs no app-level coordination —
correctness comes from the database's own row-level write serialization, so
it holds even across multiple server instances hitting the same DB (unlike
an in-process mutex).

**Trade-off accepted:** a seat is only claimed at payment time, not at
booking time. That means a parent can spend time on the payment screen for a
class that fills up under them, and their card may be charged for a seat
that's gone (`failed_no_seat`) — in a real system, this state requires an
automatic refund. I accepted this because *soft-holding* a seat at booking
time (reserve it, expire the hold after N minutes) is the safer UX but adds
a background expiry job and a second kind of race (the hold itself); out of
scope for a 4-hour slice, noted below.

### Payment failure

`payment_failed` is set before any seat is touched — `claimSeat()` is only
called after a successful mock payment result, inside the same transaction.
So a declined payment can never leave a child on the roster.

### Which checks live where

- **UI** (not built here, but this is the intended split): show
  `seats_available` for fast feedback, disable the button at 0. Never
  authoritative — just avoids an obviously-doomed attempt.
- **Backend (API route)**: input validation, the friendly duplicate-booking
  pre-check, and the status-transition guard (`pending_payment` only before
  paying).
- **Database**: the actual invariants — the partial unique index for
  duplicates, the `CHECK` constraint on `status`, and the atomic `UPDATE`
  for capacity. These are the only checks that hold under concurrency.
- **Background job**: none needed for this slice, and that's a direct
  consequence of not soft-holding seats — there's nothing pending to expire.
  If soft-holds were added, an expiry job would be needed too (see below).

## What I deliberately cut

- Real payment gateway (Stripe, etc.) — mocked with a forced or random
  result.
- Auth / sessions — student and class IDs are passed directly.
- Soft-hold-then-expire seat reservation at booking time.
- Cancellation flow (there's a `releaseSeat()` helper in `lib/db.ts`, unused
  by any route — wiring it up is small but out of scope here).
- Any UI beyond curl/API responses.

## What I'd monitor after release

- Rate of `failed_no_seat` outcomes — a proxy for how often parents complete
  payment for a class that's already gone, i.e. how much refund/support load
  this design creates. High rate → worth adding the soft-hold.
- Rate of `payment_failed` vs `confirmed` — payment provider health.
- Any `pending_payment` bookings that never resolve (abandoned checkouts) —
  currently nothing expires them; worth tracking how many pile up.

## What I'd do next with more time

- Soft-hold a seat for a short window (e.g. 5 minutes) once payment starts,
  with a background job to release expired holds — trades a small amount of
  complexity for a better parent experience on the last seat.
- Wire up `cancelled` + `releaseSeat()` as a real endpoint.
- A minimal UI (booking form + admin roster view).
- Idempotency keys on `POST /api/bookings/:id/pay` so a client retry after a
  dropped response can't double-charge.
