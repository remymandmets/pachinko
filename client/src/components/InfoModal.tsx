import { ReactNode } from "react";

interface InfoModalProps {
  title: string;
  onClose: () => void;
  children?: ReactNode;
}

export default function InfoModal({ title, onClose, children }: InfoModalProps) {
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.75)",
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        fontFamily: "Inter, sans-serif",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#111",
          border: "1px solid #333",
          borderRadius: 12,
          padding: 24,
          width: "100%",
          maxWidth: 360,
          position: "relative",
          color: "#e5e5e5",
        }}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Sulge"
          style={{
            position: "absolute",
            top: 8,
            right: 8,
            width: 28,
            height: 28,
            border: "none",
            background: "transparent",
            color: "#888",
            fontSize: 20,
            cursor: "pointer",
            lineHeight: 1,
          }}
        >
          ×
        </button>
        <h2
          style={{
            margin: 0,
            marginBottom: 14,
            fontSize: 18,
            fontWeight: 600,
            textAlign: "center",
            color: "#4ade80",
          }}
        >
          {title}
        </h2>
        <div style={{ fontSize: 13, color: "#aaa", lineHeight: 1.5 }}>
          {children ?? <p style={{ margin: 0, textAlign: "center" }}>Sisu lisame peagi.</p>}
        </div>
      </div>
    </div>
  );
}
