import { useState } from 'react';
import { useLocation } from 'wouter';
import { ShieldCheck, Loader2, Wallet } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { connectWallet, signMessage, SIGN_IN_MESSAGE } from '@/lib/wallet';

type Step = 'idle' | 'connecting' | 'signing' | 'verifying';

const STEP_LABELS: Record<Step, string> = {
  idle: 'Connect Wallet',
  connecting: 'Connecting…',
  signing: 'Sign the message in MetaMask…',
  verifying: 'Verifying…',
};

export default function AuthPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { setWalletSession } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [step, setStep] = useState<Step>('idle');

  const handleConnect = async () => {
    setIsLoading(true);
    try {
      // 1 — Request wallet access
      setStep('connecting');
      const address = await connectWallet();

      // 2 — Prove ownership with a free off-chain signature
      setStep('signing');
      await signMessage(address, SIGN_IN_MESSAGE);

      // 3 — Look up or create the user row in Supabase
      setStep('verifying');

      const { data: existing, error: lookupError } = await supabase
        .from('users')
        .select('id')
        .eq('wallet_address', address)
        .maybeSingle();

      if (lookupError) throw lookupError;

      let userId: string;

      if (existing) {
        userId = existing.id;
      } else {
        const { data: created, error: insertError } = await supabase
          .from('users')
          .insert({ wallet_address: address })
          .select('id')
          .single();
        if (insertError) throw insertError;
        userId = created.id;
      }

      // Persist the session for the lifetime of this tab
      setWalletSession(address, userId);

      // 4 — Route based on whether an active OKX connection already exists
      const { data: connection } = await supabase
        .from('okx_connections')
        .select('id')
        .eq('user_id', userId)
        .eq('active', true)
        .maybeSingle();

      setLocation(connection ? '/connected' : '/connect-okx');
    } catch (error: unknown) {
      const err = error as { code?: number; message?: string };
      // MetaMask user rejection code
      const isRejection = err.code === 4001;
      toast({
        variant: 'destructive',
        title: isRejection ? 'Signature cancelled' : 'Connection failed',
        description: isRejection
          ? 'Please approve the sign-in request in your wallet to continue.'
          : (err.message ?? 'Something went wrong. Please try again.'),
      });
    } finally {
      setIsLoading(false);
      setStep('idle');
    }
  };

  return (
    <div
      className="min-h-[100dvh] flex flex-col items-center justify-center p-6 bg-background"
      data-testid="page-auth"
    >
      <div className="w-full max-w-[380px] flex flex-col items-center gap-10">

        {/* Brand mark */}
        <div className="flex flex-col items-center gap-3">
          <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center">
            <ShieldCheck className="w-9 h-9 text-primary" />
          </div>
          <div className="text-center">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              Guardian
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Portfolio protection for OKX
            </p>
          </div>
        </div>

        {/* Connect card */}
        <div className="w-full bg-card border border-card-border rounded-2xl p-8 flex flex-col items-center gap-6">
          <div className="text-center space-y-1">
            <h2 className="text-lg font-medium text-foreground">
              Sign in with your wallet
            </h2>
          </div>

          <Button
            onClick={handleConnect}
            disabled={isLoading}
            className="w-full h-12 text-base font-medium bg-primary hover:bg-primary/90 text-primary-foreground gap-3"
            data-testid="btn-connect-wallet"
          >
            {isLoading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <Wallet className="w-5 h-5" />
            )}
            {STEP_LABELS[step]}
          </Button>

          <p className="text-xs text-muted-foreground text-center leading-relaxed">
            We use your wallet to identify you securely — no email or password
            needed.
          </p>
        </div>

        {/* Fine print */}
        <p className="text-xs text-muted-foreground/50 text-center leading-5">
          Requires MetaMask or any EIP-1193 compatible wallet.
          <br />
          Signing is free — no transaction will be sent.
        </p>
      </div>
    </div>
  );
}
