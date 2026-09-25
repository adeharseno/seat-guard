import path from "path";
import fs from "fs";

const TEST_DB = path.join(process.cwd(), "tests", "test.sqlite");

// Must run before any `import { db } from "@/lib/db"` anywhere in the
// test tree, since db.ts reads this env var at module load time.
for (const suffix of ["", "-wal", "-shm"]) {
  const f = TEST_DB + suffix;
  if (fs.existsSync(f)) fs.unlinkSync(f);
}
process.env.SEATGUARD_DB_PATH = TEST_DB;
