import { NextResponse } from "next/server";
import { db, claimSeat } from "@/lib/db";

type Booking = {
  id: number;
  student_id: number;
  class_id: number;
  status: string;
};

// Mock payment + confirm, done as one DB transaction so the seat-claim and
// the status flip are atomic together.
export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  const bookingId = Number(params.id);
  const body = await req.json().catch(() => ({}));
  // Optional override for demos/tests: { "result": "success" | "failure" }.
  // With no override, payment succeeds 90% of the time.
  const forced = body?.result as "success" | "failure" | undefined;

  const booking = db
    .prepare(`SELECT id, student_id, class_id, status FROM bookings WHERE id = ?`)
    .get(bookingId) as Booking | undefined;

  if (!booking) {
    return NextResponse.json({ error: "booking not found" }, { status: 404 });
  }

  // Guards re-paying an already-settled booking (double-submit, refresh, etc).
  if (booking.status !== "pending_payment") {
    return NextResponse.json(
      {
        error: "invalid_state",
        message: `Booking is already '${booking.status}', cannot pay again.`,
      },
      { status: 409 }
    );
  }

  const paymentSucceeded = forced ? forced === "success" : Math.random() < 0.9;

  const outcome = db.transaction(() => {
    if (!paymentSucceeded) {
      db.prepare(`UPDATE bookings SET status = 'payment_failed' WHERE id = ?`).run(
        bookingId
      );
      db.prepare(
        `INSERT INTO payment_attempts (booking_id, result) VALUES (?, 'failure')`
      ).run(bookingId);
      return { status: "payment_failed", reason: "payment_declined" };
    }

    // Payment cleared. The seat is only claimed now, atomically:
    // claimSeat does UPDATE ... WHERE seats_taken < capacity in one statement,
    // so if another request already took the last seat, this returns false
    // and no partial/duplicate confirmation can happen.
    const seatClaimed = claimSeat(booking.class_id);

    if (!seatClaimed) {
      db.prepare(
        `UPDATE bookings SET status = 'failed_no_seat' WHERE id = ?`
      ).run(bookingId);
      db.prepare(
        `INSERT INTO payment_attempts (booking_id, result) VALUES (?, 'success')`
      ).run(bookingId);
      // Payment gateway would be refunded here in a real integration.
      return { status: "failed_no_seat", reason: "class_full" };
    }

    db.prepare(`UPDATE bookings SET status = 'confirmed' WHERE id = ?`).run(
      bookingId
    );
    db.prepare(
      `INSERT INTO payment_attempts (booking_id, result) VALUES (?, 'success')`
    ).run(bookingId);
    return { status: "confirmed" };
  })();

  return NextResponse.json({ bookingId, ...outcome });
}
