import React, { useEffect, useState, useCallback } from "react";
import {
  SLOTS,
  type Remaining,
  loadRemaining,
  consumeActive,
  getActiveSlot,
  timeLeftMins,
  fmtCountdown,
} from "@/lib/gameSlots";

const NEON = "#22ff7a";
const NEON_DIM = "rgba(34,255,122,0.55)";
const PANEL_BG = "rgba(12, 6, 30, 0.92)";
const PANEL_BORDER = "rgba(34,255,122,0.18)";
const PURPLE_TEXT = "#cdb6ff";

function useNow(intervalMs = 30000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

export interface GameSlotsState {
  remainingBySlot: Remaining;
  activeIdx: number;
  minsLeft: number;
  consumeOne: () => void;
}

export function useGameSlots(): GameSlotsState {
  const now = useNow();
  const [remainingBySlot, setRemainingBySlot] = useState<Remaining>(() =>
    loadRemaining(),
  );

  useEffect(() => {
    setRemainingBySlot(loadRemaining(now));
  }, [now]);

  const consumeOne = useCallback(() => {
    setRemainingBySlot(consumeActive(new Date()));
  }, []);

  const { idx } = getActiveSlot(now);
  return {
    remainingBySlot,
    activeIdx: idx,
    minsLeft: timeLeftMins(now),
    consumeOne,
  };
}

interface FooterProps {
  onPrev: () => void;
  onNext: () => void;
  onPlay: () => void;
  onGuide: () => void;
  onMenu: () => void;
  onAccount: () => void;
  isLoggedIn: boolean;
  busy: boolean;
  slots: GameSlotsState;
}

export default function PachinkoFooter({
  onPrev,
  onNext,
  onPlay,
  onGuide,
  onMenu,
  onAccount,
  isLoggedIn,
  busy,
  slots,
}: FooterProps) {
  return (
    <div
      style={{
        flexShrink: 0,
        background: PANEL_BG,
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        paddingBottom: "max(16px, env(safe-area-inset-bottom))",
      }}
    >
      <GlowDivider />
      <CounterStrip slots={slots} />
      <div style={{ padding: "12px 14px 10px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "stretch",
            gap: 0,
            background: "rgba(255,255,255,0.04)",
            border: `1px solid ${PANEL_BORDER}`,
            borderRadius: 16,
            padding: 6,
            boxShadow:
              "inset 0 1px 0 rgba(255,255,255,0.05), 0 0 22px rgba(34,255,122,0.12)",
          }}
        >
          <BetStepper dir="down" disabled={busy} onClick={onPrev} />
          <div style={{ width: 1, background: PANEL_BORDER, margin: "6px 0" }} />
          <PlayCore onClick={onPlay} disabled={busy} isLoggedIn={isLoggedIn} />
          <div style={{ width: 1, background: PANEL_BORDER, margin: "6px 0" }} />
          <BetStepper dir="up" disabled={busy} onClick={onNext} />
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: 4,
            marginTop: 10,
          }}
        >
          <NavGhost icon={<BookIcon />} label="Mängujuhend" onClick={onGuide} />
          <NavGhost icon={<MenuIcon />} label="Menüü" onClick={onMenu} />
          <NavGhost icon={<UserIcon />} label="Konto" onClick={onAccount} />
        </div>
      </div>
    </div>
  );
}

function GlowDivider() {
  return (
    <div
      style={{
        height: 14,
        flexShrink: 0,
        background:
          "linear-gradient(180deg, rgba(34,255,122,0) 0%, rgba(34,255,122,0.18) 35%, rgba(34,255,122,0) 100%)",
        borderTop: `1px solid ${NEON_DIM}`,
        boxShadow: `0 -8px 24px -6px ${NEON_DIM}, 0 -1px 0 ${NEON_DIM}`,
        position: "relative",
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: -1,
          height: 1,
          background: `linear-gradient(90deg, transparent, ${NEON} 50%, transparent)`,
          filter: "blur(0.5px)",
          opacity: 0.85,
        }}
      />
    </div>
  );
}

