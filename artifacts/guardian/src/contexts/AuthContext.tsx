import React, { createContext, useContext, useState, useCallback } from 'react';

// Persisted within the browser tab session (cleared on tab close)
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
  // Initialise from sessionStorage so the user stays logged in on refresh
  // within the same tab session without re-connecting MetaMask every time.
  const [session, setSession] = useState<WalletSession | null>(() => {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      return raw ? (JSON.parse(raw) as WalletSession) : null;
    } catch {
      return null;
    }
  });

  const setWalletSession = useCallback((address: string, userId: string) => {
    const s: WalletSession = { walletAddress: address, userId };
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
    setSession(s);
  }, []);

  const clearWalletSession = useCallback(() => {
    sessionStorage.removeItem(SESSION_KEY);
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
