import React, { createContext, useContext, useState, useCallback } from 'react';

// Persisted in localStorage so the session survives page refreshes, tab
// closes, and browser restarts.  The user is only logged out when they
// explicitly tap "Sign Out", which calls clearWalletSession().
const SESSION_KEY = 'guardian_wallet_session';

interface WalletSession {
  walletAddress: string;
  userId: string; // Supabase users.id (UUID)
}

interface AuthContextType {
  walletAddress: string | null;
  userId: string | null;
  isLoading: boolean;
  setWalletSession: (address: string, userId: string) => void;
  clearWalletSession: () => void;
}

const AuthContext = createContext<AuthContextType>({
  walletAddress: null,
  userId: null,
  isLoading: false,
  setWalletSession: () => {},
  clearWalletSession: () => {},
});

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  // Read from localStorage on first render so any existing session is
  // immediately available — no wallet reconnect required after a page reload.
  const [session, setSession] = useState<WalletSession | null>(() => {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      return raw ? (JSON.parse(raw) as WalletSession) : null;
    } catch {
      return null;
    }
  });

  const setWalletSession = useCallback((address: string, userId: string) => {
    const s: WalletSession = { walletAddress: address, userId };
    localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    setSession(s);
  }, []);

  const clearWalletSession = useCallback(() => {
    localStorage.removeItem(SESSION_KEY);
    setSession(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        walletAddress: session?.walletAddress ?? null,
        userId: session?.userId ?? null,
        isLoading: false,
        setWalletSession,
        clearWalletSession,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
