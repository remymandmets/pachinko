import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import express from "express";
import { storage } from "./storage";
import { db } from "./db";
import { users, authLogs, userSlotPlays } from "@shared/schema";
import { and, eq, desc, sql } from "drizzle-orm";
import {
  normalizePhone,
  verifyPassword,
  hashPassword,
  signSessionToken,
  setSessionCookie,
  clearSessionCookie,
  requireAdmin,
  requireAuth,
} from "./auth";
import {
  PER_SLOT,
  SLOTS,
  type Remaining,
  type ServerSlotId,
  freshRemaining,
  getActiveSlot,
  todayKey,
} from "./gameSlots";

async function loadRemaining(userId: number, date: string): Promise<Remaining> {
  const rows = await db
    .select()
    .from(userSlotPlays)
    .where(and(eq(userSlotPlays.userId, userId), eq(userSlotPlays.date, date)));
  const remaining = freshRemaining();
  for (const r of rows) {
    if (
      r.slotId === "morning" ||
      r.slotId === "afternoon" ||
      r.slotId === "evening"
    ) {
      const slotId = r.slotId as ServerSlotId;
      remaining[slotId] = Math.max(0, PER_SLOT - r.played);
    }
  }
  return remaining;
}

function clientIp(req: Request): string {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.length > 0) return fwd.split(",")[0].trim();
  return req.ip || req.socket.remoteAddress || "";
}

