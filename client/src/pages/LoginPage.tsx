import { useState, FormEvent } from "react";

interface LoginPageProps {
  onLoggedIn: (user: { id: number; phone: string; isAdmin: boolean }) => void;
}

export default function LoginPage({ onLoggedIn }: LoginPageProps) {
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ phone, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || "Sisselogimine ebaõnnestus");
        return;
      }
      onLoggedIn(data.user);
    } catch (err) {
      setError("Võrgu viga. Proovi uuesti.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0a0a0a",
        color: "#e5e5e5",
        fontFamily: "Inter, sans-serif",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          background: "#111",
          border: "1px solid #333",
          borderRadius: 12,
          padding: 28,
          width: "100%",
          maxWidth: 360,
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <h1
          style={{
            margin: 0,
            fontSize: 22,
            fontWeight: 600,
            textAlign: "center",
            color: "#4ade80",
          }}
        >
          Õnnekuul
        </h1>
        <p style={{ margin: 0, fontSize: 12, color: "#888", textAlign: "center" }}>
          Logi sisse, et mängida
        </p>

        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 11, color: "#999" }}>Telefoninumber</span>
          <input
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="5XXXXXXX või +3725XXXXXXX"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            disabled={loading}
            required
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
          <span style={{ fontSize: 11, color: "#999" }}>Parool</span>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={loading}
            required
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

        <button
          type="submit"
          disabled={loading}
          style={{
            background: loading ? "#1a1a1a" : "#059669",
            color: "#fff",
            border: "none",
            borderRadius: 8,
            padding: "12px 16px",
            fontSize: 14,
            fontWeight: 600,
            cursor: loading ? "not-allowed" : "pointer",
            transition: "all 0.2s",
          }}
        >
          {loading ? "Sisse logimas…" : "Logi sisse"}
        </button>
      </form>
    </div>
  );
}
