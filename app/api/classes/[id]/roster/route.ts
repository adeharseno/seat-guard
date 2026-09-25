import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const classId = Number(params.id);

  const cls = db
    .prepare(
      `SELECT id, subject, starts_at, capacity, seats_taken FROM trial_classes WHERE id = ?`
    )
    .get(classId);

  if (!cls) {
    return NextResponse.json({ error: "class not found" }, { status: 404 });
  }

  // Roster = confirmed bookings only. pending/failed bookings never appear here,
  // which is the actual guarantee the assignment cares about.
  const roster = db
    .prepare(
      `SELECT b.id AS booking_id, s.id AS student_id, s.name AS student_name, b.created_at
       FROM bookings b
       JOIN students s ON s.id = b.student_id
       WHERE b.class_id = ? AND b.status = 'confirmed'
       ORDER BY b.created_at ASC`
    )
    .all(classId);

  return NextResponse.json({ class: cls, roster });
}
