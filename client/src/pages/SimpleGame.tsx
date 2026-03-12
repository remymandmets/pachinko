import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import PlinkoSimple, { PlinkoSimpleRef, DEFAULT_SETTINGS, GameSettings } from "@/components/PlinkoSimple";

function generateArrangements(min: number, max: number): number[][] {
  const range = max - min;
  const third = range / 3;
  const mid = (min + max) / 2;
  const arrangements: number[][] = [];
  for (let i = 0; i < 8; i++) {
    const offset = (range / 8) * i;
    arrangements.push([
      min + (offset % range),
      min + ((offset + third) % range),
      min + ((offset + 2 * third) % range),
    ]);
  }
  arrangements.push([min + range * 0.1, min + range * 0.15, min + range * 0.2]);
  arrangements.push([mid - range * 0.05, mid, mid + range * 0.05]);
  arrangements.push([max - range * 0.2, max - range * 0.15, max - range * 0.1]);
  arrangements.push([min + 10, mid, max - 10]);
  arrangements.push([min + range * 0.1, mid - range * 0.1, max - range * 0.1]);
  arrangements.push([min + range * 0.15, mid + range * 0.15, max - range * 0.15]);
  return arrangements;
}

// ── Settings field definitions ──
const SETTING_GROUPS: Array<{
  label: string;
  fields: Array<{ key: keyof GameSettings; label: string; min?: number; max?: number; step?: number }>;
}> = [
  {
    label: "Mängu reeglid",
    fields: [
      { key: "wallGap", label: "Sein", min: 0, max: 3, step: 0.1 },
    ],
  },
  {
    label: "Füüsika",
    fields: [
      { key: "gravity", label: "Gravitatsioon", min: 0, max: 5, step: 0.1 },
      { key: "restitution", label: "Põrkavus", min: 0, max: 1, step: 0.05 },
      { key: "friction", label: "Hõõrdumine", min: 0, max: 1, step: 0.01 },
      { key: "density", label: "Tihedus", min: 0.1, max: 20, step: 0.05 },
    ],
  },
  {
    label: "Paigutus",
    fields: [
      { key: "refWidth", label: "Laius", min: 200, max: 800, step: 10 },
      { key: "pegsPerRow", label: "Pegid reas", min: 5, max: 25, step: 1 },
      { key: "pegRows", label: "Pegi ridu", min: 5, max: 40, step: 1 },
      { key: "ballRadius", label: "Palli raadius", min: 1, max: 40, step: 0.1 },
      { key: "pegRadius", label: "Pegi raadius", min: 1, max: 10, step: 0.5 },
      { key: "boxHeight", label: "Kasti kõrgus", min: 10, max: 100, step: 5 },
      { key: "topMargin", label: "Ülemine veeris", min: 20, max: 200, step: 5 },
      { key: "bottomMargin", label: "Alumine veeris", min: 0, max: 100, step: 5 },
      { key: "wallThicknessMult", label: "Seina paksus", min: 0.5, max: 5, step: 0.5 },
    ],
  },
  {
    label: "Font",
    fields: [
      { key: "fontValue", label: "Väärtuse font", min: 8, max: 40, step: 1 },
      { key: "fontCount", label: "Loenduse font", min: 8, max: 30, step: 1 },
    ],
  },
];

