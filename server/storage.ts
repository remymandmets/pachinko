import { db } from "./db";
import { sql } from "drizzle-orm";

export interface IStorage {
  getTotalRules(): Promise<{ mustTotal: number | null; avoidTotal: number | null }>;
  saveTotalRules(rules: { mustTotal: number | null; avoidTotal: number | null }): Promise<void>;
  saveDropMapping(mappings: Array<{ dropX: number; boxNumber: number }>, testRunId: string): Promise<void>;
  getLatestDropMapping(): Promise<{ mappings: Array<{ dropX: number; boxNumber: number }>; testRun: any } | null>;
  getSettings(): Promise<Record<string, any> | null>;
  saveSettings(settings: Record<string, any>): Promise<void>;
}

class DatabaseStorage implements IStorage {
  async getTotalRules(): Promise<{ mustTotal: number | null; avoidTotal: number | null }> {
    const result = await db.execute(
      sql`SELECT key, value FROM game_state WHERE key IN ('simple_must_total', 'simple_avoid_total')`
    );

    let mustTotal: number | null = null;
    let avoidTotal: number | null = null;
    for (const row of result.rows as Array<{ key: string; value: string }>) {
      const parsed = Number.parseInt(row.value, 10);
      const normalized = Number.isFinite(parsed) ? parsed : null;
      if (row.key === "simple_must_total") mustTotal = normalized;
      if (row.key === "simple_avoid_total") avoidTotal = normalized;
    }

    return { mustTotal, avoidTotal };
  }

  async saveTotalRules(rules: { mustTotal: number | null; avoidTotal: number | null }): Promise<void> {
    const mustValue = rules.mustTotal === null ? "" : String(rules.mustTotal);
    const avoidValue = rules.avoidTotal === null ? "" : String(rules.avoidTotal);

    await db.transaction(async (tx) => {
      await tx.execute(
        sql`INSERT INTO game_state (key, value, updated_at)
            VALUES ('simple_must_total', ${mustValue}, NOW())
            ON CONFLICT (key)
            DO UPDATE SET value = ${mustValue}, updated_at = NOW()`
      );
      await tx.execute(
        sql`INSERT INTO game_state (key, value, updated_at)
            VALUES ('simple_avoid_total', ${avoidValue}, NOW())
            ON CONFLICT (key)
            DO UPDATE SET value = ${avoidValue}, updated_at = NOW()`
      );
    });
  }

  async saveDropMapping(mappings: Array<{ dropX: number; boxNumber: number }>, testRunId: string): Promise<void> {
    const seen = new Map<number, number>();
    for (const m of mappings) {
      seen.set(m.dropX, m.boxNumber);
    }
    const deduped = Array.from(seen.entries()).map(([dropX, boxNumber]) => ({ dropX, boxNumber }));

    await db.transaction(async (tx) => {
      await tx.execute(sql`DELETE FROM drop_mapping`);
      await tx.execute(sql`DELETE FROM test_runs`);

      await tx.execute(
        sql`INSERT INTO test_runs (test_run_id, total_mappings, status)
            VALUES (${testRunId}, ${deduped.length}, 'completed')`
      );

      for (const mapping of deduped) {
        await tx.execute(
          sql`INSERT INTO drop_mapping (drop_x, box_number, test_run_id)
              VALUES (${mapping.dropX}, ${mapping.boxNumber}, ${testRunId})`
        );
      }
    });
  }

  async getLatestDropMapping(): Promise<{ mappings: Array<{ dropX: number; boxNumber: number }>; testRun: any } | null> {
    const latestRun = await db.execute(
      sql`SELECT * FROM test_runs ORDER BY completed_at DESC LIMIT 1`
    );

    if (latestRun.rows.length === 0) return null;

    const testRun = latestRun.rows[0];

    const mappings = await db.execute(
      sql`SELECT drop_x, box_number FROM drop_mapping WHERE test_run_id = ${(testRun as any).test_run_id} ORDER BY drop_x`
    );

    return {
      mappings: (mappings.rows as Array<{ drop_x: number; box_number: number }>).map((r) => ({
        dropX: r.drop_x,
        boxNumber: r.box_number,
      })),
      testRun,
    };
  }
  async getSettings(): Promise<Record<string, any> | null> {
    const result = await db.execute(
      sql`SELECT value FROM game_state WHERE key = 'game_settings'`
    );
    if (result.rows.length === 0) return null;
    try {
      return JSON.parse((result.rows[0] as any).value);
    } catch {
      return null;
    }
  }

  async saveSettings(settings: Record<string, any>): Promise<void> {
    const value = JSON.stringify(settings);
    await db.execute(
      sql`INSERT INTO game_state (key, value, updated_at)
          VALUES ('game_settings', ${value}, NOW())
          ON CONFLICT (key)
          DO UPDATE SET value = ${value}, updated_at = NOW()`
    );
  }
}

export const storage = new DatabaseStorage();
