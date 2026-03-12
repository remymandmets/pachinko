import React, {
  useRef,
  useEffect,
  useState,
  forwardRef,
  useImperativeHandle,
} from "react";
import * as Matter from "matter-js";

// ── Reference design (FIXED — physics always runs at these coords) ──
const REF_WIDTH = 450;
const REF_BALL_RADIUS = 16;
const REF_PEG_RADIUS = 2;
const REF_BOX_HEIGHT = 40;
const REF_TOP_MARGIN = 90;
const REF_BOTTOM_MARGIN = 30;
const REF_FONT_VALUE = 20;
const REF_FONT_COUNT = 14;
const REF_WALL_THICKNESS_MULT = 2.0;

// ── Fixed grid dimensions (same on every screen) ──
const PEGS_PER_ROW = 13;
const PEG_ROWS = 19;
const REF_SPACING = (REF_WIDTH - 2 * REF_BALL_RADIUS) / (PEGS_PER_ROW - 1);
const REF_HEIGHT = REF_TOP_MARGIN + (PEG_ROWS - 1) * REF_SPACING + REF_BOX_HEIGHT + REF_BOTTOM_MARGIN;

const gravity = 1.2;
const restitution = 0.7;
const friction = 0;
const density = 5.05;
const ACCENT_COLOR = "#059669";

const DEFAULT_BOX_VALUES = [
  0, 1, 3, 7, 14, 20, 24, 28, 31, 33, 34, 35
];

// ── Precompute FIXED reference layout (never changes) ──
const REF_BALL = REF_BALL_RADIUS;
const REF_WALL_THICKNESS = REF_BALL * REF_WALL_THICKNESS_MULT;
const REF_LAST_ROW_Y = REF_TOP_MARGIN + (PEG_ROWS - 1) * REF_SPACING;

function getRefWallGap(wallGap: number) {
  const gap = REF_BALL * wallGap;
  const leftmostPegX = REF_BALL;
  const rightmostPegX = REF_BALL + (PEGS_PER_ROW - 1) * REF_SPACING;
  const leftWallX = leftmostPegX - gap - REF_WALL_THICKNESS / 2;
  const rightWallX = rightmostPegX + gap + REF_WALL_THICKNESS / 2;
  return { leftWallX, rightWallX };
}

function getRefPegXY(row: number, col: number) {
  const pegOffsetX = row % 2 === 1 ? REF_SPACING / 2 : 0;
  return {
    x: REF_BALL + col * REF_SPACING + pegOffsetX,
    y: REF_TOP_MARGIN + row * REF_SPACING,
  };
}