export default function SimpleGame() {
  const [arrangementIndex, setArrangementIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [lastScore, setLastScore] = useState<number | null>(null);
  const [lastBreakdown, setLastBreakdown] = useState("");
  const [showScore, setShowScore] = useState(false);
  const [arrangements, setArrangements] = useState<number[][]>([]);
  const [targetTotal, setTargetTotal] = useState<number | null>(null);
  const [avoidTotal, setAvoidTotal] = useState<number | null>(null);
  const [testMapping, setTestMapping] = useState<{ [dropX: number]: number }>({});
  const [testRunning, setTestRunning] = useState(false);
  const [testStatus, setTestStatus] = useState<"idle" | "running" | "completed" | "failed">("idle");
  const [testProgress, setTestProgress] = useState({ processed: 0, total: 0, mapped: 0, retryCount: 0 });
  const [constraintError, setConstraintError] = useState<string | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  // Settings state (all game settings including wallGap)
  const [gameSettings, setGameSettings] = useState<GameSettings>({ ...DEFAULT_SETTINGS });
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  const [activePage, setActivePage] = useState(0);
  const plinkoRef = useRef<PlinkoSimpleRef>(null);
  const initDone = useRef(false);
  const totalsLoadedRef = useRef(false);
  const settingsPageRef = useRef<HTMLDivElement>(null);
  const touchStartY = useRef(0);
  const touchStartTime = useRef(0);

  // Swipe handler — needs strong deliberate swipe to switch pages
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartY.current = e.touches[0].clientY;
    touchStartTime.current = Date.now();
  }, []);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    const dy = touchStartY.current - e.changedTouches[0].clientY;
    const dt = Date.now() - touchStartTime.current;
    const velocity = Math.abs(dy) / dt; // px/ms

    if (activePage === 0 && dy > 80 && velocity > 0.3) {
      // Strong swipe up from game → settings
      setActivePage(1);
    }
  }, [activePage]);

  // Settings object for PlinkoSimple (excludes wallGap since it's part of settings now)
  const plinkoSettings = useMemo(() => gameSettings, [gameSettings]);

  const updateSetting = useCallback((key: keyof GameSettings, value: number) => {
    setGameSettings(prev => ({ ...prev, [key]: value }));
  }, []);

  // Generate smart arrangements
  const generateSmartArrangements = useCallback((
    min: number, max: number, mapping: { [dropX: number]: number },
    target: number | null, avoid: number | null
  ): number[][] => {
    setConstraintError(null);
    const boxValues = plinkoRef.current?.getBoxValues();
    if (!boxValues) return generateArrangements(min, max);

    const boxCount = boxValues.length;
    const validMapping: { [dropX: number]: number } = {};
    for (const [key, val] of Object.entries(mapping)) {
      if (val >= 1 && val <= boxCount) validMapping[Number(key)] = val;
    }
    const mappingKeys = Object.keys(validMapping).map(Number);

    if (mappingKeys.length === 0) {
      if (target !== null || avoid !== null) setConstraintError("Vajuta enne TEST!");
      return generateArrangements(min, max);
    }

    const allBoxValuesSet = new Set(boxValues);
    const allBoxValuesArr = Array.from(allBoxValuesSet);

    if (target !== null) {
      let targetPossible = false;
      for (const a of allBoxValuesArr) {
        for (const b of allBoxValuesArr) {
          if (allBoxValuesSet.has(target - a - b)) { targetPossible = true; break; }
        }
        if (targetPossible) break;
      }
      if (!targetPossible) {
        const allTotals = new Set<number>();
        for (const a of allBoxValuesArr)
          for (const b of allBoxValuesArr)
            for (const c of allBoxValuesArr)
              allTotals.add(a + b + c);
        const sorted = Array.from(allTotals).sort((a, b) => Math.abs(a - target) - Math.abs(b - target));
        setConstraintError(`${target} ei ole võimalik! Lähimad: ${sorted.slice(0, 3).join(', ')}`);
        return generateArrangements(min, max);
      }
    }

    const results: number[][] = [];
    for (let attempt = 0; attempt < 50000 && results.length < 100; attempt++) {
      const combo: number[] = [];
      for (let i = 0; i < 3; i++) combo.push(mappingKeys[Math.floor(Math.random() * mappingKeys.length)]);
      const total = combo.reduce((sum, pos) => sum + (boxValues[(validMapping[pos]) - 1] || 0), 0);
      if (target !== null && total !== target) continue;
      if (avoid !== null && total === avoid) continue;
      if (!results.some(existing => existing.every((v, i) => Math.abs(v - combo[i]) < 5))) {
        results.push(combo);
      }
    }

    if (results.length > 0) {
      for (let i = results.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [results[i], results[j]] = [results[j], results[i]];
      }
      return results;
    }

    setConstraintError('Ei leia sobivaid kombinatsioone!');
    return generateArrangements(min, max);
  }, []);

  // Load settings from DB
  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch("/api/admin/settings");
        if (res.ok) {
          const data = await res.json();
          if (data && Object.keys(data).length > 0) {
            setGameSettings(prev => ({ ...prev, ...data, boxValues: data.boxValues ?? prev.boxValues }));
          }
        }
      } catch {}
      setSettingsLoaded(true);
    };
    load();
  }, []);

  // Save settings to DB (debounced)
  useEffect(() => {
    if (!settingsLoaded) return;
    const timer = setTimeout(async () => {
      try {
        await fetch("/api/admin/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(gameSettings),
        });
      } catch {}
    }, 500);
    return () => clearTimeout(timer);
  }, [gameSettings, settingsLoaded]);

  // Load saved mapping + total rules on startup
  useEffect(() => {
    if (initDone.current) return;
    let cancelled = false;
    const init = async () => {
      await new Promise(r => setTimeout(r, 100));
      if (cancelled || !plinkoRef.current) return;
      let mapping: { [dropX: number]: number } = {};
      try {
        const res = await fetch("/api/admin/drop-mapping/latest");
        if (res.ok) {
          const data = await res.json();
          if (data?.mappings?.length > 0) {
            for (const m of data.mappings) mapping[m.dropX] = m.boxNumber;
            setTestMapping(mapping);
            setTestStatus("completed");
          }
        }
      } catch {}
      if (cancelled || !plinkoRef.current) return;
      const { min, max } = plinkoRef.current.getPlayableRange();
      const arr = generateSmartArrangements(min, max, mapping, targetTotal, avoidTotal);
      setArrangements(arr);
      plinkoRef.current.setPreviewPositions(arr[0]);
      initDone.current = true;
    };
    init();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadTotalRules = async () => {
      try {
        const res = await fetch("/api/admin/total-rules");
        if (!res.ok) return;
        const rules = await res.json();
        if (cancelled) return;
        setTargetTotal(typeof rules?.mustTotal === "number" ? rules.mustTotal : null);
        setAvoidTotal(typeof rules?.avoidTotal === "number" ? rules.avoidTotal : null);
      } catch {} finally { totalsLoadedRef.current = true; }
    };
    loadTotalRules();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!totalsLoadedRef.current) return;
    const timer = setTimeout(async () => {
      try {
        await fetch("/api/admin/total-rules", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mustTotal: targetTotal, avoidTotal }),
        });
      } catch {}
    }, 300);
    return () => clearTimeout(timer);
  }, [targetTotal, avoidTotal]);

  useEffect(() => {
    if (!plinkoRef.current || !initDone.current) return;
    const { min, max } = plinkoRef.current.getPlayableRange();
    const arr = generateSmartArrangements(min, max, testMapping, targetTotal, avoidTotal);
    setArrangements(arr);
    setArrangementIndex(0);
    if (arr.length > 0) plinkoRef.current.setPreviewPositions(arr[0]);
  }, [targetTotal, avoidTotal, testMapping, generateSmartArrangements]);

  useEffect(() => {
    if (arrangements.length === 0) return;
    plinkoRef.current?.setPreviewPositions(arrangements[arrangementIndex]);
  }, [arrangementIndex, arrangements]);

  const handlePrev = useCallback(() => {
    if (isPlaying || arrangements.length === 0) return;
    setShowScore(false);
    setArrangementIndex((prev) => (prev - 1 + arrangements.length) % arrangements.length);
  }, [isPlaying, arrangements.length]);

  const handleNext = useCallback(() => {
    if (isPlaying || arrangements.length === 0) return;
    setShowScore(false);
    setArrangementIndex((prev) => (prev + 1) % arrangements.length);
  }, [isPlaying, arrangements.length]);

  const handlePlay = useCallback(() => {
    if (isPlaying || arrangements.length === 0) return;
    setIsPlaying(true);
    setShowScore(false);
    setLastScore(null);
    plinkoRef.current?.dropBalls(arrangements[arrangementIndex]);
  }, [isPlaying, arrangementIndex, arrangements]);

  const handleTest = useCallback(() => {
    if (isPlaying || testRunning) return;
    setTestRunning(true);
    setTestStatus("running");
    setTestError(null);
    setConstraintError(null);
    setTestProgress({ processed: 0, total: 0, mapped: 0, retryCount: 0 });
    setShowScore(false);
    plinkoRef.current?.startTestMode({
      onProgress: (progress) => setTestProgress(progress),
      onError: (error) => {
        setTestRunning(false);
        setTestStatus("failed");
        const details = error.failedDropXs.length > 0
          ? ` Ebaõnnestunud: ${error.failedDropXs.slice(0, 10).join(", ")}${error.failedDropXs.length > 10 ? "..." : ""}`
          : "";
        setTestError(`${error.message}${details}`);
      },
      onComplete: (mapping) => {
        setTestMapping(mapping);
        setTestRunning(false);
        setTestStatus("completed");
        if (plinkoRef.current) {
          const { min, max } = plinkoRef.current.getPlayableRange();
          const arr = generateSmartArrangements(min, max, mapping, targetTotal, avoidTotal);
          setArrangements(arr);
          setArrangementIndex(0);
          if (arr.length > 0) {
            plinkoRef.current.clearBoard();
            plinkoRef.current.setPreviewPositions(arr[0]);
          }
        }
      },
    });
  }, [isPlaying, testRunning, targetTotal, avoidTotal, generateSmartArrangements]);

  const handleGameEnd = useCallback((totalScore: number, breakdown: string) => {
    setIsPlaying(false);
    setLastScore(totalScore);
    setLastBreakdown(breakdown);
    setShowScore(true);
    setArrangementIndex((prev) => (prev + 1) % (arrangements.length || 1));
  }, [arrangements.length]);

  const handleBoxValueChange = useCallback((index: number, value: number) => {
    setGameSettings(prev => {
      const newValues = [...prev.boxValues];
      newValues[index] = value;
      return { ...prev, boxValues: newValues };
    });
  }, []);

  const handleResetSettings = useCallback(() => {
    setGameSettings({ ...DEFAULT_SETTINGS });
  }, []);

  return (
    <div
      style={{
        width: "100vw",
        height: "100dvh",
        overflow: "hidden",
      }}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <div
        style={{
          width: "100%",
          height: "200dvh",
          transform: `translateY(${activePage === 0 ? "0" : "-100dvh"})`,
          transition: "transform 0.4s cubic-bezier(0.22, 1, 0.36, 1)",
        }}
      >
        {/* ═══ PAGE 1: Game ═══ */}
        <div
          style={{
            width: "100%",
            height: "100dvh",
            display: "flex",
            flexDirection: "column",
            background: "#0a0a0a",
            flexShrink: 0,
          }}
        >
          {/* Game area - 80dvh */}
          <div style={{ height: "85dvh", position: "relative", flexShrink: 0 }}>
            <PlinkoSimple ref={plinkoRef} onGameEnd={handleGameEnd} settings={plinkoSettings} />

            {showScore && lastScore !== null && (
              <div
                style={{
                  position: "absolute",
                  top: "45%",
                  left: "50%",
                  transform: "translate(-50%, -50%)",
                  zIndex: 100,
                  pointerEvents: "none",
                  animation: "scoreAppear 0.4s ease-out forwards",
                }}
              >
                <div
                  style={{
                    width: 160, height: 160, borderRadius: "50%",
                    background: "#059669",
                    display: "flex", flexDirection: "column",
                    alignItems: "center", justifyContent: "center",
                    boxShadow: "0 12px 48px rgba(5, 150, 105, 0.6), 0 0 80px rgba(5, 150, 105, 0.3)",
                    border: "4px solid #fff", padding: 10,
                  }}
                >
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#fff", marginBottom: 3 }}>Tulemus</div>
                  {lastBreakdown.includes("+") && (
                    <div style={{ fontSize: 14, fontWeight: 600, color: "#fff", marginBottom: 4, wordBreak: "break-all", textAlign: "center" }}>
                      {lastBreakdown}
                    </div>
                  )}
                  <div style={{ fontSize: 48, fontWeight: "normal", color: "#fff", lineHeight: 1 }}>{lastScore}</div>
                </div>
              </div>
            )}
          </div>

          {/* Bottom bar: arrows + play - 20dvh */}
          <div
            style={{
              height: "15dvh",
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "clamp(8px, 3vw, 16px)",
              background: "#111",
              borderTop: "1px solid #333",
              padding: "0 16px",
            }}
          >
            <button
              onClick={handlePrev}
              disabled={isPlaying || testRunning}
              style={{
                width: "clamp(44px, 12vw, 64px)", height: "clamp(44px, 12vw, 64px)",
                borderRadius: 14, border: "2px solid #333",
                background: isPlaying || testRunning ? "#1a1a1a" : "#222",
                color: isPlaying || testRunning ? "#555" : "#fff",
                fontSize: "clamp(20px, 5vw, 30px)",
                cursor: isPlaying || testRunning ? "not-allowed" : "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
                transition: "all 0.2s", flexShrink: 0,
              }}
            >◀</button>

            <button
              onClick={handlePlay}
              disabled={isPlaying || testRunning}
              style={{
                flex: 1, maxWidth: 220, height: "clamp(44px, 12vw, 64px)",
                borderRadius: 14, border: "none",
                background: isPlaying || testRunning ? "#065f46" : "#059669",
                color: "#fff", fontSize: "clamp(18px, 5vw, 28px)",
                fontWeight: 900, letterSpacing: 2,
                cursor: isPlaying || testRunning ? "not-allowed" : "pointer",
                opacity: isPlaying || testRunning ? 0.5 : 1,
                transition: "all 0.2s",
              }}
            >MÄNGI</button>

            <button
              onClick={handleNext}
              disabled={isPlaying || testRunning}
              style={{
                width: "clamp(44px, 12vw, 64px)", height: "clamp(44px, 12vw, 64px)",
                borderRadius: 14, border: "2px solid #333",
                background: isPlaying || testRunning ? "#1a1a1a" : "#222",
                color: isPlaying || testRunning ? "#555" : "#fff",
                fontSize: "clamp(20px, 5vw, 30px)",
                cursor: isPlaying || testRunning ? "not-allowed" : "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
                transition: "all 0.2s", flexShrink: 0,
              }}
            >▶</button>
          </div>
        </div>

        {/* ═══ PAGE 2: Settings ═══ */}
        <div
          ref={settingsPageRef}
          style={{
            width: "100%",
            height: "100dvh",
            background: "#0a0a0a",
            display: "flex",
            flexDirection: "column",
            flexShrink: 0,
            overflow: "hidden",
          }}
        >
          {/* Header */}
          <div style={{ padding: "8px 12px", borderBottom: "1px solid #333", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button onClick={() => setActivePage(0)}
                style={{ width: 32, height: 32, borderRadius: 8, border: "1px solid #444", background: "#222", color: "#fff", fontSize: 16, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                ▲
              </button>
              <span style={{ color: "#fff", fontSize: 16, fontWeight: 700 }}>Seaded</span>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button onClick={handleTest} disabled={isPlaying || testRunning}
                style={{ padding: "4px 14px", borderRadius: 6, border: "none", background: testRunning ? "#92400e" : "#eab308", color: testRunning ? "#fef3c7" : "#000", fontSize: 13, fontWeight: 900, cursor: isPlaying || testRunning ? "not-allowed" : "pointer" }}>
                {testRunning ? `${testProgress.mapped}/${testProgress.total}` : "TEST"}
              </button>
              <span style={{ fontSize: 11, color: testStatus === "completed" ? "#4ade80" : testStatus === "failed" ? "#f87171" : "#666", minWidth: 20 }}>
                {testStatus === "completed" ? "✓" : testStatus === "failed" ? "✗" : ""}
              </span>
              <button onClick={handleResetSettings}
                style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid #555", background: "#222", color: "#f87171", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                Reset
              </button>
            </div>
          </div>
          {(testError || constraintError) && (
            <div style={{ padding: "2px 12px", fontSize: 11, color: "#f87171", flexShrink: 0 }}>{testError || constraintError}</div>
          )}

          {/* Settings grid */}
          <div style={{ flex: 1, padding: "8px 10px", display: "flex", flexDirection: "column", gap: 6, overflow: "hidden" }}>
            {/* Peab / Keela */}
            <div style={{ display: "flex", gap: 6 }}>
              <Stepper label="Peab" value={targetTotal ?? 0} onChange={(v) => setTargetTotal(v === 0 ? null : v)} step={1} color="#4ade80" />
              <Stepper label="Keela" value={avoidTotal ?? 0} onChange={(v) => setAvoidTotal(v === 0 ? null : v)} step={1} color="#f87171" />
            </div>

            {/* Box values - larger, more touch-friendly */}
            <div style={{ background: "#141414", borderRadius: 8, padding: "6px 8px", border: "1px solid #282828" }}>
              <div style={{ fontSize: 11, color: "#666", marginBottom: 4 }}>Kastid ({gameSettings.boxValues.length})</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 4 }}>
                {gameSettings.boxValues.map((val, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "center", background: "#1a1a1a", borderRadius: 6, border: "1px solid #333", height: 32 }}>
                    <button onClick={() => handleBoxValueChange(i, val - 1)} style={boxBtn}>◀</button>
                    <span style={{ flex: 1, textAlign: "center" as const, fontSize: 14, color: "#059669", fontWeight: 700 }}>{val}</span>
                    <button onClick={() => handleBoxValueChange(i, val + 1)} style={boxBtn}>▶</button>
                  </div>
                ))}
              </div>
            </div>

            {/* All settings in 2-column grid */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, flex: 1 }}>
              {ALL_SETTINGS_FLAT.map((f) => (
                <Stepper
                  key={f.key}
                  label={f.label}
                  value={gameSettings[f.key] as number}
                  onChange={(v) => updateSetting(f.key, v)}
                  step={f.step ?? 1}
                  min={f.min}
                  max={f.max}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes scoreAppear {
          0% { transform: translate(-50%, -50%) scale(0.3); opacity: 0; }
          60% { transform: translate(-50%, -50%) scale(1.1); opacity: 1; }
          100% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
        }
      `}</style>
    </div>
  );
}

// Flat list of all settings for the 2-column grid
const ALL_SETTINGS_FLAT = SETTING_GROUPS.flatMap(g => g.fields);

const miniBtn: React.CSSProperties = {
  width: 22, height: 22, padding: 0, border: "none", borderRadius: 4,
  background: "#282828", color: "#888", fontSize: 13, fontWeight: 700,
  cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
  lineHeight: 1,
};

const boxBtn: React.CSSProperties = {
  width: 26, height: "100%", padding: 0, border: "none", borderRadius: 0,
  background: "transparent", color: "#059669", fontSize: 11, fontWeight: 700,
  cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
};

function Stepper({ label, value, onChange, step = 1, min, max, color }: {
  label: string; value: number; onChange: (v: number) => void;
  step?: number; min?: number; max?: number; color?: string;
}) {
  const clamp = (v: number) => {
    let n = Math.round(v * 1000) / 1000;
    if (min !== undefined) n = Math.max(min, n);
    if (max !== undefined) n = Math.min(max, n);
    return n;
  };
  const c = color || "#fff";
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      background: "#141414", borderRadius: 6, padding: "3px 8px",
      border: "1px solid #282828", height: 32,
    }}>
      <span style={{ fontSize: 10, color: "#999", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{label}</span>
      <div style={{ display: "flex", alignItems: "center", gap: 2, flexShrink: 0 }}>
        <button onClick={() => onChange(clamp(value - step))} style={{ ...miniBtn, fontSize: 14 }}>◀</button>
        <span style={{ minWidth: 32, textAlign: "center" as const, fontSize: 12, fontWeight: 700, color: c }}>{value}</span>
        <button onClick={() => onChange(clamp(value + step))} style={{ ...miniBtn, fontSize: 14 }}>▶</button>
      </div>
    </div>
  );
}
