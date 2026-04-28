import { useEffect, useState, FormEvent } from "react";
import { useAuth } from "@/App";

const ESTONIAN_CITIES = [
  "Tallinn",
  "Tartu",
  "Pärnu",
  "Narva",
  "Kohtla-Järve",
  "Viljandi",
  "Rakvere",
  "Maardu",
  "Kuressaare",
  "Sillamäe",
  "Valga",
  "Võru",
  "Jõhvi",
  "Haapsalu",
  "Paide",
  "Keila",
];

interface UserProfileModalProps {
  onClose: () => void;
}

export default function UserProfileModal({ onClose }: UserProfileModalProps) {
  const { user, setUser, logout } = useAuth();
  const [age, setAge] = useState<string>("");
  const [city, setCity] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/me", { credentials: "include" })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled || !data?.user) return;
        setAge(data.user.age == null ? "" : String(data.user.age));
        setCity(data.user.parcelLocker || "");
      })
      .catch(() => {
        /* ignore */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    setSaving(true);
    try {
      const res = await fetch("/api/auth/me", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          age: age === "" ? null : Number.parseInt(age, 10),
          parcelLocker: city || null,
        }),
      });
      let data: any = null;
      try {
        data = await res.json();
      } catch {
        setError("Server ei vastanud korralikult.");
        return;
      }
      if (!res.ok) {
        setError(data?.error || "Salvestamine ebaõnnestus");
        return;
      }
      if (data?.user) setUser(data.user);
      setSuccess(true);
    } catch {
      setError("Võrgu viga.");
    } finally {
      setSaving(false);
    }
  }

  async function handleLogout() {
    await logout();
    onClose();
  }

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
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSave}
        style={{
          background: "#111",
          border: "1px solid #333",
          borderRadius: 12,
          padding: 24,
          width: "100%",
          maxWidth: 360,
          display: "flex",
          flexDirection: "column",
          gap: 12,
          position: "relative",
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
            fontSize: 20,
            fontWeight: 600,
            textAlign: "center",
            color: "#4ade80",
          }}
        >
          Konto
        </h2>

        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 11, color: "#999" }}>Telefon</span>
          <input
            type="tel"
            value={user?.phone ?? ""}
            disabled
            style={{
              background: "#0c0c0c",
              border: "1px solid #222",
              borderRadius: 6,
              padding: "10px 12px",
              color: "#888",
              fontSize: 14,
              outline: "none",
            }}
          />
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 11, color: "#999" }}>Vanus</span>
          <input
            type="number"
            min={0}
            max={130}
            value={age}
            onChange={(e) => setAge(e.target.value)}
            disabled={saving}
            style={{
              background: "#141414",
              border: "1px solid #282828",
              borderRadius: 6,
              padding: "10px 12px",
              color: "#e5e5e5",
              fontSize: 14,
              outline: "none",
            }}
          />
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 11, color: "#999" }}>Linn</span>
          <select
            value={city}
            onChange={(e) => setCity(e.target.value)}
            disabled={saving}
            style={{
              background: "#141414",
              border: "1px solid #282828",
              borderRadius: 6,
              padding: "10px 12px",
              color: "#e5e5e5",
              fontSize: 14,
              outline: "none",
            }}
          >
            <option value="">— Vali linn —</option>
            {ESTONIAN_CITIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>

        {error && (
          <div
            style={{
              fontSize: 12,
              color: "#f87171",
              background: "#2a1414",
              border: "1px solid #4a2020",
              borderRadius: 6,
              padding: "8px 10px",
            }}
          >
            {error}
          </div>
        )}
        {success && !error && (
          <div
            style={{
              fontSize: 12,
              color: "#4ade80",
              background: "#0e2a1c",
              border: "1px solid #1f4a30",
              borderRadius: 6,
              padding: "8px 10px",
            }}
          >
            Salvestatud
          </div>
        )}

        <button
          type="submit"
          disabled={saving}
          style={{
            background: saving ? "#1a1a1a" : "#059669",
            color: "#fff",
            border: "none",
            borderRadius: 8,
            padding: "12px 16px",
            fontSize: 14,
            fontWeight: 600,
            cursor: saving ? "not-allowed" : "pointer",
            transition: "all 0.2s",
          }}
        >
          {saving ? "Salvestan…" : "Salvesta"}
        </button>

        <button
          type="button"
          onClick={handleLogout}
          style={{
            background: "transparent",
            color: "#f87171",
            border: "1px solid #4a2020",
            borderRadius: 8,
            padding: "10px 16px",
            fontSize: 13,
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          Logi välja
        </button>
      </form>
    </div>
  );
}
