// Server-side authoritative slot logic. The day key and active-slot decision
// are computed in Europe/Tallinn so behavior is stable across DST and
// regardless of where the host runs.

const TZ = "Europe/Tallinn";

export const SLOTS = [
  { id: "morning", from: 6, to: 12 },
  { id: "afternoon", from: 12, to: 18 },
  { id: "evening", from: 18, to: 24 },
] as const;

export type ServerSlotId = (typeof SLOTS)[number]["id"];
export const PER_SLOT = 2;

const SLOT_IDS: readonly ServerSlotId[] = SLOTS.map((s) => s.id);

export function isSlotId(v: unknown): v is ServerSlotId {
  return typeof v === "string" && (SLOT_IDS as readonly string[]).includes(v);
}

interface TallinnParts {
  date: string; // "YYYY-MM-DD"
  hour: number; // 0..23
}

function tallinnParts(now: Date): TallinnParts {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  });
  const parts = fmt.formatToParts(now);
  const get = (t: string): string =>
    parts.find((p) => p.type === t)?.value ?? "";
  const date = `${get("year")}-${get("month")}-${get("day")}`;
  const hour = Number.parseInt(get("hour"), 10);
  return { date, hour: Number.isFinite(hour) ? hour : 0 };
}

export function todayKey(now: Date = new Date()): string {
  return tallinnParts(now).date;
}

export function getActiveSlot(now: Date = new Date()): {
  idx: number;
  slot: (typeof SLOTS)[number] | null;
  date: string;
} {
  const { date, hour } = tallinnParts(now);
  const idx = SLOTS.findIndex((s) => hour >= s.from && hour < s.to);
  if (idx === -1) return { idx, slot: null, date };
  return { idx, slot: SLOTS[idx], date };
}

export type Remaining = Record<ServerSlotId, number>;

export function freshRemaining(): Remaining {
  return { morning: PER_SLOT, afternoon: PER_SLOT, evening: PER_SLOT };
}
