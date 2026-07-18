import { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { ShieldCheck, Loader2, ExternalLink } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import {
  detectWallets,
  connectWallet,
  signMessage,
  SIGN_IN_MESSAGE,
  type DetectedWallet,
} from '@/lib/wallet';

// ─── Types ────────────────────────────────────────────────────────────────────

type DetectionState = 'detecting' | 'none' | 'ready';
type ConnectStep = 'idle' | 'connecting' | 'signing' | 'verifying';

const STEP_LABELS: Record<ConnectStep, string> = {
  idle:       'Connect',
  connecting: 'Connecting…',
  signing:    'Sign in your wallet…',
  verifying:  'Verifying…',
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function AuthPage() {
  const [, setLocation]    = useLocation();
  const { toast }          = useToast();
  const { setWalletSession } = useAuth();

  const [detection, setDetection]   = useState<DetectionState>('detecting');
  const [wallets, setWallets]       = useState<DetectedWallet[]>([]);
  const [step, setStep]             = useState<ConnectStep>('idle');
  const [activeId, setActiveId]     = useState<string | null>(null); // which wallet is loading

  // ── Detect wallets on mount ─────────────────────────────────────────────────
  useEffect(() => {
    detectWallets().then((found) => {
      setWallets(found);
      setDetection(found.length === 0 ? 'none' : 'ready');
    });
  }, []);

  // ── Auth flow ───────────────────────────────────────────────────────────────
  const handleConnect = async (wallet: DetectedWallet) => {
    setActiveId(wallet.id);
    setStep('connecting');
    try {
      // 1 — Request account access
      const address = await connectWallet(wallet.provider);

      // 2 — Prove ownership with a free off-chain signature
      setStep('signing');
      await signMessage(wallet.provider, address, SIGN_IN_MESSAGE);

      // 3 — Look up or create the user row
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

      setWalletSession(address, userId);

      // 4 — Route based on existing OKX connection
      const { data: connection } = await supabase
        .from('okx_connections')
        .select('id')
        .eq('user_id', userId)
        .eq('active', true)
        .maybeSingle();

      setLocation(connection ? '/connected' : '/connect-okx');
    } catch (error: unknown) {
      const err = error as { code?: number; message?: string };
      const isRejection = err.code === 4001;
      toast({
        variant: 'destructive',
        title: isRejection ? 'Signature cancelled' : 'Connection failed',
        description: isRejection
          ? 'Please approve the sign-in request in your wallet to continue.'
          : (err.message ?? 'Something went wrong. Please try again.'),
      });
    } finally {
      setStep('idle');
      setActiveId(null);
    }
  };

  const isLoading = step !== 'idle';

  // ── Render ──────────────────────────────────────────────────────────────────
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

          {/* ── Detecting ──────────────────────────────────────────────────── */}
          {detection === 'detecting' && (
            <>
              <p className="text-lg font-medium text-foreground">Sign in with your wallet</p>
              <div className="flex items-center gap-2 text-muted-foreground text-sm">
                <Loader2 className="w-4 h-4 animate-spin" />
                Detecting wallets…
              </div>
            </>
          )}

          {/* ── No wallet found ─────────────────────────────────────────────── */}
          {detection === 'none' && (
            <>
              <div className="text-center space-y-2">
                <p className="text-lg font-medium text-foreground">No wallet detected</p>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  For the best experience, use OKX Wallet or MetaMask.
                </p>
              </div>
              <div className="w-full flex flex-col gap-3">
                <a
                  href="https://www.okx.com/web3"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full"
                >
                  <Button
                    variant="default"
                    className="w-full h-12 text-sm font-medium bg-primary hover:bg-primary/90 text-primary-foreground gap-2"
                  >
                    <img
                      src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' rx='18' fill='%23000'/%3E%3Crect x='18' y='18' width='26' height='26' rx='3' fill='%23fff'/%3E%3Crect x='56' y='18' width='26' height='26' rx='3' fill='%23fff'/%3E%3Crect x='37' y='37' width='26' height='26' rx='3' fill='%23fff'/%3E%3Crect x='18' y='56' width='26' height='26' rx='3' fill='%23fff'/%3E%3Crect x='56' y='56' width='26' height='26' rx='3' fill='%23fff'/%3E%3C/svg%3E"
                      alt="OKX Wallet"
                      className="w-5 h-5 rounded-md"
                    />
                    Get OKX Wallet
                    <ExternalLink className="w-3.5 h-3.5 opacity-60" />
                  </Button>
                </a>
                <a
                  href="https://metamask.io/download/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full"
                >
                  <Button
                    variant="outline"
                    className="w-full h-12 text-sm font-medium gap-2 border-card-border text-foreground hover:bg-white/5"
                  >
                    <img
                      src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' rx='18' fill='%23F6851B'/%3E%3Cpolygon points='50,15 78,30 78,55 50,85 22,55 22,30' fill='%23fff' opacity='0.9'/%3E%3Cpolygon points='50,15 78,30 64,45 50,38' fill='%23E2761B'/%3E%3Cpolygon points='22,30 50,15 50,38 36,45' fill='%23E4761B'/%3E%3Ccircle cx='50' cy='55' r='10' fill='%23F6851B'/%3E%3C/svg%3E"
                      alt="MetaMask"
                      className="w-5 h-5 rounded-md"
                    />
                    Get MetaMask
                    <ExternalLink className="w-3.5 h-3.5 opacity-60" />
                  </Button>
                </a>
              </div>
              <p className="text-xs text-muted-foreground text-center leading-relaxed">
                Install a wallet extension, then refresh this page.
              </p>
            </>
          )}

          {/* ── Wallet(s) detected ──────────────────────────────────────────── */}
          {detection === 'ready' && (
            <>
              <div className="text-center">
                <h2 className="text-lg font-medium text-foreground">
                  {wallets.length === 1
                    ? 'Sign in with your wallet'
                    : 'Choose a wallet'}
                </h2>
              </div>

              <div className="w-full flex flex-col gap-3">
                {wallets.map((wallet) => {
                  const isThisLoading = isLoading && activeId === wallet.id;
                  const isOtherLoading = isLoading && activeId !== wallet.id;
                  const label = isThisLoading
                    ? STEP_LABELS[step]
                    : wallets.length === 1
                      ? `Connect ${wallet.name}`
                      : wallet.name;

                  return (
                    <Button
                      key={wallet.id}
                      onClick={() => handleConnect(wallet)}
                      disabled={isLoading}
                      data-testid={`btn-connect-${wallet.id}`}
                      className={[
                        'w-full h-12 text-sm font-medium gap-3 justify-start px-4',
                        wallets.length === 1
                          ? 'bg-primary hover:bg-primary/90 text-primary-foreground'
                          : 'bg-white/5 hover:bg-white/10 text-foreground border border-card-border',
                        isOtherLoading ? 'opacity-40' : '',
                      ].join(' ')}
                    >
                      {isThisLoading ? (
                        <Loader2 className="w-5 h-5 animate-spin shrink-0" />
                      ) : (
                        <img
                          src={wallet.icon}
                          alt={wallet.name}
                          className="w-6 h-6 rounded-md shrink-0"
                          onError={(e) => {
                            // Hide broken icons gracefully
                            (e.currentTarget as HTMLImageElement).style.display = 'none';
                          }}
                        />
                      )}
                      <span className="flex-1 text-left">{label}</span>
                    </Button>
                  );
                })}
              </div>

              <p className="text-xs text-muted-foreground text-center leading-relaxed">
                We use your wallet to identify you securely — no email or password
                needed.
              </p>
            </>
          )}
        </div>

        {/* Fine print */}
        <p className="text-xs text-muted-foreground/50 text-center leading-5">
          Supports OKX Wallet, MetaMask, and any EIP-1193 compatible wallet.
          <br />
          Signing is free — no transaction will be sent.
        </p>
      </div>
    </div>
  );
}
