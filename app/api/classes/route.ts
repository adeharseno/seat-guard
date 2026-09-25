import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET() {
  const classes = db
    .prepare(
      `SELECT id, subject, starts_at, capacity, seats_taken,
              (capacity - seats_taken) AS seats_available
       FROM trial_classes
       ORDER BY starts_at`
    )
    .all();

  return NextResponse.json({ classes });
}
