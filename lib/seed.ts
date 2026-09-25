import { db } from "./db";

// Wipe existing data so the seed is repeatable.
db.exec(`
  DELETE FROM payment_attempts;
  DELETE FROM bookings;
  DELETE FROM trial_classes;
  DELETE FROM students;
  DELETE FROM parents;
`);

const insertParent = db.prepare(`INSERT INTO parents (name) VALUES (?)`);
const insertStudent = db.prepare(
  `INSERT INTO students (parent_id, name) VALUES (?, ?)`
);
const insertClass = db.prepare(
  `INSERT INTO trial_classes (subject, starts_at, capacity, seats_taken) VALUES (?, ?, ?, ?)`
);
const insertBooking = db.prepare(
  `INSERT INTO bookings (student_id, class_id, status) VALUES (?, ?, ?)`
);
const insertPayment = db.prepare(
  `INSERT INTO payment_attempts (booking_id, result) VALUES (?, ?)`
);

// -- Parents & students --
const parent1 = insertParent.run("Siti Rahayu").lastInsertRowid as number;
const parent2 = insertParent.run("Budi Santoso").lastInsertRowid as number;

const alice = insertStudent.run(parent1, "Alice").lastInsertRowid as number;
const ben = insertStudent.run(parent2, "Ben").lastInsertRowid as number;
const cathy = insertStudent.run(parent1, "Cathy").lastInsertRowid as number;
const dio = insertStudent.run(parent2, "Dio").lastInsertRowid as number;
const eka = insertStudent.run(parent2, "Eka").lastInsertRowid as number;

// -- Class A: open seats (0/4 confirmed) --
const classOpen = insertClass.run(
  "Intro to Science",
  "2026-10-01T09:00:00Z",
  4,
  0
).lastInsertRowid as number;

// Alice already has a confirmed booking here, to test the duplicate-booking case.
const aliceBooking = insertBooking.run(alice, classOpen, "confirmed")
  .lastInsertRowid as number;
insertPayment.run(aliceBooking, "success");
db.prepare(
  `UPDATE trial_classes SET seats_taken = seats_taken + 1 WHERE id = ?`
).run(classOpen);

// -- Class B: exactly 3/4 confirmed, one seat left --
const classAlmostFull = insertClass.run(
  "Intro to Math",
  "2026-10-02T09:00:00Z",
  4,
  0
).lastInsertRowid as number;

for (const studentId of [ben, cathy, dio]) {
  const bookingId = insertBooking.run(studentId, classAlmostFull, "confirmed")
    .lastInsertRowid as number;
  insertPayment.run(bookingId, "success");
}
db.prepare(`UPDATE trial_classes SET seats_taken = 3 WHERE id = ?`).run(
  classAlmostFull
);

// -- Payment failure case: Eka's payment failed, so no seat was claimed --
const ekaBooking = insertBooking.run(eka, classOpen, "payment_failed")
  .lastInsertRowid as number;
insertPayment.run(ekaBooking, "failure");

console.log("Seed complete:");
console.log(`  Class "Intro to Science" (id=${classOpen}): 1/4 confirmed, open seats`);
console.log(`  Class "Intro to Math" (id=${classAlmostFull}): 3/4 confirmed, 1 seat left`);
console.log(`  Duplicate-booking test target: student Alice (id=${alice}) + class ${classOpen}`);
console.log(`  Payment-failure example: booking id=${ekaBooking} (status=payment_failed, no seat claimed)`);