export async function registerRoutes(app: Express): Promise<Server> {
  // Auth: login
  app.post("/api/auth/login", async (req: Request, res: Response) => {
    try {
      const phoneRaw = String(req.body?.phone ?? "");
      const password = String(req.body?.password ?? "");
      const phone = normalizePhone(phoneRaw);
      if (!phone || password.length === 0) {
        await db.insert(authLogs).values({
          phone: phoneRaw.slice(0, 32) || null,
          event: "login_failed",
          ip: clientIp(req).slice(0, 64),
        });
        return res.status(400).json({ error: "Vigane telefoninumber või parool" });
      }

      const rows = await db.select().from(users).where(eq(users.phone, phone)).limit(1);
      const user = rows[0];
      if (!user) {
        await db.insert(authLogs).values({
          phone,
          event: "login_failed",
          ip: clientIp(req).slice(0, 64),
        });
        return res.status(401).json({ error: "Vigane telefoninumber või parool" });
      }

      const ok = await verifyPassword(password, user.passwordHash);
      if (!ok) {
        await db.insert(authLogs).values({
          userId: user.id,
          phone,
          event: "login_failed",
          ip: clientIp(req).slice(0, 64),
        });
        return res.status(401).json({ error: "Vigane telefoninumber või parool" });
      }

      const token = signSessionToken({ uid: user.id, isAdmin: user.isAdmin });
      setSessionCookie(res, token);
      await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
      await db.insert(authLogs).values({
        userId: user.id,
        phone,
        event: "login",
        ip: clientIp(req).slice(0, 64),
      });

      return res.json({
        user: {
          id: user.id,
          phone: user.phone,
          isAdmin: user.isAdmin,
        },
      });
    } catch (error) {
      console.error("Login error:", error);
      return res.status(500).json({ error: "Sisselogimine ebaõnnestus" });
    }
  });

  // Auth: logout
  app.post("/api/auth/logout", async (req: Request, res: Response) => {
    try {
      if (req.authUser) {
        await db.insert(authLogs).values({
          userId: req.authUser.id,
          phone: req.authUser.phone,
          event: "logout",
          ip: clientIp(req).slice(0, 64),
        });
      }
      clearSessionCookie(res);
      return res.json({ success: true });
    } catch (error) {
      console.error("Logout error:", error);
      clearSessionCookie(res);
      return res.json({ success: true });
    }
  });

  // Auth: current user (full profile)
  app.get("/api/auth/me", async (req: Request, res: Response) => {
    if (!req.authUser) {
      return res.json({ user: null });
    }
    try {
      const rows = await db.select().from(users).where(eq(users.id, req.authUser.id)).limit(1);
      const u = rows[0];
      if (!u) {
        return res.json({ user: null });
      }
      return res.json({
        user: {
          id: u.id,
          phone: u.phone,
          isAdmin: u.isAdmin,
          age: u.age,
          parcelLocker: u.parcelLocker,
          createdAt: u.createdAt,
        },
      });
    } catch (error) {
      console.error("auth/me error:", error);
      return res.status(500).json({ error: "Andmete laadimine ebaõnnestus" });
    }
  });

  // Auth: update own profile (age, parcelLocker)
  app.put("/api/auth/me", requireAuth, async (req: Request, res: Response) => {
    try {
      const ageRaw = req.body?.age;
      const parcelRaw = req.body?.parcelLocker;

      const update: { age?: number | null; parcelLocker?: string | null } = {};

      if (ageRaw === null || ageRaw === undefined || ageRaw === "") {
        update.age = null;
      } else {
        const ageNum = Number.parseInt(String(ageRaw), 10);
        if (!Number.isInteger(ageNum) || ageNum < 0 || ageNum > 130) {
          return res.status(400).json({ error: "Vigane vanus" });
        }
        update.age = ageNum;
      }

      if (parcelRaw === null || parcelRaw === undefined || parcelRaw === "") {
        update.parcelLocker = null;
      } else {
        const trimmed = String(parcelRaw).trim().slice(0, 200);
        update.parcelLocker = trimmed.length === 0 ? null : trimmed;
      }

      await db.update(users).set(update).where(eq(users.id, req.authUser!.id));
      const rows = await db.select().from(users).where(eq(users.id, req.authUser!.id)).limit(1);
      const u = rows[0];
      return res.json({
        user: u && {
          id: u.id,
          phone: u.phone,
          isAdmin: u.isAdmin,
          age: u.age,
          parcelLocker: u.parcelLocker,
          createdAt: u.createdAt,
        },
      });
    } catch (error) {
      console.error("auth/me PUT error:", error);
      return res.status(500).json({ error: "Salvestamine ebaõnnestus" });
    }
  });

  // Game: current user's remaining games per slot for today (Tallinn TZ)
  app.get("/api/game/slots", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.authUser!.id;
      const { idx, date } = getActiveSlot(new Date());
      const remaining = await loadRemaining(userId, date);
      return res.json({ date, activeIdx: idx, remaining });
    } catch (error) {
      console.error("game/slots GET error:", error);
      return res.status(500).json({ error: "Mängude staatuse laadimine ebaõnnestus" });
    }
  });

  // Game: consume one play in the active slot. Server-side authoritative —
  // a transaction with row lock prevents racing two requests past the cap.
  app.post("/api/game/play", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.authUser!.id;
      const { slot, idx, date } = getActiveSlot(new Date());
      if (!slot) {
        const remaining = await loadRemaining(userId, date);
        return res
          .status(409)
          .json({ error: "Selles ajavahemikus ei saa mängida", code: "no_active_slot", remaining, activeIdx: idx, date });
      }

      // Atomic upsert: INSERT a row at played=1, or — on conflict — bump the
      // counter only while it's still under the cap. The setWhere clause is
      // what makes this safe under concurrency: the second of two racing
      // requests sees a conflict, then the WHERE rejects the update, and
      // RETURNING is empty, so we know the play was refused.
      const accepted = await db.transaction(async (tx) => {
        const inserted = await tx
          .insert(userSlotPlays)
          .values({ userId, date, slotId: slot.id, played: 1 })
          .onConflictDoUpdate({
            target: [userSlotPlays.userId, userSlotPlays.date, userSlotPlays.slotId],
            set: {
              played: sql`${userSlotPlays.played} + 1`,
              updatedAt: sql`NOW()`,
            },
            setWhere: sql`${userSlotPlays.played} < ${PER_SLOT}`,
          })
          .returning({ played: userSlotPlays.played });
        if (inserted.length === 0) return false;
        await tx
          .update(users)
          .set({ totalGamesPlayed: sql`${users.totalGamesPlayed} + 1` })
          .where(eq(users.id, userId));
        return true;
      });

      const remaining = await loadRemaining(userId, date);
      if (!accepted) {
        return res
          .status(409)
          .json({ error: "Vööndis on mängud läbi", code: "slot_full", remaining, activeIdx: idx, date });
      }
      return res.json({ remaining, activeIdx: idx, date, slotId: slot.id });
    } catch (error) {
      console.error("game/play POST error:", error);
      return res.status(500).json({ error: "Mängu salvestamine ebaõnnestus" });
    }
  });

  // Admin: list users
  app.get("/api/admin/users", requireAdmin, async (_req: Request, res: Response) => {
    try {
      const rows = await db.select().from(users).orderBy(desc(users.createdAt));
      return res.json({
        users: rows.map((u) => ({
          id: u.id,
          phone: u.phone,
          age: u.age,
          parcelLocker: u.parcelLocker,
          isAdmin: u.isAdmin,
          createdAt: u.createdAt,
          lastLoginAt: u.lastLoginAt,
          totalGamesPlayed: u.totalGamesPlayed,
        })),
      });
    } catch (error) {
      console.error("admin/users GET error:", error);
      return res.status(500).json({ error: "Kasutajate laadimine ebaõnnestus" });
    }
  });

  // Admin: create user
  app.post("/api/admin/users", requireAdmin, async (req: Request, res: Response) => {
    try {
      const phoneRaw = String(req.body?.phone ?? "");
      const password = String(req.body?.password ?? "");
      const phone = normalizePhone(phoneRaw);
      if (!phone) {
        return res.status(400).json({ error: "Vigane telefoninumber" });
      }
      if (password.length < 6) {
        return res.status(400).json({ error: "Parool peab olema vähemalt 6 tähemärki" });
      }

      const ageRaw = req.body?.age;
      let age: number | null = null;
      if (ageRaw !== null && ageRaw !== undefined && ageRaw !== "") {
        const n = Number.parseInt(String(ageRaw), 10);
        if (!Number.isInteger(n) || n < 0 || n > 130) {
          return res.status(400).json({ error: "Vigane vanus" });
        }
        age = n;
      }

      const parcelLocker = req.body?.parcelLocker
        ? String(req.body.parcelLocker).trim().slice(0, 200) || null
        : null;
      const isAdmin = !!req.body?.isAdmin;

      const existing = await db.select().from(users).where(eq(users.phone, phone)).limit(1);
      if (existing[0]) {
        return res.status(409).json({ error: "Selle telefoninumbriga kasutaja on juba olemas" });
      }

      const passwordHash = await hashPassword(password);
      const inserted = await db
        .insert(users)
        .values({ phone, passwordHash, age, parcelLocker, isAdmin })
        .returning();
      const u = inserted[0];

      await db.insert(authLogs).values({
        userId: req.authUser!.id,
        phone: req.authUser!.phone,
        event: "admin_user_created",
        ip: clientIp(req).slice(0, 64),
      });

      return res.json({
        user: {
          id: u.id,
          phone: u.phone,
          age: u.age,
          parcelLocker: u.parcelLocker,
          isAdmin: u.isAdmin,
          createdAt: u.createdAt,
          lastLoginAt: u.lastLoginAt,
          totalGamesPlayed: u.totalGamesPlayed,
        },
      });
    } catch (error) {
      console.error("admin/users POST error:", error);
      return res.status(500).json({ error: "Kasutaja loomine ebaõnnestus" });
    }
  });

  // Admin: update user
  app.put("/api/admin/users/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      const id = Number.parseInt(req.params.id, 10);
      if (!Number.isInteger(id)) {
        return res.status(400).json({ error: "Vigane ID" });
      }

      const existing = await db.select().from(users).where(eq(users.id, id)).limit(1);
      if (!existing[0]) {
        return res.status(404).json({ error: "Kasutajat ei leitud" });
      }

      const update: {
        phone?: string;
        passwordHash?: string;
        age?: number | null;
        parcelLocker?: string | null;
        isAdmin?: boolean;
      } = {};

      if (req.body?.phone !== undefined) {
        const phone = normalizePhone(String(req.body.phone));
        if (!phone) return res.status(400).json({ error: "Vigane telefoninumber" });
        if (phone !== existing[0].phone) {
          const collision = await db.select().from(users).where(eq(users.phone, phone)).limit(1);
          if (collision[0]) {
            return res.status(409).json({ error: "Selle telefoninumbriga kasutaja on juba olemas" });
          }
          update.phone = phone;
        }
      }

      if (req.body?.password !== undefined && String(req.body.password).length > 0) {
        const password = String(req.body.password);
        if (password.length < 6) {
          return res.status(400).json({ error: "Parool peab olema vähemalt 6 tähemärki" });
        }
        update.passwordHash = await hashPassword(password);
      }

      if (req.body?.age !== undefined) {
        if (req.body.age === null || req.body.age === "") {
          update.age = null;
        } else {
          const n = Number.parseInt(String(req.body.age), 10);
          if (!Number.isInteger(n) || n < 0 || n > 130) {
            return res.status(400).json({ error: "Vigane vanus" });
          }
          update.age = n;
        }
      }

      if (req.body?.parcelLocker !== undefined) {
        const v = req.body.parcelLocker;
        update.parcelLocker = v ? String(v).trim().slice(0, 200) || null : null;
      }

      if (req.body?.isAdmin !== undefined) {
        // Prevent demoting yourself if you would be the last admin
        if (id === req.authUser!.id && existing[0].isAdmin && !req.body.isAdmin) {
          return res.status(400).json({ error: "Sa ei saa enda admin-õigust ära võtta" });
        }
        update.isAdmin = !!req.body.isAdmin;
      }

      if (Object.keys(update).length > 0) {
        await db.update(users).set(update).where(eq(users.id, id));
      }

      const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
      const u = rows[0];

      await db.insert(authLogs).values({
        userId: req.authUser!.id,
        phone: req.authUser!.phone,
        event: "admin_user_updated",
        ip: clientIp(req).slice(0, 64),
      });

      return res.json({
        user: u && {
          id: u.id,
          phone: u.phone,
          age: u.age,
          parcelLocker: u.parcelLocker,
          isAdmin: u.isAdmin,
          createdAt: u.createdAt,
          lastLoginAt: u.lastLoginAt,
          totalGamesPlayed: u.totalGamesPlayed,
        },
      });
    } catch (error) {
      console.error("admin/users PUT error:", error);
      return res.status(500).json({ error: "Kasutaja muutmine ebaõnnestus" });
    }
  });

  // Admin: delete user
  app.delete("/api/admin/users/:id", requireAdmin, async (req: Request, res: Response) => {
    try {
      const id = Number.parseInt(req.params.id, 10);
      if (!Number.isInteger(id)) {
        return res.status(400).json({ error: "Vigane ID" });
      }
      if (id === req.authUser!.id) {
        return res.status(400).json({ error: "Sa ei saa iseennast kustutada" });
      }
      const existing = await db.select().from(users).where(eq(users.id, id)).limit(1);
      if (!existing[0]) {
        return res.status(404).json({ error: "Kasutajat ei leitud" });
      }
      await db.delete(users).where(eq(users.id, id));
      await db.insert(authLogs).values({
        userId: req.authUser!.id,
        phone: req.authUser!.phone,
        event: "admin_user_deleted",
        ip: clientIp(req).slice(0, 64),
      });
      return res.json({ success: true });
    } catch (error) {
      console.error("admin/users DELETE error:", error);
      return res.status(500).json({ error: "Kasutaja kustutamine ebaõnnestus" });
    }
  });

  // Admin: reset a user's slot plays for today (Tallinn TZ). After this the
  // user's remaining counts go back to PER_SLOT for every slot of the day.
  app.post(
    "/api/admin/users/:id/reset-games",
    requireAdmin,
    async (req: Request, res: Response) => {
      try {
        const id = Number.parseInt(req.params.id, 10);
        if (!Number.isInteger(id)) {
          return res.status(400).json({ error: "Vigane ID" });
        }
        const existing = await db.select().from(users).where(eq(users.id, id)).limit(1);
        if (!existing[0]) {
          return res.status(404).json({ error: "Kasutajat ei leitud" });
        }

        const date = todayKey(new Date());
        await db
          .delete(userSlotPlays)
          .where(and(eq(userSlotPlays.userId, id), eq(userSlotPlays.date, date)));

        await db.insert(authLogs).values({
          userId: req.authUser!.id,
          phone: req.authUser!.phone,
          event: "admin_user_games_reset",
          ip: clientIp(req).slice(0, 64),
        });

        const remaining = await loadRemaining(id, date);
        return res.json({ success: true, date, remaining });
      } catch (error) {
        console.error("admin/users reset-games POST error:", error);
        return res.status(500).json({ error: "Mängude resetimine ebaõnnestus" });
      }
    },
  );

  // Save drop mapping from test mode
  app.post("/api/admin/drop-mapping", requireAdmin, async (req, res) => {
    try {
      const { mappings, testRunId: clientTestRunId } = req.body;
      if (!Array.isArray(mappings) || mappings.length === 0) {
        return res.status(400).json({ error: "Mappings must be a non-empty array" });
      }

      const normalizedMappings: Array<{ dropX: number; boxNumber: number }> = [];
      for (const entry of mappings) {
        const dropX = Number.parseInt(String(entry?.dropX), 10);
        const boxNumber = Number.parseInt(String(entry?.boxNumber), 10);
        if (!Number.isInteger(dropX) || !Number.isInteger(boxNumber)) {
          return res.status(400).json({ error: "Each mapping must contain integer dropX and boxNumber" });
        }
        if (boxNumber < 1 || boxNumber > 19) {
          return res.status(400).json({ error: "boxNumber must be between 1 and 19" });
        }
        normalizedMappings.push({ dropX, boxNumber });
      }

      const testRunId = clientTestRunId || `test_${Date.now()}`;
      await storage.saveDropMapping(normalizedMappings, testRunId);
      const coveredDropPositions = Array.from(new Set(normalizedMappings.map((m) => m.dropX))).length;
      res.json({
        success: true,
        testRunId,
        savedCount: normalizedMappings.length,
        coveredDropPositions,
      });
    } catch (error) {
      console.error("Error saving drop mapping:", error);
      res.status(500).json({ error: "Failed to save drop mapping" });
    }
  });

  // Get latest drop mapping (public — game canvas needs this to render)
  app.get("/api/admin/drop-mapping/latest", async (_req, res) => {
    try {
      const result = await storage.getLatestDropMapping();
      if (!result) {
        return res.json(null);
      }
      res.json({
        ...result,
        totalMapped: result.mappings.length,
        createdAt: result.testRun?.completed_at || null,
      });
    } catch (error) {
      console.error("Error fetching latest drop mapping:", error);
      res.status(500).json({ error: "Failed to fetch drop mapping" });
    }
  });

  // Get total rules (public — game needs this)
  app.get("/api/admin/total-rules", async (_req, res) => {
    try {
      const rules = await storage.getTotalRules();
      res.json(rules);
    } catch (error) {
      console.error("Error fetching total rules:", error);
      res.status(500).json({ error: "Failed to fetch total rules" });
    }
  });

  // Save total rules
  app.put("/api/admin/total-rules", requireAdmin, async (req, res) => {
    try {
      const mustRaw = req.body?.mustTotal;
      const avoidRaw = req.body?.avoidTotal;
      const mustTotal = mustRaw === null || mustRaw === undefined || mustRaw === ""
        ? null
        : Number.parseInt(String(mustRaw), 10);
      const avoidTotal = avoidRaw === null || avoidRaw === undefined || avoidRaw === ""
        ? null
        : Number.parseInt(String(avoidRaw), 10);

      if ((mustTotal !== null && !Number.isInteger(mustTotal)) || (avoidTotal !== null && !Number.isInteger(avoidTotal))) {
        return res.status(400).json({ error: "mustTotal and avoidTotal must be integers or null" });
      }
      if (mustTotal !== null && avoidTotal !== null && mustTotal === avoidTotal) {
        return res.status(400).json({ error: "mustTotal and avoidTotal cannot be equal" });
      }

      await storage.saveTotalRules({ mustTotal, avoidTotal });
      res.json({ success: true, mustTotal, avoidTotal });
    } catch (error) {
      console.error("Error saving total rules:", error);
      res.status(500).json({ error: "Failed to save total rules" });
    }
  });

  // Get game settings (public — game needs this)
  app.get("/api/admin/settings", async (_req, res) => {
    try {
      const settings = await storage.getSettings();
      res.json(settings || {});
    } catch (error) {
      console.error("Error fetching settings:", error);
      res.status(500).json({ error: "Failed to fetch settings" });
    }
  });

  // Save game settings (admin only)
  app.put("/api/admin/settings", requireAdmin, async (req, res) => {
    try {
      const settings = req.body;
      if (!settings || typeof settings !== "object") {
        return res.status(400).json({ error: "Settings must be an object" });
      }
      await storage.saveSettings(settings);
      res.json({ success: true });
    } catch (error) {
      console.error("Error saving settings:", error);
      res.status(500).json({ error: "Failed to save settings" });
    }
  });

  // Get background image (public — game needs this)
  app.get("/api/admin/background", async (_req, res) => {
    try {
      const dataUrl = await storage.getBackgroundImage();
      res.json({ dataUrl });
    } catch (error) {
      console.error("Error fetching background:", error);
      res.status(500).json({ error: "Failed to fetch background" });
    }
  });

  // Upload background image (base64 data URL) — admin only
  app.post("/api/admin/background", requireAdmin, express.json({ limit: "10mb" }), async (req, res) => {
    try {
      const { dataUrl } = req.body;
      if (!dataUrl || typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) {
        return res.status(400).json({ error: "Invalid image data" });
      }
      await storage.saveBackgroundImage(dataUrl);
      res.json({ success: true });
    } catch (error) {
      console.error("Error saving background:", error);
      res.status(500).json({ error: "Failed to save background" });
    }
  });

  // Get background adjust settings (public — game needs this)
  app.get("/api/admin/background-adjust", async (_req, res) => {
    try {
      const adjust = await storage.getBackgroundAdjust();
      res.json(adjust || { zoom: 100, x: 50, y: 50 });
    } catch (error) {
      console.error("Error fetching background adjust:", error);
      res.status(500).json({ error: "Failed to fetch background adjust" });
    }
  });

  // Save background adjust settings (admin only)
  app.put("/api/admin/background-adjust", requireAdmin, async (req, res) => {
    try {
      const { zoom, x, y } = req.body;
      if (typeof zoom !== "number" || typeof x !== "number" || typeof y !== "number") {
        return res.status(400).json({ error: "zoom, x, y must be numbers" });
      }
      await storage.saveBackgroundAdjust({ zoom, x, y });
      res.json({ success: true });
    } catch (error) {
      console.error("Error saving background adjust:", error);
      res.status(500).json({ error: "Failed to save background adjust" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
