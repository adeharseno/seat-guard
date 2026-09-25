# AI Usage

## Tools

Claude (Anthropic), used through a chat/coding session — planning, writing
code, running it in a sandboxed environment, and iterating on it.

## What I used it for

- Working through the last-seat race options (count-then-insert vs
  app-level locking vs atomic `UPDATE ... WHERE`) and picking one.
- Writing the schema, seed data, API routes, and vitest suite.
- Actually running the server and firing concurrent requests at it to check
  the race handling, instead of just reasoning about it on paper.
- Drafting this README/AI_USAGE structure.

## Where it moved me faster

Getting an actually-running concurrent test for the race condition, not
just a unit test that calls a function twice. The AI ran the dev server in
the sandbox, fired two `curl` payment requests in parallel with backgrounded
processes, and showed me the real output (one `confirmed`, one
`failed_no_seat`, roster capped at 4) before I ever touched a terminal
myself. Writing that kind of process-orchestration test harness by hand
would have eaten a good chunk of the timebox.

## Where I pushed back / changed something

The route handler defaults the mock payment to succeed ~90% of the time
(`Math.random() < 0.9`) when no result is forced. That's fine for a demo,
but I didn't want the automated test suite depending on randomness — a
flaky test that fails 1-in-10 runs is worse than no test. So every test
explicitly passes `{"result": "success"}` or `{"result": "failure"}` to
force the outcome, and the randomness only kicks in for manual/demo calls
that omit it. I made sure that override path existed and used it
everywhere in `tests/booking.test.ts` rather than trusting the default.

## What I'd change about the workflow next time

Ask for the concurrent-request test *before* asking for the route logic,
not after — writing the test first would have caught the exact
interleaving I cared about (both payments hitting `claimSeat` before either
one's transaction commits) earlier, instead of writing the implementation
and then working backward to a test that exercises it.

## How I verified it

- Ran the actual dev server and hit every endpoint with `curl`: listing
  classes, booking, paying (forced success and forced failure), and
  reading the roster back.
- Reseeded and reran the concurrent last-seat scenario against a clean
  database to confirm the result wasn't an artifact of leftover state from
  an earlier manual test.
- `npm test` — 7 vitest cases covering duplicate booking (rejected and
  allowed), payment failure, re-paying an already-settled booking, and the
  concurrent last-seat race — all passing.
- Read every generated file before accepting it, in particular the
  transaction boundaries in `pay/route.ts`, since that's the one place a
  subtle bug would matter most.
