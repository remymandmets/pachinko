import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";

export async function registerRoutes(app: Express): Promise<Server> {
  // Save drop mapping from test mode
  app.post("/api/admin/drop-mapping", async (req, res) => {
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

  // Get latest drop mapping
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

  // Get total rules
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
  app.put("/api/admin/total-rules", async (req, res) => {
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

  // Get game settings
  app.get("/api/admin/settings", async (_req, res) => {
    try {
      const settings = await storage.getSettings();
      res.json(settings || {});
    } catch (error) {
      console.error("Error fetching settings:", error);
      res.status(500).json({ error: "Failed to fetch settings" });
    }
  });

  // Save game settings
  app.put("/api/admin/settings", async (req, res) => {
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

  const httpServer = createServer(app);
  return httpServer;
}
