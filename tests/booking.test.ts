import { describe, it, expect, beforeEach } from "vitest";
import { resetDb, jsonRequest, type Fixtures } from "./helpers";

import { GET as listClasses } from "@/app/api/classes/route";
import { GET as getRoster } from "@/app/api/classes/[id]/roster/route";
import { POST as createBooking } from "@/app/api/bookings/route";
import { POST as payBooking } from "@/app/api/bookings/[id]/pay/route";

let fx: Fixtures;

beforeEach(() => {
  fx = resetDb();
});

describe("GET /api/classes", () => {
  it("reports correct seats_available for an open and an almost-full class", async () => {
    const res = await listClasses();
    const body = await res.json();

    const open = body.classes.find((c: any) => c.id === fx.openClass);
    const almostFull = body.classes.find((c: any) => c.id === fx.almostFullClass);

    expect(open.seats_available).toBe(4);
    expect(almostFull.seats_taken).toBe(3);
    expect(almostFull.seats_available).toBe(1);
  });
});

describe("GET /api/classes/:id/roster", () => {
  it("lists exactly the 3 confirmed students for the almost-full class", async () => {
    const res = await getRoster(new Request("http://localhost"), {
      params: { id: String(fx.almostFullClass) },
    });
    const body = await res.json();

    expect(body.roster).toHaveLength(3);
    expect(body.roster.map((r: any) => r.student_name).sort()).toEqual([
      "Ben",
      "Cathy",
      "Dio",
    ]);
  });
});

describe("duplicate confirmed booking", () => {
  it("rejects a second booking for the same child + class once confirmed", async () => {
    // Ben is already confirmed on almostFullClass via fixtures.
    const res = await createBooking(
      jsonRequest("http://localhost/api/bookings", {
        studentId: fx.ben,
        classId: fx.almostFullClass,
      })
    );
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toBe("duplicate_booking");
  });

  it("still allows a new booking for a child with no confirmed booking yet", async () => {
    const res = await createBooking(
      jsonRequest("http://localhost/api/bookings", {
        studentId: fx.alice,
        classId: fx.openClass,
      })
    );
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.status).toBe("pending_payment");
  });
});

describe("payment failure", () => {
  it("marks the booking payment_failed and never claims a seat", async () => {
    const created = await createBooking(
      jsonRequest("http://localhost/api/bookings", {
        studentId: fx.alice,
        classId: fx.openClass,
      })
    );
    const { bookingId } = await created.json();

    const paid = await payBooking(
      jsonRequest(`http://localhost/api/bookings/${bookingId}/pay`, {
        result: "failure",
      }),
      { params: { id: String(bookingId) } }
    );
    const paidBody = await paid.json();

    expect(paidBody.status).toBe("payment_failed");

    const rosterRes = await getRoster(new Request("http://localhost"), {
      params: { id: String(fx.openClass) },
    });
    const roster = (await rosterRes.json()).roster;
    expect(roster.find((r: any) => r.student_id === fx.alice)).toBeUndefined();
  });

  it("rejects paying a booking that isn't pending_payment", async () => {
    const created = await createBooking(
      jsonRequest("http://localhost/api/bookings", {
        studentId: fx.alice,
        classId: fx.openClass,
      })
    );
    const { bookingId } = await created.json();

    await payBooking(
      jsonRequest(`http://localhost/api/bookings/${bookingId}/pay`, {
        result: "success",
      }),
      { params: { id: String(bookingId) } }
    );

    // Paying again on an already-settled booking must be rejected, not re-processed.
    const secondPay = await payBooking(
      jsonRequest(`http://localhost/api/bookings/${bookingId}/pay`, {
        result: "success",
      }),
      { params: { id: String(bookingId) } }
    );
    expect(secondPay.status).toBe(409);
  });
});

describe("last-seat race", () => {
  it("confirms exactly one of two simultaneous payments for the last seat", async () => {
    // almostFullClass has exactly 1 seat left. Two different children both
    // book it, then both "pay" at the same time.
    const bookingA = await (
      await createBooking(
        jsonRequest("http://localhost/api/bookings", {
          studentId: fx.alice,
          classId: fx.almostFullClass,
        })
      )
    ).json();
    const bookingB = await (
      await createBooking(
        jsonRequest("http://localhost/api/bookings", {
          studentId: fx.eka,
          classId: fx.almostFullClass,
        })
      )
    ).json();

    // Promise.all fires both handlers before either awaits past its first
    // microtask, exercising the same interleaving a real race would hit.
    // The atomic UPDATE...WHERE seats_taken < capacity in claimSeat is what
    // actually prevents both from winning -- not test ordering.
    const [resA, resB] = await Promise.all([
      payBooking(
        jsonRequest(`http://localhost/api/bookings/${bookingA.bookingId}/pay`, {
          result: "success",
        }),
        { params: { id: String(bookingA.bookingId) } }
      ),
      payBooking(
        jsonRequest(`http://localhost/api/bookings/${bookingB.bookingId}/pay`, {
          result: "success",
        }),
        { params: { id: String(bookingB.bookingId) } }
      ),
    ]);

    const [bodyA, bodyB] = await Promise.all([resA.json(), resB.json()]);
    const statuses = [bodyA.status, bodyB.status].sort();

    // Exactly one confirmed, one lost the race.
    expect(statuses).toEqual(["confirmed", "failed_no_seat"]);

    const rosterRes = await getRoster(new Request("http://localhost"), {
      params: { id: String(fx.almostFullClass) },
    });
    const roster = (await rosterRes.json()).roster;

    // Never more than capacity, even though two payments were "simultaneous".
    expect(roster).toHaveLength(4);
  });
});
