import { useEffect, useState, FormEvent } from "react";

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

interface AdminUser {
  id: number;
  phone: string;
  age: number | null;
  parcelLocker: string | null;
  isAdmin: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  totalGamesPlayed: number;
}

interface UserFormState {
  phone: string;
  password: string;
  age: string;
  parcelLocker: string;
  isAdmin: boolean;
}

const EMPTY_FORM: UserFormState = {
  phone: "",
  password: "",
  age: "",
  parcelLocker: "",
  isAdmin: false,
};

interface UsersAdminProps {
  onBack: () => void;
}

function formatDate(d: string | null): string {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("et-EE", { year: "numeric", month: "2-digit", day: "2-digit" });
  } catch {
    return d.slice(0, 10);
  }
}

export default function UsersAdmin({ onBack }: UsersAdminProps) {
  const [list, setList] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<UserFormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/users", { credentials: "include" });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || "Kasutajate laadimine ebaõnnestus");
        return;
      }
      setList(data.users || []);
    } catch {
      setError("Võrgu viga.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function startCreate() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setError(null);
    setShowForm(true);
  }

  function startEdit(u: AdminUser) {
    setEditingId(u.id);
    setForm({
      phone: u.phone,
      password: "",
      age: u.age == null ? "" : String(u.age),
      parcelLocker: u.parcelLocker ?? "",
      isAdmin: u.isAdmin,
    });
    setError(null);
    setShowForm(true);
  }

  function cancelForm() {
    setShowForm(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
    setError(null);
  }

  async function submitForm(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const body: any = {
        phone: form.phone,
        age: form.age === "" ? null : form.age,
        parcelLocker: form.parcelLocker || null,
        isAdmin: form.isAdmin,
      };
      if (form.password.length > 0) body.password = form.password;

      const url = editingId == null ? "/api/admin/users" : `/api/admin/users/${editingId}`;
      const method = editingId == null ? "POST" : "PUT";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || "Salvestamine ebaõnnestus");
        return;
      }
      cancelForm();
      await load();
    } catch {
      setError("Võrgu viga.");
    } finally {
      setSubmitting(false);
    }
  }

  async function deleteUser(u: AdminUser) {
    if (!window.confirm(`Kas oled kindel, et kustutada ${u.phone}?`)) return;
    try {
      const res = await fetch(`/api/admin/users/${u.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || "Kustutamine ebaõnnestus");
        return;
      }
      await load();
    } catch {
      setError("Võrgu viga.");
    }
  }

  return (
    <div
      style={{
        width: "100%",
        height: "100dvh",
        background: "#0a0a0a",
        display: "flex",
        flexDirection: "column",
        color: "#e5e5e5",
        fontFamily: "Inter, sans-serif",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "8px 12px",
          borderBottom: "1px solid #333",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexShrink: 0,
          gap: 8,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            onClick={onBack}
            style={{
              width: 28,
              height: 28,
              borderRadius: 6,
              border: "1px solid #444",
              background: "#222",
              color: "#fff",
              fontSize: 14,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            aria-label="Tagasi"
          >
            ▲
          </button>
          <span style={{ color: "#fff", fontSize: 14, fontWeight: 700 }}>Kasutajad</span>
          <span style={{ color: "#666", fontSize: 11 }}>({list.length})</span>
        </div>
        <button
          onClick={startCreate}
          style={{
            padding: "6px 12px",
            borderRadius: 8,
            border: "1px solid #4ade80",
            background: "transparent",
            color: "#4ade80",
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          + Uus kasutaja
        </button>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflow: "auto", padding: 8 }}>
        {error && (
          <div
            style={{
              fontSize: 12,
              color: "#f87171",
              background: "#2a1414",
              border: "1px solid #4a2020",
              borderRadius: 6,
              padding: "8px 10px",
              marginBottom: 8,
            }}
          >
            {error}
          </div>
        )}
        {loading ? (
          <div style={{ color: "#888", fontSize: 13, padding: 16 }}>Laen…</div>
        ) : list.length === 0 ? (
          <div style={{ color: "#888", fontSize: 13, padding: 16 }}>Kasutajaid pole.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {list.map((u) => (
              <div
                key={u.id}
                style={{
                  background: "#141414",
                  border: "1px solid #282828",
                  borderRadius: 8,
                  padding: 10,
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 600 }}>{u.phone}</span>
                    {u.isAdmin && (
                      <span
                        style={{
                          fontSize: 9,
                          background: "#4ade80",
                          color: "#0a0a0a",
                          padding: "1px 5px",
                          borderRadius: 3,
                          fontWeight: 700,
                          letterSpacing: 0.5,
                        }}
                      >
                        ADMIN
                      </span>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: 4 }}>
                    <button
                      onClick={() => startEdit(u)}
                      style={{
                        padding: "4px 8px",
                        borderRadius: 6,
                        border: "1px solid #444",
                        background: "transparent",
                        color: "#aaa",
                        fontSize: 11,
                        cursor: "pointer",
                      }}
                    >
                      Muuda
                    </button>
                    <button
                      onClick={() => deleteUser(u)}
                      style={{
                        padding: "4px 8px",
                        borderRadius: 6,
                        border: "1px solid #4a2020",
                        background: "transparent",
                        color: "#f87171",
                        fontSize: 11,
                        cursor: "pointer",
                      }}
                    >
                      Kustuta
                    </button>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 12, fontSize: 11, color: "#999", flexWrap: "wrap" }}>
                  <span>Vanus: {u.age ?? "—"}</span>
                  <span>Linn: {u.parcelLocker ?? "—"}</span>
                  <span>Loodud: {formatDate(u.createdAt)}</span>
                  <span>Viim. login: {formatDate(u.lastLoginAt)}</span>
                  <span>Mängitud: {u.totalGamesPlayed}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal form */}
      {showForm && (
        <div
          onClick={cancelForm}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.75)",
            zIndex: 1000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
        >
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={submitForm}
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
              maxHeight: "90vh",
              overflow: "auto",
            }}
          >
            <button
              type="button"
              onClick={cancelForm}
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

            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: "#4ade80", textAlign: "center" }}>
              {editingId == null ? "Uus kasutaja" : "Muuda kasutajat"}
            </h2>

            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 11, color: "#999" }}>Telefoninumber</span>
              <input
                type="tel"
                placeholder="5XXXXXXX või +3725XXXXXXX"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                disabled={submitting}
                required
                style={inputStyle}
              />
            </label>

            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 11, color: "#999" }}>
                Parool {editingId != null && <span style={{ color: "#666" }}>(tühi = ei muudeta)</span>}
              </span>
              <input
                type="password"
                placeholder={editingId == null ? "Vähemalt 6 tähemärki" : "Tühi = jätta samaks"}
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                disabled={submitting}
                required={editingId == null}
                style={inputStyle}
              />
            </label>

            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 11, color: "#999" }}>Vanus (valikuline)</span>
              <input
                type="number"
                min={0}
                max={130}
                value={form.age}
                onChange={(e) => setForm({ ...form, age: e.target.value })}
                disabled={submitting}
                style={inputStyle}
              />
            </label>

            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 11, color: "#999" }}>Linn (valikuline)</span>
              <select
                value={form.parcelLocker}
                onChange={(e) => setForm({ ...form, parcelLocker: e.target.value })}
                disabled={submitting}
                style={inputStyle}
              >
                <option value="">— Vali linn —</option>
                {ESTONIAN_CITIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>

            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
              <input
                type="checkbox"
                checked={form.isAdmin}
                onChange={(e) => setForm({ ...form, isAdmin: e.target.checked })}
                disabled={submitting}
              />
              <span>Admin</span>
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

            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                onClick={cancelForm}
                disabled={submitting}
                style={{
                  flex: 1,
                  background: "transparent",
                  color: "#aaa",
                  border: "1px solid #333",
                  borderRadius: 8,
                  padding: "10px 14px",
                  fontSize: 13,
                  cursor: "pointer",
                }}
              >
                Loobu
              </button>
              <button
                type="submit"
                disabled={submitting}
                style={{
                  flex: 1,
                  background: submitting ? "#1a1a1a" : "#059669",
                  color: "#fff",
                  border: "none",
                  borderRadius: 8,
                  padding: "10px 14px",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: submitting ? "not-allowed" : "pointer",
                }}
              >
                {submitting ? "Salvestan…" : editingId == null ? "Loo kasutaja" : "Salvesta"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  background: "#141414",
  border: "1px solid #282828",
  borderRadius: 6,
  padding: "10px 12px",
  color: "#e5e5e5",
  fontSize: 14,
  outline: "none",
};
