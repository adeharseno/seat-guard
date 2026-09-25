import { NextResponse } from "next/server";
import { db } from "@/lib/db";

// Creates a booking in 'pending_payment'. No seat is reserved yet --
// seats are only ever claimed atomically at payment time (see pay/route.ts).
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const studentId = Number(body?.studentId);
  const classId = Number(body?.classId);

  if (!studentId || !classId) {
    return NextResponse.json(
      { error: "studentId and classId are required" },
      { status: 400 }
    );
  }

  const student = db.prepare(`SELECT id FROM students WHERE id = ?`).get(studentId);
  if (!student) {
    return NextResponse.json({ error: "student not found" }, { status: 404 });
  }

  const cls = db.prepare(`SELECT id FROM trial_classes WHERE id = ?`).get(classId);
  if (!cls) {
    return NextResponse.json({ error: "class not found" }, { status: 404 });
  }

  // Friendly pre-check for the common case. The real, race-proof guarantee
  // against duplicate confirmed bookings is the unique index in lib/db.ts --
  // this check just avoids letting a parent walk through payment pointlessly.
  const existingConfirmed = db
    .prepare(
      `SELECT id FROM bookings WHERE student_id = ? AND class_id = ? AND status = 'confirmed'`
    )
    .get(studentId, classId);

  if (existingConfirmed) {
    return NextResponse.json(
      {
        error: "duplicate_booking",
        message: "This child already has a confirmed booking for this class.",
      },
      { status: 409 }
    );
  }

  const result = db
    .prepare(
      `INSERT INTO bookings (student_id, class_id, status) VALUES (?, ?, 'pending_payment')`
    )
    .run(studentId, classId);

  return NextResponse.json(
    { bookingId: result.lastInsertRowid, status: "pending_payment" },
    { status: 201 }
  );
}