function getRefCollectorBoxes(wallGap: number) {
  const bottomPegXs = Array.from({ length: PEGS_PER_ROW }, (_, i) => {
    const pegOffsetX = (PEG_ROWS - 1) % 2 === 1 ? REF_SPACING / 2 : 0;
    return REF_BALL + i * REF_SPACING + pegOffsetX;
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

interface PlinkoSimpleProps {
  onGameEnd?: (totalScore: number, breakdown: string) => void;
  wallGap?: number;
}

const PlinkoSimple = forwardRef<PlinkoSimpleRef, PlinkoSimpleProps>(
  ({ onGameEnd, wallGap = 1.0 }, ref) => {
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
    // Render info (changes with screen size, NOT physics)
    const renderRef = useRef<{ scale: number; offsetX: number; offsetY: number; W: number; H: number }>({
      scale: 1, offsetX: 0, offsetY: 0, W: REF_WIDTH, H: REF_HEIGHT,
    });

    const [dimensions, setDimensions] = useState<{ w: number; h: number } | null>(null);

    useEffect(() => { onGameEndRef.current = onGameEnd; }, [onGameEnd]);
    useEffect(() => { previewPositionsRef.current = previewPositions; }, [previewPositions]);

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

    // Update render transform when dimensions change (NO physics rebuild)
    useEffect(() => {
      if (!dimensions) return;
      const { w: W, h: H } = dimensions;
      const scale = W / REF_WIDTH; // always fill width edge-to-edge
      const boardH = REF_HEIGHT * scale;
      renderRef.current = {
        scale,
        offsetX: 0,
        offsetY: Math.max(0, (H - boardH) / 2),
        W, H,
      };
    }, [dimensions]);

    // Build physics world ONCE (at reference coords), rebuild only when wallGap changes
    useEffect(() => {
      const { leftWallX, rightWallX } = getRefWallGap(wallGap);
      const { edges: collectorBoxEdges, count: COLLECTOR_BOX_COUNT } = getRefCollectorBoxes(wallGap);

      const MWorld = Matter.World;
      const Bodies = Matter.Bodies;
      const engine = Matter.Engine.create();
      engine.gravity.y = gravity;
      engineRef.current = engine;
      const world = engine.world;
      ballsMetaRef.current = [];

      // Pegs (reference coords)
      for (let row = 0; row < PEG_ROWS; row++) {
        for (let col = 0; col < PEGS_PER_ROW; col++) {
          const { x, y } = getRefPegXY(row, col);
          if (x >= leftWallX + REF_BALL && x <= rightWallX - REF_BALL) {
            MWorld.add(world, Bodies.circle(x, y, REF_PEG_RADIUS, {
              isStatic: true, restitution: 0.9, friction: 0.01,
            }));
          }
        }
      }

      // Side walls
      MWorld.add(world, [
        Bodies.rectangle(leftWallX, REF_HEIGHT / 2, REF_WALL_THICKNESS, REF_HEIGHT, { isStatic: true }),
        Bodies.rectangle(rightWallX, REF_HEIGHT / 2, REF_WALL_THICKNESS, REF_HEIGHT, { isStatic: true }),
      ]);

      // Collector box walls + bottoms
      const sideWallW = 6;
      for (let i = 0; i < COLLECTOR_BOX_COUNT; i++) {
        const { left, right, width } = collectorBoxEdges[i];
        MWorld.add(world, [
          Bodies.rectangle(left, REF_LAST_ROW_Y + REF_BOX_HEIGHT / 2, sideWallW, REF_BOX_HEIGHT, { isStatic: true }),
          Bodies.rectangle(right, REF_LAST_ROW_Y + REF_BOX_HEIGHT / 2, sideWallW, REF_BOX_HEIGHT, { isStatic: true }),
          Bodies.rectangle((left + right) / 2, REF_LAST_ROW_Y + REF_BOX_HEIGHT, width, sideWallW, { isStatic: true }),
        ]);
      }
      MWorld.add(world, [
        Bodies.rectangle(collectorBoxEdges[0].left, REF_LAST_ROW_Y + REF_BOX_HEIGHT / 2, sideWallW, REF_BOX_HEIGHT, { isStatic: true }),
        Bodies.rectangle(collectorBoxEdges[COLLECTOR_BOX_COUNT - 1].right, REF_LAST_ROW_Y + REF_BOX_HEIGHT / 2, sideWallW, REF_BOX_HEIGHT, { isStatic: true }),
      ]);

      // ── Ball landing detection (all in reference coords) ──
      Matter.Events.on(engine, "beforeUpdate", () => {
        ballsMetaRef.current.forEach((meta) => {
          if (meta.removed) return;
          const vel = Math.sqrt(meta.body.velocity.x ** 2 + meta.body.velocity.y ** 2);
          for (let i = 0; i < COLLECTOR_BOX_COUNT; i++) {
            const { left, right } = collectorBoxEdges[i];
            const top = REF_LAST_ROW_Y;
            const bottom = REF_LAST_ROW_Y + REF_BOX_HEIGHT;
            const isLastBox = i === COLLECTOR_BOX_COUNT - 1;
            const inX = isLastBox
              ? meta.body.position.x >= left && meta.body.position.x <= right
              : meta.body.position.x >= left && meta.body.position.x < right;
            const y = meta.body.position.y;
            const isInBox = inX && y >= top && y <= bottom;
            const isDeepInBox = inX && y >= top + REF_BOX_HEIGHT * 0.45 && y <= bottom;

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
                    const val = DEFAULT_BOX_VALUES[m.sinkIndex] || 0;
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
          if (meta.body.position.y > REF_LAST_ROW_Y + REF_BOX_HEIGHT + 50 && !meta.isWinning) {
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
                  const val = DEFAULT_BOX_VALUES[m.sinkIndex] || 0;
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
    }, [wallGap]);

    // ── Draw loop (separate from physics, uses renderRef for scaling) ──
    useEffect(() => {
      if (!dimensions) return;
      const { leftWallX, rightWallX } = getRefWallGap(wallGap);
      const { edges: collectorBoxEdges, count: COLLECTOR_BOX_COUNT } = getRefCollectorBoxes(wallGap);

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

        // Pegs
        for (let row = 0; row < PEG_ROWS; row++) {
          for (let col = 0; col < PEGS_PER_ROW; col++) {
            const { x, y } = getRefPegXY(row, col);
            if (x >= leftWallX + REF_BALL && x <= rightWallX - REF_BALL) {
              ctx.beginPath();
              const r = row === PEG_ROWS - 1 ? REF_PEG_RADIUS * 0.5 : REF_PEG_RADIUS;
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
        const fontValue = `bold ${REF_FONT_VALUE}px Inter, sans-serif`;
        const fontCount = `bold ${REF_FONT_COUNT}px Inter, sans-serif`;
        for (let i = 0; i < COLLECTOR_BOX_COUNT; i++) {
          const { left, right, width, center } = collectorBoxEdges[i];
          const top = REF_LAST_ROW_Y;
          ctx.fillStyle = "#222";
          ctx.fillRect(left, top, width, REF_BOX_HEIGHT);
          ctx.strokeStyle = ACCENT_COLOR;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(left, top);
          ctx.lineTo(left, top + REF_BOX_HEIGHT);
          ctx.lineTo(right, top + REF_BOX_HEIGHT);
          ctx.lineTo(right, top);
          ctx.stroke();

          ctx.font = fontValue;
          ctx.textAlign = "center";
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = 3;
          ctx.strokeText(String(DEFAULT_BOX_VALUES[i]), center, top + REF_BOX_HEIGHT + 18);
          ctx.fillStyle = ACCENT_COLOR;
          ctx.fillText(String(DEFAULT_BOX_VALUES[i]), center, top + REF_BOX_HEIGHT + 18);

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
          ctx.moveTo(right, REF_LAST_ROW_Y - 4);
          ctx.lineTo(right, REF_LAST_ROW_Y + REF_BOX_HEIGHT + 24);
          ctx.stroke();
          ctx.setLineDash([]);
        }

        // Balls with glow (positions from physics are already in ref coords)
        ballsMetaRef.current.forEach((meta) => {
          if (meta.removed && !meta.isWinning) return;
          const { x, y } = meta.body.position;
          const nearBottom = y > REF_LAST_ROW_Y - 30;
          if (!nearBottom) {
            const glowLayers = [
              { r: 50, a: 0.04 }, { r: 36, a: 0.07 },
              { r: 24, a: 0.12 }, { r: 14, a: 0.18 },
              { r: 6, a: 0.26 },
            ];
            ctx.fillStyle = ACCENT_COLOR;
            for (const layer of glowLayers) {
              ctx.beginPath();
              ctx.arc(x, y, REF_BALL + layer.r, 0, Math.PI * 2);
              ctx.globalAlpha = layer.a;
              ctx.fill();
            }
            ctx.globalAlpha = 1;
          }
          ctx.beginPath();
          ctx.arc(x, y, REF_BALL, 0, Math.PI * 2);
          ctx.fillStyle = ACCENT_COLOR;
          ctx.globalAlpha = 1;
          ctx.fill();
          ctx.strokeStyle = "#fff";
          ctx.lineWidth = 2;
          ctx.stroke();
        });

        // Preview balls (positions are in ref coords)
        const previewY = REF_TOP_MARGIN * 0.55;
        const previews = previewPositionsRef.current;
        if (previews.length > 0) {
          previews.forEach((px) => {
            ctx.beginPath();
            ctx.arc(px, previewY, REF_BALL, 0, Math.PI * 2);
            ctx.fillStyle = ACCENT_COLOR;
            ctx.globalAlpha = 1;
            ctx.fill();
            ctx.strokeStyle = "#000";
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(px, previewY, REF_BALL + 4, 0, Math.PI * 2);
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
    }, [dimensions, wallGap]);

    // All positions below are in REFERENCE coords (fixed, same on every screen)

    function dropBall(x: number) {
      if (!engineRef.current) return;
      const ball = Matter.Bodies.circle(x, REF_TOP_MARGIN * 0.55, REF_BALL, {
        restitution, friction, density,
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

    // Test mode refs
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
      // All ranges/positions in REFERENCE coords
      getPlayableRange: () => {
        const { leftWallX, rightWallX } = getRefWallGap(wallGap);
        return {
          min: leftWallX + REF_WALL_THICKNESS + REF_BALL,
          max: rightWallX - REF_WALL_THICKNESS - REF_BALL,
        };
      },
      pixelToNorm: (refX: number) => {
        const { leftWallX, rightWallX } = getRefWallGap(wallGap);
        const min = leftWallX + REF_WALL_THICKNESS + REF_BALL;
        const max = rightWallX - REF_WALL_THICKNESS - REF_BALL;
        return (refX - min) / (max - min);
      },
      normToPixel: (norm: number) => {
        const { leftWallX, rightWallX } = getRefWallGap(wallGap);
        const min = leftWallX + REF_WALL_THICKNESS + REF_BALL;
        const max = rightWallX - REF_WALL_THICKNESS - REF_BALL;
        return min + norm * (max - min);
      },
      getBoxValues: () => [...DEFAULT_BOX_VALUES],
      startTestMode: (callbacks) => {
        if (!engineRef.current || testInProgressRef.current) return;

        const callbackSet = typeof callbacks === "function"
          ? { onComplete: callbacks }
          : callbacks;
        const onComplete = callbackSet?.onComplete || (() => {});
        const onProgress = callbackSet?.onProgress;
        const onError = callbackSet?.onError;

        const MAX_ATTEMPTS_PER_DROP = 3;
        const ROUND_TIMEOUT_MS = 20000;
        const DROP_INTERVAL_MS = 3;
        const { leftWallX, rightWallX } = getRefWallGap(wallGap);
        const { edges: collectorBoxEdges, count: COLLECTOR_BOX_COUNT } = getRefCollectorBoxes(wallGap);

        const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

        const run = async () => {
          clearBoard();
          setPreviewPositions([]);
          testMappingRef.current = {};
          testCallbackRef.current = onComplete;
          testModeRef.current = true;
          testInProgressRef.current = true;

          const minX = Math.ceil(leftWallX + REF_WALL_THICKNESS + REF_BALL);
          const maxX = Math.floor(rightWallX - REF_WALL_THICKNESS - REF_BALL);
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
                const top = REF_LAST_ROW_Y;
                const bottom = REF_LAST_ROW_Y + REF_BOX_HEIGHT;
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

    return (
      <div
        ref={containerRef}
        style={{
          width: "100%",
          height: "100%",
          position: "relative",
          overflow: "hidden",
          background: `url('/pachinko4.png') center center / cover no-repeat`,
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
