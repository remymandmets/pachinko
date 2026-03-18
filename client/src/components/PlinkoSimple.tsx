import React, {
  useRef,
  useEffect,
  useState,
  useMemo,
  forwardRef,
  useImperativeHandle,
} from "react";
import * as Matter from "matter-js";

// ── Default settings (exported for use in settings panel) ──
export const DEFAULT_SETTINGS = {
  refWidth: 450,
  ballRadius: 16,
  pegRadius: 2,
  boxHeight: 40,
  topMargin: 90,
  bottomMargin: 30,
  fontValue: 20,
  fontCount: 14,
  wallThicknessMult: 2.0,
  pegsPerRow: 12,
  pegRows: 19,
  gravity: 1.2,
  restitution: 0.7,
  friction: 0,
  density: 5.05,
  boxValues: [17, 2, 33, 5, 0, 34, 11, 29, 1, 23, 32],
  wallGap: 1.0,
};

export type GameSettings = typeof DEFAULT_SETTINGS;

const ACCENT_COLOR = "#059669";

// ── Helper functions (parameterized) ──
function computeDerived(s: GameSettings) {
  const spacing = (s.refWidth - 2 * s.ballRadius) / (s.pegsPerRow - 1);
  const height = s.topMargin + (s.pegRows - 1) * spacing + s.boxHeight + s.bottomMargin;
  const wallThickness = s.ballRadius * s.wallThicknessMult;
  const lastRowY = s.topMargin + (s.pegRows - 1) * spacing;
  return { spacing, height, wallThickness, lastRowY };
}

function getWallGap(s: GameSettings, derived: ReturnType<typeof computeDerived>) {
  const gap = s.ballRadius * s.wallGap;
  const leftmostPegX = s.ballRadius;
  const rightmostPegX = s.ballRadius + (s.pegsPerRow - 1) * derived.spacing;
  const leftWallX = leftmostPegX - gap - derived.wallThickness / 2;
  const rightWallX = rightmostPegX + gap + derived.wallThickness / 2;
  return { leftWallX, rightWallX };
}

function getPegXY(s: GameSettings, derived: ReturnType<typeof computeDerived>, row: number, col: number) {
  const pegOffsetX = row % 2 === 1 ? derived.spacing / 2 : 0;
  return {
    x: s.ballRadius + col * derived.spacing + pegOffsetX,
    y: s.topMargin + row * derived.spacing,
  };
}

function getCollectorBoxes(s: GameSettings, derived: ReturnType<typeof computeDerived>) {
  const bottomPegXs = Array.from({ length: s.pegsPerRow }, (_, i) => {
    const pegOffsetX = (s.pegRows - 1) % 2 === 1 ? derived.spacing / 2 : 0;
    return s.ballRadius + i * derived.spacing + pegOffsetX;
  });
  const count = bottomPegXs.length - 1;
  const edges = Array.from({ length: count }, (_, i) => {
    const left = bottomPegXs[i];
    const right = bottomPegXs[i + 1];
    return { left, right, center: (left + right) / 2, width: right - left };
  });
  return { edges, count };
}

interface BallMeta {
  id: number;
  body: Matter.Body;
  removed: boolean;
  sinkIndex?: number;
  isWinning?: boolean;
  landed?: boolean;
  dropX?: number;
}

export interface PlinkoSimpleRef {
  dropBalls: (positions: number[]) => void;
  clearBoard: () => void;
  setPreviewPositions: (positions: number[]) => void;
  getPlayableRange: () => { min: number; max: number };
  startTestMode: (
    callbacks?:
      | ((mapping: { [dropX: number]: number }) => void)
      | {
          onComplete: (mapping: { [dropX: number]: number }) => void;
          onProgress?: (progress: {
            processed: number;
            total: number;
            mapped: number;
            retryCount: number;
          }) => void;
          onError?: (error: { message: string; failedDropXs: number[] }) => void;
        }
  ) => void;
  getBoxValues: () => number[];
  pixelToNorm: (px: number) => number;
  normToPixel: (norm: number) => number;
}

export interface BgAdjust {
  zoom: number;  // percentage, 100 = cover
  x: number;     // percentage 0-100, 50 = center
  y: number;     // percentage 0-100, 50 = center
}

