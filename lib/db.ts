import Database from "better-sqlite3";
import path from "path";

const DB_PATH = path.join(process.cwd(), "seatguard.sqlite");

export const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// Schema is created idempotently so `import { db }` is safe to call
// from the seed script, API routes, or tests without a separate migration step.
db.exec(`
  CREATE TABLE IF NOT EXISTS parents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS students (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    parent_id INTEGER NOT NULL REFERENCES parents(id),
    name TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS trial_classes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subject TEXT NOT NULL,
    starts_at TEXT NOT NULL,
    capacity INTEGER NOT NULL DEFAULT 4,
    seats_taken INTEGER NOT NULL DEFAULT 0
  );

  -- status: 'payment_failed' means the mock payment itself was declined.
  -- 'failed_no_seat' means payment succeeded but the seat was gone by the
  -- time it settled (the last-seat race loser) -- kept distinct so the
  -- roster/README can show *why* a booking didn't confirm.
  CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER NOT NULL REFERENCES students(id),
    class_id INTEGER NOT NULL REFERENCES trial_classes(id),
    status TEXT NOT NULL CHECK (status IN ('pending_payment','confirmed','payment_failed','failed_no_seat','cancelled')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- The single source of truth for "no duplicate confirmed booking":
  -- a partial unique index, enforced by SQLite itself, not app code.
  CREATE UNIQUE INDEX IF NOT EXISTS idx_no_duplicate_confirmed
    ON bookings(student_id, class_id)
    WHERE status = 'confirmed';

  CREATE TABLE IF NOT EXISTS payment_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    booking_id INTEGER NOT NULL REFERENCES bookings(id),
    result TEXT NOT NULL CHECK (result IN ('success','failure')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

/**
 * Atomically claims one seat on a class. Returns true if a seat was claimed,
 * false if the class was already full. This single UPDATE is what makes the
 * last-seat race safe: SQLite serializes writes to a row, so if two requests
 * race for the last seat, only one UPDATE can see seats_taken < capacity.
 */
export function claimSeat(classId: number): boolean {
  const result = db
    .prepare(
      `UPDATE trial_classes
       SET seats_taken = seats_taken + 1
       WHERE id = ? AND seats_taken < capacity`
    )
    .run(classId);
  return result.changes === 1;
}

/** Releases a seat, e.g. when a confirmed booking is later cancelled. */
export function releaseSeat(classId: number): void {
  db.prepare(
    `UPDATE trial_classes
     SET seats_taken = MAX(seats_taken - 1, 0)
     WHERE id = ?`
  ).run(classId);
}
