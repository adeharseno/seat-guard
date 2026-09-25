import { db } from "@/lib/db";

export type Fixtures = {
  parentId: number;
  alice: number;
  ben: number;
  cathy: number;
  dio: number;
  eka: number;
  openClass: number; // 0/4 confirmed
  almostFullClass: number; // 3/4 confirmed, 1 seat left
};

/**
 * Wipes and reseeds the test database with a small, known fixture set,
 * mirroring the required edge cases: a class with open seats, a class
 * with exactly 3 confirmed students, and students available for
 * duplicate-booking / payment-failure tests.
 */
export function resetDb(): Fixtures {
  db.exec(`
    DELETE FROM payment_attempts;
    DELETE FROM bookings;
    DELETE FROM trial_classes;
    DELETE FROM students;
    DELETE FROM parents;
  `);

  const parentId = db
    .prepare(`INSERT INTO parents (name) VALUES ('Test Parent')`)
    .run().lastInsertRowid as number;

  const makeStudent = (name: string) =>
    db
      .prepare(`INSERT INTO students (parent_id, name) VALUES (?, ?)`)
      .run(parentId, name).lastInsertRowid as number;

  const alice = makeStudent("Alice");
  const ben = makeStudent("Ben");
  const cathy = makeStudent("Cathy");
  const dio = makeStudent("Dio");
  const eka = makeStudent("Eka");

  const openClass = db
    .prepare(
      `INSERT INTO trial_classes (subject, starts_at, capacity, seats_taken) VALUES ('Science', '2026-10-01T09:00:00Z', 4, 0)`
    )
    .run().lastInsertRowid as number;

  const almostFullClass = db
    .prepare(
      `INSERT INTO trial_classes (subject, starts_at, capacity, seats_taken) VALUES ('Math', '2026-10-02T09:00:00Z', 4, 3)`
    )
    .run().lastInsertRowid as number;

  for (const studentId of [ben, cathy, dio]) {
    const bookingId = db
      .prepare(
        `INSERT INTO bookings (student_id, class_id, status) VALUES (?, ?, 'confirmed')`
      )
      .run(studentId, almostFullClass).lastInsertRowid as number;
    db.prepare(
      `INSERT INTO payment_attempts (booking_id, result) VALUES (?, 'success')`
    ).run(bookingId);
  }

  return { parentId, alice, ben, cathy, dio, eka, openClass, almostFullClass };
}

export function jsonRequest(url: string, body?: unknown, method = "POST") {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}