interface PlinkoSimpleProps {
  onGameEnd?: (totalScore: number, breakdown: string) => void;
  settings?: Partial<GameSettings>;
  backgroundImage?: string | null;
  bgAdjust?: BgAdjust;
}

const PlinkoSimple = forwardRef<PlinkoSimpleRef, PlinkoSimpleProps>(
  ({ onGameEnd, settings: settingsOverride, backgroundImage, bgAdjust }, ref) => {
    // Merge settings with defaults
    const s = useMemo<GameSettings>(() => ({
      ...DEFAULT_SETTINGS,
      ...settingsOverride,
      boxValues: settingsOverride?.boxValues ?? DEFAULT_SETTINGS.boxValues,
    }), [settingsOverride]);

    const derived = useMemo(() => computeDerived(s), [s]);

    const containerRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const engineRef = useRef<Matter.Engine | null>(null);
    const ballsMetaRef = useRef<BallMeta[]>([]);
    const nextBallId = useRef(1);
    const previewPositionsRef = useRef<number[]>([]);
    const [previewPositions, setPreviewPositions] = useState<number[]>([]);
    const expectedBallsRef = useRef(0);
    const landedBallsRef = useRef(0);
    const onGameEndRef = useRef(onGameEnd);
    const settingsRef = useRef(s);
    const derivedRef = useRef(derived);
    const renderRef = useRef<{ scale: number; offsetX: number; offsetY: number; W: number; H: number }>({
      scale: 1, offsetX: 0, offsetY: 0, W: s.refWidth, H: derived.height,
    });

    const [dimensions, setDimensions] = useState<{ w: number; h: number } | null>(null);

    useEffect(() => { onGameEndRef.current = onGameEnd; }, [onGameEnd]);
    useEffect(() => { previewPositionsRef.current = previewPositions; }, [previewPositions]);
    useEffect(() => { settingsRef.current = s; derivedRef.current = derived; }, [s, derived]);

    // Measure container
    useEffect(() => {
      if (!containerRef.current) return;
      const measure = () => {
        const rect = containerRef.current!.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        setDimensions({ w: Math.round(rect.width * dpr), h: Math.round(rect.height * dpr) });
      };
      measure();
      const ro = new ResizeObserver(measure);
      ro.observe(containerRef.current);
      return () => ro.disconnect();
    }, []);

    // Update render transform when dimensions change
    useEffect(() => {
      if (!dimensions) return;
      const { w: W, h: H } = dimensions;
      const scale = Math.min(W / s.refWidth, H / derived.height);
      const boardW = s.refWidth * scale;
      const boardH = derived.height * scale;
      renderRef.current = {
        scale,
        offsetX: (W - boardW) / 2,
        offsetY: (H - boardH) / 2,
        W, H,
      };
    }, [dimensions, s.refWidth, derived.height]);

    // Build physics world, rebuild when settings change
    useEffect(() => {
      const walls = getWallGap(s, derived);
      const { edges: collectorBoxEdges, count: COLLECTOR_BOX_COUNT } = getCollectorBoxes(s, derived);

      const MWorld = Matter.World;
      const Bodies = Matter.Bodies;
      const engine = Matter.Engine.create();
      engine.gravity.y = s.gravity;
      engineRef.current = engine;
      const world = engine.world;
      ballsMetaRef.current = [];

      // Pegs
      for (let row = 0; row < s.pegRows; row++) {
        for (let col = 0; col < s.pegsPerRow; col++) {
          const { x, y } = getPegXY(s, derived, row, col);
          if (x >= walls.leftWallX + s.ballRadius && x <= walls.rightWallX - s.ballRadius) {
            MWorld.add(world, Bodies.circle(x, y, s.pegRadius, {
              isStatic: true, restitution: 0.9, friction: 0.01,
            }));
          }
        }
      }

      // Side walls
      MWorld.add(world, [
        Bodies.rectangle(walls.leftWallX, derived.height / 2, derived.wallThickness, derived.height, { isStatic: true }),
        Bodies.rectangle(walls.rightWallX, derived.height / 2, derived.wallThickness, derived.height, { isStatic: true }),
      ]);

      // Collector box walls + bottoms
      const sideWallW = 6;
      for (let i = 0; i < COLLECTOR_BOX_COUNT; i++) {
        const { left, right, width } = collectorBoxEdges[i];
        MWorld.add(world, [
          Bodies.rectangle(left, derived.lastRowY + s.boxHeight / 2, sideWallW, s.boxHeight, { isStatic: true }),
          Bodies.rectangle(right, derived.lastRowY + s.boxHeight / 2, sideWallW, s.boxHeight, { isStatic: true }),
          Bodies.rectangle((left + right) / 2, derived.lastRowY + s.boxHeight, width, sideWallW, { isStatic: true }),
        ]);
      }
      MWorld.add(world, [
        Bodies.rectangle(collectorBoxEdges[0].left, derived.lastRowY + s.boxHeight / 2, sideWallW, s.boxHeight, { isStatic: true }),
        Bodies.rectangle(collectorBoxEdges[COLLECTOR_BOX_COUNT - 1].right, derived.lastRowY + s.boxHeight / 2, sideWallW, s.boxHeight, { isStatic: true }),
      ]);

      // Ball landing detection
      Matter.Events.on(engine, "beforeUpdate", () => {
        const cs = settingsRef.current;
        const cd = derivedRef.current;
        ballsMetaRef.current.forEach((meta) => {
          if (meta.removed) return;
          const vel = Math.sqrt(meta.body.velocity.x ** 2 + meta.body.velocity.y ** 2);
          for (let i = 0; i < COLLECTOR_BOX_COUNT; i++) {
            const { left, right } = collectorBoxEdges[i];
            const top = cd.lastRowY;
            const bottom = cd.lastRowY + cs.boxHeight;
            const isLastBox = i === COLLECTOR_BOX_COUNT - 1;
            const inX = isLastBox
              ? meta.body.position.x >= left && meta.body.position.x <= right
              : meta.body.position.x >= left && meta.body.position.x < right;
            const y = meta.body.position.y;
            const isInBox = inX && y >= top && y <= bottom;
            const isDeepInBox = inX && y >= top + cs.boxHeight * 0.45 && y <= bottom;

            if (isInBox && vel < 0.6) {
              meta.isWinning = true;
              meta.sinkIndex = i;
            }

            if (!meta.landed && isDeepInBox && vel < 0.25) {
              meta.isWinning = true;
              meta.sinkIndex = i;
              meta.landed = true;
              landedBallsRef.current++;

              if (!testModeRef.current && landedBallsRef.current >= expectedBallsRef.current && expectedBallsRef.current > 0) {
                let sum = 0;
                const values: number[] = [];
                ballsMetaRef.current.forEach((m) => {
                  if (m.isWinning && typeof m.sinkIndex === "number") {
                    const val = cs.boxValues[m.sinkIndex] || 0;
                    sum += val;
                    values.push(val);
                  }
                });
                const breakdown = values.length > 0 ? `${values.join("+")}=${sum}` : `${sum}`;
                setTimeout(() => onGameEndRef.current?.(sum, breakdown), 300);
                expectedBallsRef.current = 0;
                landedBallsRef.current = 0;
              }
            }
          }
          if (meta.body.position.y > cd.lastRowY + cs.boxHeight + 50 && !meta.isWinning) {
            Matter.World.remove(engine.world, meta.body);
            meta.removed = true;
          }
          if (!meta.landed && meta.removed) {
            meta.landed = true;
            landedBallsRef.current++;
            if (!testModeRef.current && landedBallsRef.current >= expectedBallsRef.current && expectedBallsRef.current > 0) {
              let sum = 0;
              const values: number[] = [];
              ballsMetaRef.current.forEach((m) => {
                if (m.isWinning && typeof m.sinkIndex === "number") {
                  const val = cs.boxValues[m.sinkIndex] || 0;
                  sum += val;
                  values.push(val);
                }
              });
              const breakdown = values.length > 0 ? `${values.join("+")}=${sum}` : `${sum}`;
              setTimeout(() => onGameEndRef.current?.(sum, breakdown), 300);
              expectedBallsRef.current = 0;
              landedBallsRef.current = 0;
            }
          }
        });
      });

      return () => {
        try { Matter.Engine.clear(engine); } catch {}
        engineRef.current = null;
      };
    }, [s, derived]);

    // ── Draw loop ──
    useEffect(() => {
      if (!dimensions) return;
      const walls = getWallGap(s, derived);
      const { edges: collectorBoxEdges, count: COLLECTOR_BOX_COUNT } = getCollectorBoxes(s, derived);

      let anim: number;
      function draw() {
        const engine = engineRef.current;
        if (!engine) { anim = requestAnimationFrame(draw); return; }
        try { Matter.Engine.update(engine, 1000 / 60); } catch {}

        const canvas = canvasRef.current;
        const ctx = canvas?.getContext("2d");
        if (!ctx || !canvas) { anim = requestAnimationFrame(draw); return; }

        const { scale, offsetX, offsetY, W, H } = renderRef.current;

        ctx.clearRect(0, 0, W, H);
        ctx.save();
        ctx.translate(offsetX, offsetY);
        ctx.scale(scale, scale);

        // Side walls
        ctx.fillStyle = "rgba(255,0,0,0.8)";
        ctx.fillRect(walls.leftWallX - derived.wallThickness / 2, 0, derived.wallThickness, derived.height);
        ctx.fillRect(walls.rightWallX - derived.wallThickness / 2, 0, derived.wallThickness, derived.height);

        // Pegs
        for (let row = 0; row < s.pegRows; row++) {
          for (let col = 0; col < s.pegsPerRow; col++) {
            const { x, y } = getPegXY(s, derived, row, col);
            if (x >= walls.leftWallX + s.ballRadius && x <= walls.rightWallX - s.ballRadius) {
              ctx.beginPath();
              const r = row === s.pegRows - 1 ? s.pegRadius * 0.5 : s.pegRadius;
              ctx.arc(x, y, r, 0, Math.PI * 2);
              ctx.fillStyle = "#fff";
              ctx.fill();
            }
          }
        }

        // Balls per box count
        const ballsPerBox = Array(COLLECTOR_BOX_COUNT).fill(0);
        ballsMetaRef.current.forEach((meta) => {
          if (meta.isWinning && typeof meta.sinkIndex === "number" && meta.sinkIndex >= 0 && meta.sinkIndex < COLLECTOR_BOX_COUNT) {
            ballsPerBox[meta.sinkIndex]++;
          }
        });

        // Collector boxes
        const fontValue = `bold ${s.fontValue}px Inter, sans-serif`;
        const fontCount = `bold ${s.fontCount}px Inter, sans-serif`;
        for (let i = 0; i < COLLECTOR_BOX_COUNT; i++) {
          const { left, right, width, center } = collectorBoxEdges[i];
          const top = derived.lastRowY;
          ctx.fillStyle = "#222";
          ctx.fillRect(left, top, width, s.boxHeight);
          ctx.strokeStyle = ACCENT_COLOR;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(left, top);
          ctx.lineTo(left, top + s.boxHeight);
          ctx.lineTo(right, top + s.boxHeight);
          ctx.lineTo(right, top);
          ctx.stroke();

          ctx.font = fontValue;
          ctx.textAlign = "center";
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = 3;
          ctx.strokeText(String(s.boxValues[i] ?? 0), center, top + s.boxHeight + 18);
          ctx.fillStyle = ACCENT_COLOR;
          ctx.fillText(String(s.boxValues[i] ?? 0), center, top + s.boxHeight + 18);

          if (ballsPerBox[i] > 0) {
            ctx.font = fontCount;
            ctx.strokeStyle = "#ffffff";
            ctx.lineWidth = 2;
            ctx.strokeText(`${ballsPerBox[i]}x`, center, top - 4);
            ctx.fillStyle = ACCENT_COLOR;
            ctx.fillText(`${ballsPerBox[i]}x`, center, top - 4);
          }
        }

        // Dotted dividers
        for (let i = 0; i < COLLECTOR_BOX_COUNT - 1; i++) {
          const { right } = collectorBoxEdges[i];
          ctx.strokeStyle = ACCENT_COLOR;
          ctx.lineWidth = 1.5;
          ctx.setLineDash([2, 3]);
          ctx.beginPath();
          ctx.moveTo(right, derived.lastRowY - 4);
          ctx.lineTo(right, derived.lastRowY + s.boxHeight + 24);
          ctx.stroke();
          ctx.setLineDash([]);
        }

        // Balls with glow
        ballsMetaRef.current.forEach((meta) => {
          if (meta.removed && !meta.isWinning) return;
          const { x, y } = meta.body.position;
          const nearBottom = y > derived.lastRowY - 30;
          if (!nearBottom) {
            const glowLayers = [
              { r: 50, a: 0.04 }, { r: 36, a: 0.07 },
              { r: 24, a: 0.12 }, { r: 14, a: 0.18 },
              { r: 6, a: 0.26 },
            ];
            ctx.fillStyle = ACCENT_COLOR;
            for (const layer of glowLayers) {
              ctx.beginPath();
              ctx.arc(x, y, s.ballRadius + layer.r, 0, Math.PI * 2);
              ctx.globalAlpha = layer.a;
              ctx.fill();
            }
            ctx.globalAlpha = 1;
          }
          ctx.beginPath();
          ctx.arc(x, y, s.ballRadius, 0, Math.PI * 2);
          ctx.fillStyle = ACCENT_COLOR;
          ctx.globalAlpha = 1;
          ctx.fill();
          ctx.strokeStyle = "#fff";
          ctx.lineWidth = 2;
          ctx.stroke();
        });

        // Preview balls
        const previewY = s.topMargin * 0.55;
        const previews = previewPositionsRef.current;
        if (previews.length > 0) {
          previews.forEach((px) => {
            ctx.beginPath();
            ctx.arc(px, previewY, s.ballRadius, 0, Math.PI * 2);
            ctx.fillStyle = ACCENT_COLOR;
            ctx.globalAlpha = 1;
            ctx.fill();
            ctx.strokeStyle = "#000";
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(px, previewY, s.ballRadius + 4, 0, Math.PI * 2);
            ctx.strokeStyle = ACCENT_COLOR;
            ctx.lineWidth = 1.5;
            ctx.globalAlpha = 0.4;
            ctx.stroke();
            ctx.globalAlpha = 1;
          });
        }

        ctx.restore();
        anim = requestAnimationFrame(draw);
      }
      draw();

      return () => { if (anim) cancelAnimationFrame(anim); };
    }, [dimensions, s, derived]);

    function dropBall(x: number) {
      if (!engineRef.current) return;
      const cs = settingsRef.current;
      const ball = Matter.Bodies.circle(x, cs.topMargin * 0.55, cs.ballRadius, {
        restitution: cs.restitution, friction: cs.friction, density: cs.density,
        collisionFilter: { group: -1 },
      });
      const meta: BallMeta = {
        id: nextBallId.current++,
        body: ball, removed: false, dropX: x,
      };
      ballsMetaRef.current.push(meta);
      Matter.World.add(engineRef.current.world, ball);
      return meta;
    }

    function clearBoard() {
      if (!engineRef.current) return;
      ballsMetaRef.current.forEach((meta) => {
        try { Matter.World.remove(engineRef.current!.world, meta.body); } catch {}
      });
      ballsMetaRef.current.length = 0;
      expectedBallsRef.current = 0;
      landedBallsRef.current = 0;
    }

    const testMappingRef = useRef<{ [dropX: number]: number }>({});
    const testCallbackRef = useRef<((mapping: { [dropX: number]: number }) => void) | null>(null);
    const testModeRef = useRef(false);
    const testInProgressRef = useRef(false);

    useImperativeHandle(ref, () => ({
      dropBalls: (positions: number[]) => {
        if (engineRef.current) {
          ballsMetaRef.current.forEach((meta) => {
            try { Matter.World.remove(engineRef.current!.world, meta.body); } catch {}
          });
          ballsMetaRef.current.length = 0;
        }
        expectedBallsRef.current = positions.length;
        landedBallsRef.current = 0;
        let dropped = 0;
        function dropNext() {
          if (dropped >= positions.length) return;
          const pos = positions[dropped];
          dropBall(pos);
          previewPositionsRef.current = previewPositionsRef.current.slice(1);
          setPreviewPositions(previewPositionsRef.current);
          dropped++;
          if (dropped < positions.length) setTimeout(dropNext, 500);
        }
        dropNext();
      },
      clearBoard: () => { clearBoard(); setPreviewPositions([]); },
      setPreviewPositions: (positions: number[]) => { setPreviewPositions(positions); },
      getPlayableRange: () => {
        const cs = settingsRef.current;
        const cd = derivedRef.current;
        const walls = getWallGap(cs, cd);
        return {
          min: walls.leftWallX + cd.wallThickness + cs.ballRadius,
          max: walls.rightWallX - cd.wallThickness - cs.ballRadius,
        };
      },
      pixelToNorm: (refX: number) => {
        const cs = settingsRef.current;
        const cd = derivedRef.current;
        const walls = getWallGap(cs, cd);
        const min = walls.leftWallX + cd.wallThickness + cs.ballRadius;
        const max = walls.rightWallX - cd.wallThickness - cs.ballRadius;
        return (refX - min) / (max - min);
      },
      normToPixel: (norm: number) => {
        const cs = settingsRef.current;
        const cd = derivedRef.current;
        const walls = getWallGap(cs, cd);
        const min = walls.leftWallX + cd.wallThickness + cs.ballRadius;
        const max = walls.rightWallX - cd.wallThickness - cs.ballRadius;
        return min + norm * (max - min);
      },
      getBoxValues: () => [...settingsRef.current.boxValues],
      startTestMode: (callbacks) => {
        if (!engineRef.current || testInProgressRef.current) return;
        const cs = settingsRef.current;
        const cd = derivedRef.current;

        const callbackSet = typeof callbacks === "function"
          ? { onComplete: callbacks }
          : callbacks;
        const onComplete = callbackSet?.onComplete || (() => {});
        const onProgress = callbackSet?.onProgress;
        const onError = callbackSet?.onError;

        const MAX_ATTEMPTS_PER_DROP = 3;
        const ROUND_TIMEOUT_MS = 20000;
        const DROP_INTERVAL_MS = 3;
        const walls = getWallGap(cs, cd);
        const { edges: collectorBoxEdges, count: COLLECTOR_BOX_COUNT } = getCollectorBoxes(cs, cd);

        const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

        const run = async () => {
          clearBoard();
          setPreviewPositions([]);
          testMappingRef.current = {};
          testCallbackRef.current = onComplete;
          testModeRef.current = true;
          testInProgressRef.current = true;

          const minX = Math.ceil(walls.leftWallX + cd.wallThickness + cs.ballRadius);
          const maxX = Math.floor(walls.rightWallX - cd.wallThickness - cs.ballRadius);
          const dropXs = Array.from({ length: maxX - minX + 1 }, (_, i) => minX + i);
          const total = dropXs.length;

          const mapped: { [dropX: number]: number } = {};
          const failedDropXs: Set<number> = new Set();
          const attempts: Record<number, number> = {};
          let pendingDropXs = [...dropXs];
          let retryCount = 0;

          onProgress?.({ processed: 0, total, mapped: 0, retryCount: 0 });

          while (pendingDropXs.length > 0) {
            clearBoard();
            const currentRound = [...pendingDropXs];
            pendingDropXs = [];
            expectedBallsRef.current = currentRound.length;
            landedBallsRef.current = 0;

            const roundBalls: Array<{ dropX: number; meta: BallMeta }> = [];
            for (const dropX of currentRound) {
              attempts[dropX] = (attempts[dropX] || 0) + 1;
              const meta = dropBall(dropX);
              if (meta) {
                roundBalls.push({ dropX, meta });
              }
              await sleep(DROP_INTERVAL_MS);
            }

            const roundStart = Date.now();
            await new Promise<void>((resolve) => {
              const check = () => {
                const allLanded = roundBalls.every(({ meta }) => meta.landed);
                const timedOut = Date.now() - roundStart > ROUND_TIMEOUT_MS;
                if (allLanded || timedOut) { resolve(); return; }
                setTimeout(check, 50);
              };
              check();
            });

            for (const { dropX, meta } of roundBalls) {
              const strictWin = (() => {
                if (!meta.isWinning || typeof meta.sinkIndex !== "number") return false;
                const boxIndex = meta.sinkIndex;
                const box = collectorBoxEdges[boxIndex];
                if (!box) return false;
                const top = cd.lastRowY;
                const bottom = cd.lastRowY + cs.boxHeight;
                const isLastBox = boxIndex === COLLECTOR_BOX_COUNT - 1;
                const x = meta.body.position.x;
                const y = meta.body.position.y;
                const inX = isLastBox ? x >= box.left && x <= box.right : x >= box.left && x < box.right;
                const inY = y >= top && y <= bottom;
                return inX && inY;
              })();

              if (strictWin && typeof meta.sinkIndex === "number") {
                mapped[dropX] = meta.sinkIndex + 1;
                continue;
              }

              if ((attempts[dropX] || 0) < MAX_ATTEMPTS_PER_DROP) {
                pendingDropXs.push(dropX);
                retryCount++;
              } else {
                failedDropXs.add(dropX);
              }
            }

            const processed = total - pendingDropXs.length;
            onProgress?.({ processed, total, mapped: Object.keys(mapped).length, retryCount });
          }

          if (failedDropXs.size > 0) {
            clearBoard();
            testModeRef.current = false;
            testInProgressRef.current = false;
            testCallbackRef.current = null;
            onError?.({
              message: `Test failed: ${failedDropXs.size} positions did not land in boxes.`,
              failedDropXs: Array.from(failedDropXs).sort((a, b) => a - b),
            });
            return;
          }

          testMappingRef.current = mapped;
          const mappings = Object.entries(mapped).map(([dx, box]) => ({
            dropX: parseInt(dx, 10),
            boxNumber: box,
          }));

          try {
            const response = await fetch("/api/admin/drop-mapping", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ mappings, testRunId: `simple_test_${Date.now()}` }),
            });
            if (!response.ok) {
              const payload = await response.json().catch(() => ({}));
              clearBoard();
              testModeRef.current = false;
              testInProgressRef.current = false;
              testCallbackRef.current = null;
              onError?.({
                message: response.status === 404
                  ? "API backend is not running (/api/admin/drop-mapping not found)"
                  : (payload?.error || "Failed to save mapping"),
                failedDropXs: [],
              });
              return;
            }
          } catch (error) {
            clearBoard();
            testModeRef.current = false;
            testInProgressRef.current = false;
            testCallbackRef.current = null;
            onError?.({ message: "Failed to save mapping", failedDropXs: [] });
            return;
          }

          clearBoard();
          testModeRef.current = false;
          testInProgressRef.current = false;
          testCallbackRef.current?.(mapped);
          testCallbackRef.current = null;
        };

        run().catch((error) => {
          console.error("Test mode execution failed:", error);
          clearBoard();
          testModeRef.current = false;
          testInProgressRef.current = false;
          testCallbackRef.current = null;
          onError?.({ message: "Unexpected test failure", failedDropXs: [] });
        });
      },
    }));

    const bgUrl = backgroundImage || '/pachinko4.png';
    const bgZ = bgAdjust?.zoom ?? 100;
    const bgX = bgAdjust?.x ?? 50;
    const bgY = bgAdjust?.y ?? 50;

    return (
      <div
        ref={containerRef}
        style={{
          width: "100%",
          height: "100%",
          position: "relative",
          overflow: "hidden",
          backgroundImage: `url('${bgUrl}')`,
          backgroundSize: `${bgZ}%`,
          backgroundPosition: `${bgX}% ${bgY}%`,
          backgroundRepeat: "no-repeat",
        }}
      >
        {dimensions && (
          <canvas
            ref={canvasRef}
            width={dimensions.w}
            height={dimensions.h}
            style={{ width: "100%", height: "100%", display: "block" }}
          />
        )}
      </div>
    );
  },
);

PlinkoSimple.displayName = "PlinkoSimple";

export default PlinkoSimple;
