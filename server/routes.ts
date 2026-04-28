import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import express from "express";
import { storage } from "./storage";
import { db } from "./db";
import { users, authLogs } from "@shared/schema";
import { eq } from "drizzle-orm";
import {
  normalizePhone,
  verifyPassword,
  signSessionToken,
  setSessionCookie,
  clearSessionCookie,
  requireAdmin,
  requireAuth,
} from "./auth";

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

  // Auth: current user
  app.get("/api/auth/me", async (req: Request, res: Response) => {
    if (!req.authUser) {
      return res.json({ user: null });
    }
    return res.json({
      user: {
        id: req.authUser.id,
        phone: req.authUser.phone,
        isAdmin: req.authUser.isAdmin,
      },
    });
  });

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
