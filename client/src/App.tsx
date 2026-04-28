import { useEffect, useState, useCallback, createContext, useContext } from "react";
import SimpleGame from "@/pages/SimpleGame";
import LoginModal from "@/pages/LoginPage";

export interface AuthUser {
  id: number;
  phone: string;
  isAdmin: boolean;
}

interface AuthContextValue {
  user: AuthUser | null;
  setUser: (user: AuthUser | null) => void;
  logout: () => Promise<void>;
  showLogin: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

function App() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [bootLoaded, setBootLoaded] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/me", { credentials: "include" })
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setUser(data?.user || null);
      })
      .catch(() => {
        if (!cancelled) setUser(null);
      })
      .finally(() => {
        if (!cancelled) setBootLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const logout = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    } catch {
      /* ignore */
    }
    setUser(null);
  }, []);

  const showLogin = useCallback(() => setLoginOpen(true), []);
  const handleLoggedIn = useCallback((u: AuthUser) => {
    setUser(u);
    setLoginOpen(false);
  }, []);

  if (!bootLoaded) {
    return (
      <div
        style={{
          minHeight: "100vh",
          background: "#0a0a0a",
          color: "#888",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "Inter, sans-serif",
          fontSize: 13,
        }}
      >
        Laen…
      </div>
    );
  }

  return (
    <AuthContext.Provider value={{ user, setUser, logout, showLogin }}>
      <SimpleGame />
      {loginOpen && (
        <LoginModal onLoggedIn={handleLoggedIn} onClose={() => setLoginOpen(false)} />
      )}
    </AuthContext.Provider>
  );
}

export default App;
