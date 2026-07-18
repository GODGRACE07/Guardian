import { ReactNode } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Redirect } from 'wouter';

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { walletAddress } = useAuth();

  if (!walletAddress) {
    return <Redirect to="/auth" />;
  }

  return <>{children}</>;
}
