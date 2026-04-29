export const SLOTS = [
  { id: "morning", label: "06:00–12:00", from: 6, to: 12 },
  { id: "afternoon", label: "12:00–18:00", from: 12, to: 18 },
  { id: "evening", label: "18:00–24:00", from: 18, to: 24 },
] as const;

export type SlotDef = (typeof SLOTS)[number];
export type SlotId = SlotDef["id"];
export type Remaining = Record<SlotId, number>;

const STORAGE_KEY = "pachinko.slots.v1";
const PER_SLOT = 2;

function todayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function freshRemaining(): Remaining {
  return { morning: PER_SLOT, afternoon: PER_SLOT, evening: PER_SLOT };
}

export function getActiveSlot(now: Date = new Date()): { idx: number; slot: SlotDef | null } {
  const h = now.getHours();
  const idx = SLOTS.findIndex((s) => h >= s.from && h < s.to);
  if (idx === -1) return { idx: -1, slot: null };
  return { idx, slot: SLOTS[idx] };
}

export function loadRemaining(now: Date = new Date()): Remaining {
  if (typeof window === "undefined") return freshRemaining();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return freshRemaining();
    const parsed = JSON.parse(raw) as { date?: string; remaining?: Partial<Remaining> };
    if (!parsed || parsed.date !== todayKey(now)) return freshRemaining();
    const r = parsed.remaining ?? {};
    return {
      morning: clamp(r.morning),
      afternoon: clamp(r.afternoon),
      evening: clamp(r.evening),
    };
  } catch {
    return freshRemaining();
  }
}

function clamp(n: unknown): number {
  const v = typeof n === "number" && Number.isFinite(n) ? Math.floor(n) : PER_SLOT;
  return Math.max(0, Math.min(PER_SLOT, v));
}

function save(remaining: Remaining, now: Date) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ date: todayKey(now), remaining }),
    );
  } catch {
    /* storage full / disabled — ignore */
  }
}

export function consumeActive(now: Date = new Date()): Remaining {
  const current = loadRemaining(now);
  const { slot } = getActiveSlot(now);
  if (!slot) return current;
  if (current[slot.id] <= 0) return current;
  const next: Remaining = { ...current, [slot.id]: current[slot.id] - 1 };
  save(next, now);
  return next;
}

export function timeLeftMins(now: Date = new Date()): number {
  const { slot } = getActiveSlot(now);
  if (!slot) return 0;
  const end = new Date(now);
  end.setHours(slot.to, 0, 0, 0);
  return Math.max(0, Math.round((end.getTime() - now.getTime()) / 60000));
}

export function fmtCountdown(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h > 0) return `${h}t ${m}min`;
  return `${m}min`;
}
