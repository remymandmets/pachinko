import { db } from "./db";
import { sql } from "drizzle-orm";
import { users } from "@shared/schema";
import { eq } from "drizzle-orm";
import { hashPassword, normalizePhone } from "./auth";

const BOOTSTRAP_ADMIN_PHONE_RAW = "56987052";
const BOOTSTRAP_ADMIN_PASSWORD = "037";

export async function runStartupMigrations(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS onnekuul_users (
      id SERIAL PRIMARY KEY,
      phone VARCHAR(32) UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      age INTEGER,
      parcel_locker TEXT,
      is_admin BOOLEAN DEFAULT FALSE NOT NULL,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL,
      last_login_at TIMESTAMP,
      total_games_played INTEGER DEFAULT 0 NOT NULL
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS onnekuul_auth_logs (
      id SERIAL PRIMARY KEY,
      user_id INTEGER,
      phone VARCHAR(32),
      event VARCHAR(32) NOT NULL,
      ip VARCHAR(64),
      created_at TIMESTAMP DEFAULT NOW() NOT NULL
    )
  `);
}

export async function bootstrapAdminIfMissing(): Promise<void> {
  const phone = normalizePhone(BOOTSTRAP_ADMIN_PHONE_RAW);
  if (!phone) return;
  const existing = await db.select().from(users).where(eq(users.phone, phone)).limit(1);
  if (existing[0]) {
    if (!existing[0].isAdmin) {
      await db.update(users).set({ isAdmin: true }).where(eq(users.id, existing[0].id));
    }
    return;
  }
  const passwordHash = await hashPassword(BOOTSTRAP_ADMIN_PASSWORD);
  await db.insert(users).values({ phone, passwordHash, isAdmin: true });
  console.log(`[init] bootstrap admin created: ${phone}`);
}
