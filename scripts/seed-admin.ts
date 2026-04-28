import "dotenv/config";
import { db, pool } from "../server/db";
import { users } from "../shared/schema";
import { eq } from "drizzle-orm";
import { hashPassword, normalizePhone } from "../server/auth";

const ADMIN_PHONE_RAW = process.env.SEED_ADMIN_PHONE || "56987052";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || "037";

async function main() {
  const phone = normalizePhone(ADMIN_PHONE_RAW);
  if (!phone) {
    throw new Error(`Vigane telefoninumber: ${ADMIN_PHONE_RAW}`);
  }

  const existing = await db.select().from(users).where(eq(users.phone, phone)).limit(1);
  if (existing[0]) {
    console.log(`Admin (${phone}) on juba olemas (id=${existing[0].id}, isAdmin=${existing[0].isAdmin}).`);
    if (!existing[0].isAdmin) {
      await db.update(users).set({ isAdmin: true }).where(eq(users.id, existing[0].id));
      console.log("Admin-lipp seatud TRUE-ks.");
    }
    return;
  }

  const passwordHash = await hashPassword(ADMIN_PASSWORD);
  const inserted = await db
    .insert(users)
    .values({ phone, passwordHash, isAdmin: true })
    .returning();
  console.log(`Admin loodud: id=${inserted[0].id}, phone=${phone}`);
  console.log(`Parool: ${ADMIN_PASSWORD}`);
}

main()
  .catch((err) => {
    console.error("Seed-admin ebaõnnestus:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
