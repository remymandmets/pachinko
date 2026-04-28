import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";
import { db } from "./db";
import { users } from "@shared/schema";
import { eq } from "drizzle-orm";

const BCRYPT_COST = 10;
const JWT_COOKIE_NAME = "onnekuul_session";
const JWT_TTL_DAYS = 30;
const JWT_TTL_SECONDS = JWT_TTL_DAYS * 24 * 60 * 60;

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (secret && secret.length >= 16) return secret;
  // Fallback for dev: deterministic per DATABASE_URL so sessions survive restarts.
  // In production we expect JWT_SECRET to be set explicitly.
  return `dev-secret-${process.env.DATABASE_URL || "default"}`;
}

export function normalizePhone(input: string): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim().replace(/\s+/g, "");
  if (!trimmed) return null;
  // +372xxxxxxxx form
  const intl = trimmed.match(/^\+372(\d{7,8})$/);
  if (intl) return `+372${intl[1]}`;
  // 372xxxxxxxx form
  const noplus = trimmed.match(/^372(\d{7,8})$/);
  if (noplus) return `+372${noplus[1]}`;
  // Local 5xxxxxxx form (Estonian mobile)
  const local = trimmed.match(/^(5\d{6,7})$/);
  if (local) return `+372${local[1]}`;
  return null;
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_COST);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

interface SessionPayload {
  uid: number;
  isAdmin: boolean;
}

export function signSessionToken(payload: SessionPayload): string {
  return jwt.sign(payload, getJwtSecret(), { expiresIn: JWT_TTL_SECONDS });
}

export function verifySessionToken(token: string): SessionPayload | null {
  try {
    const decoded = jwt.verify(token, getJwtSecret()) as any;
    if (typeof decoded?.uid !== "number") return null;
    return { uid: decoded.uid, isAdmin: !!decoded.isAdmin };
  } catch {
    return null;
  }
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(JWT_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: JWT_TTL_SECONDS * 1000,
    path: "/",
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(JWT_COOKIE_NAME, { path: "/" });
}

export function readSessionCookie(req: Request): string | null {
  const raw = (req as any).cookies?.[JWT_COOKIE_NAME];
  return typeof raw === "string" ? raw : null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      authUser?: { id: number; isAdmin: boolean; phone: string };
    }
  }
}

async function loadAuthUser(req: Request): Promise<{ id: number; isAdmin: boolean; phone: string } | null> {
  const token = readSessionCookie(req);
  if (!token) return null;
  const payload = verifySessionToken(token);
  if (!payload) return null;
  const rows = await db.select().from(users).where(eq(users.id, payload.uid)).limit(1);
  const user = rows[0];
  if (!user) return null;
  return { id: user.id, isAdmin: user.isAdmin, phone: user.phone };
}

export async function attachAuthUser(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const u = await loadAuthUser(req);
  if (u) req.authUser = u;
  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.authUser) {
    res.status(401).json({ error: "Sisselogimine vajalik" });
    return;
  }
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.authUser) {
    res.status(401).json({ error: "Sisselogimine vajalik" });
    return;
  }
  if (!req.authUser.isAdmin) {
    res.status(403).json({ error: "Admin-õigused vajalikud" });
    return;
  }
  next();
}

export const SESSION_COOKIE_NAME = JWT_COOKIE_NAME;
