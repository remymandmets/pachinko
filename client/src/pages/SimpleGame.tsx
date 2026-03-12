import React, { useState, useRef, useEffect, useCallback } from "react";
import PlinkoSimple, { PlinkoSimpleRef } from "@/components/PlinkoSimple";

// Generate fallback arrangements using ref-coord range
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
  const [wallGap, setWallGap] = useState(1.0);
  const plinkoRef = useRef<PlinkoSimpleRef>(null);
  const initDone = useRef(false);
  const totalsLoadedRef = useRef(false);

  // Generate smart arrangements using mapping + constraints
  // All positions are in FIXED reference coordinates (same on every screen)
  const generateSmartArrangements = useCallback((
    min: number, max: number, mapping: { [dropX: number]: number },
    target: number | null, avoid: number | null
  ): number[][] => {
    setConstraintError(null);

    const boxValues = plinkoRef.current?.getBoxValues();
    if (!boxValues) {
      return generateArrangements(min, max);
    }

    const boxCount = boxValues.length;
    const validMapping: { [dropX: number]: number } = {};
    for (const [key, val] of Object.entries(mapping)) {
      if (val >= 1 && val <= boxCount) {
        validMapping[Number(key)] = val;
      }
    }
    const mappingKeys = Object.keys(validMapping).map(Number);

    if (mappingKeys.length === 0) {
      if (target !== null || avoid !== null) {
        setConstraintError("Vajuta enne TEST!");
      }
      return generateArrangements(min, max);
    }

    const allBoxValuesSet = new Set(boxValues);
    const allBoxValuesArr = Array.from(allBoxValuesSet);

    if (target !== null) {
      let targetPossible = false;
      for (const a of allBoxValuesArr) {
        for (const b of allBoxValuesArr) {
          const c = target - a - b;
          if (allBoxValuesSet.has(c)) {
            targetPossible = true;
            break;
          }
        }
        if (targetPossible) break;
      }
      if (!targetPossible) {
        const allTotals = new Set<number>();
        for (const a of allBoxValuesArr) {
          for (const b of allBoxValuesArr) {
            for (const c of allBoxValuesArr) {
              allTotals.add(a + b + c);
            }
          }
        }
        const sorted = Array.from(allTotals).sort((a, b) => Math.abs(a - target) - Math.abs(b - target));
        const closest = sorted.slice(0, 3);
        setConstraintError(`${target} ei ole võimalik! Lähimad: ${closest.join(', ')}`);
        return generateArrangements(min, max);
      }
    }

    const results: number[][] = [];
    const maxAttempts = 50000;
    const targetCount = 100;

    for (let attempt = 0; attempt < maxAttempts && results.length < targetCount; attempt++) {
      const combo: number[] = [];
      for (let i = 0; i < 3; i++) {
        combo.push(mappingKeys[Math.floor(Math.random() * mappingKeys.length)]);
      }
      const total = combo.reduce((sum, pos) => {
        const boxIdx = validMapping[pos];
        return sum + (boxValues[boxIdx - 1] || 0);
      }, 0);

      if (target !== null && total !== target) continue;
      if (avoid !== null && total === avoid) continue;

      const isDuplicate = results.some(existing =>
        existing.every((v, i) => Math.abs(v - combo[i]) < 5)
      );
      if (!isDuplicate) {
        results.push(combo);
      }
    }

    if (results.length > 0) {
      for (let i = results.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [results[i], results[j]] = [results[j], results[i]];
      }
      console.log(`🎯 Generated ${results.length} arrangements`,
        target !== null ? `(target=${target})` : '',
        avoid !== null ? `(avoid=${avoid})` : '');
      return results;
    }

    setConstraintError('Ei leia sobivaid kombinatsioone!');
    return generateArrangements(min, max);
  }, []);

  // Load saved mapping from database on startup, then generate arrangements
  useEffect(() => {
    if (initDone.current) return;
    let cancelled = false;
    const init = async () => {
      // Wait for plinko to be ready
      await new Promise(r => setTimeout(r, 100));
      if (cancelled || !plinkoRef.current) return;

      // Try to load saved mapping
      let mapping: { [dropX: number]: number } = {};
      try {
        const res = await fetch("/api/admin/drop-mapping/latest");
        if (res.ok) {
          const data = await res.json();
          if (data?.mappings?.length > 0) {
            for (const m of data.mappings) {
              mapping[m.dropX] = m.boxNumber;
            }
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
      } catch {
      } finally {
        totalsLoadedRef.current = true;
      }
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

  // Regenerate arrangements when target/avoid changes
  useEffect(() => {
    if (!plinkoRef.current || !initDone.current) return;
    const { min, max } = plinkoRef.current.getPlayableRange();
    const arr = generateSmartArrangements(min, max, testMapping, targetTotal, avoidTotal);
    setArrangements(arr);
    setArrangementIndex(0);
    if (arr.length > 0) {
      plinkoRef.current.setPreviewPositions(arr[0]);
    }
  }, [targetTotal, avoidTotal, testMapping, generateSmartArrangements]);

  // Update preview when arrangement changes
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
      onProgress: (progress) => {
        setTestProgress(progress);
      },
      onError: (error) => {
        setTestRunning(false);
        setTestStatus("failed");
        const details = error.failedDropXs.length > 0
          ? ` Ebaõnnestunud X-id: ${error.failedDropXs.slice(0, 10).join(", ")}${error.failedDropXs.length > 10 ? "..." : ""}`
          : "";
        setTestError(`${error.message}${details}`);
      },
      onComplete: (mapping) => {
        // Mapping is in fixed reference coords — same on every screen
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

  return (
    <div
      style={{
        width: "100vw",
        height: "100dvh",
        display: "flex",
        flexDirection: "column",
        background: "#0a0a0a",
        overflow: "hidden",
        position: "relative",
      }}
    >
      {/* Game area - 80vh, edge to edge */}
      <div
        style={{
          width: "100%",
          height: "80dvh",
          position: "relative",
          flexShrink: 0,
        }}
      >
        <PlinkoSimple ref={plinkoRef} onGameEnd={handleGameEnd} wallGap={wallGap} />

        {/* Floating score overlay */}
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
                width: 160,
                height: 160,
                borderRadius: "50%",
                background: "#059669",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: "0 12px 48px rgba(5, 150, 105, 0.6), 0 0 80px rgba(5, 150, 105, 0.3)",
                border: "4px solid #fff",
                padding: 10,
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 600, color: "#fff", marginBottom: 3 }}>
                Tulemus
              </div>
              {lastBreakdown.includes("+") && (
                <div
                  style={{
                    fontSize: 14,
                    fontWeight: 600,
                    color: "#fff",
                    marginBottom: 4,
                    wordBreak: "break-all",
                    textAlign: "center",
                  }}
                >
                  {lastBreakdown}
                </div>
              )}
              <div style={{ fontSize: 48, fontWeight: "normal", color: "#fff", lineHeight: 1 }}>
                {lastScore}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Controls area - 20vh */}
      <div
        style={{
          height: "20dvh",
          flexShrink: 0,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          gap: "clamp(6px, 1.5vh, 12px)",
          background: "#111",
          borderTop: "1px solid #333",
          padding: "0 16px",
          boxSizing: "border-box",
        }}
      >
        {/* Error message */}
        {constraintError && (
          <div style={{
            width: "100%",
            textAlign: "center",
            color: "#f87171",
            fontSize: "clamp(10px, 2.5vw, 13px)",
            fontWeight: 600,
            padding: "2px 0",
          }}>
            {constraintError}
          </div>
        )}
        {/* Row 1: TEST + Peab + Keela + Sein */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "clamp(6px, 2vw, 12px)",
            width: "100%",
          }}
        >
          <button
            onClick={handleTest}
            disabled={isPlaying || testRunning}
            style={{
              padding: "6px 14px",
              borderRadius: 8,
              border: "none",
              background: testRunning ? "#92400e" : (isPlaying ? "#333" : "#eab308"),
              color: testRunning ? "#fef3c7" : (isPlaying ? "#666" : "#000"),
              fontSize: "clamp(12px, 3vw, 15px)",
              fontWeight: 900,
              cursor: isPlaying || testRunning ? "not-allowed" : "pointer",
              transition: "all 0.2s",
              flexShrink: 0,
              opacity: isPlaying ? 0.4 : 1,
            }}
          >
            {testRunning ? "TESTING..." : "TEST"}
          </button>

          <div style={{ display: "flex", alignItems: "center", gap: 4, flex: 1 }}>
            <span style={{ fontSize: "clamp(10px, 2.5vw, 12px)", color: "#4ade80", whiteSpace: "nowrap" }}>Peab=</span>
            <input
              type="number"
              min="0"
              placeholder="—"
              value={targetTotal !== null ? targetTotal : ""}
              onChange={(e) => setTargetTotal(e.target.value === "" ? null : parseInt(e.target.value))}
              style={{
                width: "clamp(40px, 12vw, 56px)",
                height: 28,
                background: "#1a1a1a",
                border: "1px solid #166534",
                borderRadius: 6,
                color: "#4ade80",
                textAlign: "center",
                fontSize: "clamp(12px, 3vw, 14px)",
                outline: "none",
              }}
            />
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 4, flex: 1 }}>
            <span style={{ fontSize: "clamp(10px, 2.5vw, 12px)", color: "#f87171", whiteSpace: "nowrap" }}>Keela=</span>
            <input
              type="number"
              min="0"
              placeholder="—"
              value={avoidTotal !== null ? avoidTotal : ""}
              onChange={(e) => setAvoidTotal(e.target.value === "" ? null : parseInt(e.target.value))}
              style={{
                width: "clamp(40px, 12vw, 56px)",
                height: 28,
                background: "#1a1a1a",
                border: "1px solid #7f1d1d",
                borderRadius: 6,
                color: "#f87171",
                textAlign: "center",
                fontSize: "clamp(12px, 3vw, 14px)",
                outline: "none",
              }}
            />
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ fontSize: "clamp(10px, 2.5vw, 12px)", color: "#facc15", whiteSpace: "nowrap" }}>Sein=</span>
            <input
              type="number"
              min="0"
              max="3"
              step="0.1"
              value={wallGap}
              onChange={(e) => setWallGap(parseFloat(e.target.value) || 0)}
              style={{
                width: "clamp(40px, 12vw, 56px)",
                height: 28,
                background: "#1a1a1a",
                border: "1px solid #854d0e",
                borderRadius: 6,
                color: "#facc15",
                textAlign: "center",
                fontSize: "clamp(12px, 3vw, 14px)",
                outline: "none",
              }}
            />
          </div>
        </div>

        {/* Row 2: ◀ MÄNGI ▶ */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "clamp(8px, 3vw, 16px)",
            width: "100%",
          }}
        >
          <button
            onClick={handlePrev}
            disabled={isPlaying || testRunning}
            style={{
              width: "clamp(44px, 12vw, 64px)",
              height: "clamp(44px, 12vw, 64px)",
              borderRadius: 14,
              border: "2px solid #333",
              background: isPlaying || testRunning ? "#1a1a1a" : "#222",
              color: isPlaying || testRunning ? "#555" : "#fff",
              fontSize: "clamp(20px, 5vw, 30px)",
              cursor: isPlaying || testRunning ? "not-allowed" : "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transition: "all 0.2s",
              flexShrink: 0,
            }}
          >
            ◀
          </button>

          <button
            onClick={handlePlay}
            disabled={isPlaying || testRunning}
            style={{
              flex: 1,
              maxWidth: 220,
              height: "clamp(44px, 12vw, 64px)",
              borderRadius: 14,
              border: "none",
              background: isPlaying || testRunning ? "#065f46" : "#059669",
              color: "#fff",
              fontSize: "clamp(18px, 5vw, 28px)",
              fontWeight: 900,
              letterSpacing: 2,
              cursor: isPlaying || testRunning ? "not-allowed" : "pointer",
              opacity: isPlaying || testRunning ? 0.5 : 1,
              transition: "all 0.2s",
              textTransform: "uppercase" as const,
            }}
          >
            MÄNGI
          </button>

          <button
            onClick={handleNext}
            disabled={isPlaying || testRunning}
            style={{
              width: "clamp(44px, 12vw, 64px)",
              height: "clamp(44px, 12vw, 64px)",
              borderRadius: 14,
              border: "2px solid #333",
              background: isPlaying || testRunning ? "#1a1a1a" : "#222",
              color: isPlaying || testRunning ? "#555" : "#fff",
              fontSize: "clamp(20px, 5vw, 30px)",
              cursor: isPlaying || testRunning ? "not-allowed" : "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transition: "all 0.2s",
              flexShrink: 0,
            }}
          >
            ▶
          </button>
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