function PlayCore({
  onClick,
  disabled,
  isLoggedIn,
}: {
  onClick: () => void;
  disabled: boolean;
  isLoggedIn: boolean;
}) {
  const label = isLoggedIn ? "MÄNGI" : "LOGI SISSE";
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        flex: 1,
        height: 52,
        border: "none",
        borderRadius: 12,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.55 : 1,
        background:
          "radial-gradient(ellipse at 50% 0%, rgba(95,255,159,0.55), transparent 60%), linear-gradient(180deg, #2bff86 0%, #1ed760 55%, #0fa544 100%)",
        boxShadow:
          "0 0 0 1.5px rgba(255,255,255,0.45) inset, 0 -2px 0 rgba(0,0,0,0.25) inset, 0 0 18px rgba(34,255,122,0.55), 0 0 38px rgba(34,255,122,0.45), 0 0 70px rgba(34,255,122,0.3)",
        color: "#022410",
        fontFamily: '"Space Grotesk", "Inter", system-ui, sans-serif',
        fontWeight: 800,
        letterSpacing: "0.14em",
        fontSize: 15,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        textShadow: "0 1px 0 rgba(255,255,255,0.35)",
        position: "relative",
        overflow: "hidden",
        transition: "opacity 0.15s",
      }}
    >
      <span
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 0,
          height: "45%",
          background:
            "linear-gradient(180deg, rgba(255,255,255,0.35), transparent)",
          pointerEvents: "none",
        }}
      />
      <span style={{ position: "relative", fontSize: 18 }}>{label}</span>
    </button>
  );
}

function BetStepper({
  dir,
  onClick,
  disabled,
}: {
  dir: "up" | "down";
  onClick: () => void;
  disabled: boolean;
}) {
  const isUp = dir === "up";
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={isUp ? "Järgmine paigutus" : "Eelmine paigutus"}
      style={{
        width: 56,
        background: "transparent",
        border: "none",
        cursor: disabled ? "default" : "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        opacity: disabled ? 0.3 : 1,
        color: PURPLE_TEXT,
      }}
    >
      {isUp ? <ArrowRightIcon /> : <ArrowLeftIcon />}
    </button>
  );
}

function NavGhost({
  icon,
  label,
  onClick,
  active,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 4,
        padding: "8px 4px",
        background: active ? "rgba(34,255,122,0.08)" : "transparent",
        border: `1px solid ${active ? NEON_DIM : "rgba(255,255,255,0.06)"}`,
        borderRadius: 10,
        color: active ? NEON : PURPLE_TEXT,
        fontFamily: '"Inter", system-ui, sans-serif',
        fontSize: 11,
        fontWeight: 500,
        letterSpacing: "0.02em",
        cursor: "pointer",
      }}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function CounterStrip({ slots }: { slots: GameSlotsState }) {
  const { activeIdx, remainingBySlot, minsLeft } = slots;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr 1fr",
        gap: 6,
        padding: "8px 14px 0",
      }}
    >
      {SLOTS.map((s, i) => {
        const remaining = remainingBySlot[s.id];
        const isActive = i === activeIdx;
        const isPast = activeIdx === -1 ? true : i < activeIdx;

        return (
          <div
            key={s.id}
            style={{
              position: "relative",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 6,
              padding: "6px 8px",
              borderRadius: 8,
              background: isActive
                ? "rgba(34,255,122,0.08)"
                : "rgba(255,255,255,0.025)",
              border: `1px solid ${
                isActive
                  ? NEON_DIM
                  : isPast
                    ? "rgba(255,255,255,0.04)"
                    : "rgba(255,255,255,0.08)"
              }`,
              boxShadow: isActive
                ? "0 0 14px rgba(34,255,122,0.25), inset 0 0 0 1px rgba(34,255,122,0.15)"
                : "none",
              opacity: isPast && remaining === 0 ? 0.42 : 1,
            }}
          >
            <div
              style={{
                fontFamily: "ui-monospace, Menlo, monospace",
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: "0.04em",
                color: isActive
                  ? NEON
                  : isPast
                    ? "rgba(205,182,255,0.5)"
                    : PURPLE_TEXT,
              }}
            >
              {s.label}
            </div>
            <DotPair count={remaining} active={isActive} past={isPast} />
          </div>
        );
      })}
      <ActiveStatusLine
        activeIdx={activeIdx}
        remainingBySlot={remainingBySlot}
        minsLeft={minsLeft}
      />
    </div>
  );
}

function DotPair({
  count,
  active,
  past,
}: {
  count: number;
  active: boolean;
  past: boolean;
}) {
  return (
    <div style={{ display: "flex", gap: 4 }}>
      {[0, 1].map((i) => {
        const filled = i < count;
        return (
          <span
            key={i}
            style={{
              width: 10,
              height: 10,
              borderRadius: "50%",
              background: filled
                ? active
                  ? "radial-gradient(circle at 35% 35%, #5fff9f, #1ed760 60%, #0a8c3a 100%)"
                  : past
                    ? "rgba(205,182,255,0.35)"
                    : "rgba(205,182,255,0.7)"
                : "transparent",
              border: filled
                ? "none"
                : `1.5px solid ${past ? "rgba(205,182,255,0.2)" : "rgba(205,182,255,0.35)"}`,
              boxShadow:
                filled && active
                  ? "0 0 6px rgba(34,255,122,0.9), 0 0 12px rgba(34,255,122,0.5)"
                  : "none",
              display: "inline-block",
            }}
          />
        );
      })}
    </div>
  );
}

function ActiveStatusLine({
  activeIdx,
  remainingBySlot,
  minsLeft,
}: {
  activeIdx: number;
  remainingBySlot: Remaining;
  minsLeft: number;
}) {
  if (activeIdx === -1) {
    return (
      <div style={statusLineStyle}>
        Päeva mängud läbi · uued mängud algavad{" "}
        <span style={{ color: NEON }}>06:00</span>
      </div>
    );
  }
  const slot = SLOTS[activeIdx];
  const remaining = remainingBySlot[slot.id];
  const closeAt = `${String(slot.to).padStart(2, "0")}:00`;
  const urgent = remaining > 0 && minsLeft < 60;

  if (remaining === 0) {
    return (
      <div style={{ ...statusLineStyle, color: "rgba(205,182,255,0.55)" }}>
        Selles vööndis mängud kasutatud · järgmine vöönd avaneb{" "}
        <span style={{ color: NEON }}>{closeAt}</span>
      </div>
    );
  }
  return (
    <div style={statusLineStyle}>
      <span style={{ color: NEON, fontWeight: 700 }}>{remaining}/2 mängu</span>
      <span style={{ opacity: 0.5 }}>·</span>
      <span style={{ color: urgent ? "#ffb47a" : PURPLE_TEXT }}>
        {urgent ? "⚠ " : ""}vöönd sulgub {closeAt} · jäänud{" "}
        {fmtCountdown(minsLeft)}
      </span>
    </div>
  );
}

const statusLineStyle: React.CSSProperties = {
  gridColumn: "1 / -1",
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
  gap: 6,
  padding: "6px 0 0",
  fontFamily: '"Inter", system-ui, sans-serif',
  fontSize: 11,
  color: PURPLE_TEXT,
  letterSpacing: "0.01em",
  flexWrap: "wrap",
  textAlign: "center",
};

function BookIcon() {
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 24 24"
      fill="none"
      stroke={PURPLE_TEXT}
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 5.5a2 2 0 0 1 2-2h12v17H6a2 2 0 0 0-2 2v-17z" />
      <path d="M8 7h7M8 11h7" />
    </svg>
  );
}

function MenuIcon() {
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 24 24"
      fill="none"
      stroke={PURPLE_TEXT}
      strokeWidth={1.8}
      strokeLinecap="round"
    >
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 24 24"
      fill="none"
      stroke={PURPLE_TEXT}
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx={12} cy={8} r={3.6} />
      <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
    </svg>
  );
}

function ArrowLeftIcon() {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill={PURPLE_TEXT}>
      <path d="M15 5l-8 7 8 7V5z" />
    </svg>
  );
}

function ArrowRightIcon() {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill={PURPLE_TEXT}>
      <path d="M9 5l8 7-8 7V5z" />
    </svg>
  );
}
