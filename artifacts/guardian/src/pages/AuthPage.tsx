import { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { ShieldCheck, Loader2, ExternalLink, Smartphone } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import {
  detectWallets,
  connectWallet,
  signMessage,
  SIGN_IN_MESSAGE,
  isMobileBrowser,
  openOkxDeepLink,
  type DetectedWallet,
} from '@/lib/wallet';

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Only show OKX Wallet — filter any other detected wallets out of the list
function isOkxWallet(w: DetectedWallet): boolean {
  const id   = w.id.toLowerCase();
  const name = w.name.toLowerCase();
  return (
    id.startsWith('com.okex') ||
    id.startsWith('com.okxwallet') ||
    id.includes('okx') ||
    name.includes('okx')
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────

type DetectionState = 'detecting' | 'none' | 'ready';
type ConnectStep    = 'idle' | 'connecting' | 'signing' | 'verifying';

const STEP_LABELS: Record<ConnectStep, string> = {
  idle:       'Connect OKX Wallet',
  connecting: 'Connecting…',
  signing:    'Sign in OKX Wallet…',
  verifying:  'Verifying…',
};

// OKX brand icon (five-square quincunx on black)
const OKX_ICON_SVG =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' rx='18' fill='%23000'/%3E%3Crect x='18' y='18' width='26' height='26' rx='3' fill='%23fff'/%3E%3Crect x='56' y='18' width='26' height='26' rx='3' fill='%23fff'/%3E%3Crect x='37' y='37' width='26' height='26' rx='3' fill='%23fff'/%3E%3Crect x='18' y='56' width='26' height='26' rx='3' fill='%23fff'/%3E%3Crect x='56' y='56' width='26' height='26' rx='3' fill='%23fff'/%3E%3C/svg%3E";

// ─── Component ────────────────────────────────────────────────────────────────

export default function AuthPage() {
  const [, setLocation]      = useLocation();
  const { toast }            = useToast();
  const { setWalletSession } = useAuth();

  const [detection, setDetection] = useState<DetectionState>('detecting');
  const [wallets, setWallets]     = useState<DetectedWallet[]>([]);
  const [step, setStep]           = useState<ConnectStep>('idle');
  const [activeId, setActiveId]   = useState<string | null>(null);
  const [deepLinking, setDeepLinking] = useState(false);

  const mobile = isMobileBrowser();

  // ── Detect wallets — filter to OKX only ────────────────────────────────────
  useEffect(() => {
    detectWallets().then((found) => {
      const okx = found.filter(isOkxWallet);
      setWallets(okx);
      setDetection(okx.length === 0 ? 'none' : 'ready');
    });
  }, []);

  // ── EIP-1193 connect + sign flow ────────────────────────────────────────────
  const handleConnect = async (wallet: DetectedWallet) => {
    setActiveId(wallet.id);
    setStep('connecting');
    try {
      const address = await connectWallet(wallet.provider);

      setStep('signing');
      await signMessage(wallet.provider, address, SIGN_IN_MESSAGE);

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

      const { data: conn } = await supabase
        .from('okx_connections')
        .select('id')
        .eq('user_id', userId)
        .eq('active', true)
        .maybeSingle();

      setLocation(conn ? '/dashboard' : '/connect-okx');
    } catch (error: unknown) {
      const err = error as { code?: number; message?: string };
      const isRejection = err.code === 4001;
      toast({
        variant: 'destructive',
        title: isRejection ? 'Signature cancelled' : 'Connection failed',
        description: isRejection
          ? 'Please approve the sign-in request in OKX Wallet to continue.'
          : (err.message ?? 'Something went wrong. Please try again.'),
      });
    } finally {
      setStep('idle');
      setActiveId(null);
    }
  };

  // ── Mobile deep-link / desktop install handler ──────────────────────────────
  const handleGetOkx = () => {
    if (!mobile) {
      // Desktop: open extension page directly
      window.open(
        'https://chromewebstore.google.com/detail/okx-wallet/mcohilncbfahbmgdjkbpemcciiolgcge',
        '_blank',
        'noopener,noreferrer',
      );
      return;
    }
    // Mobile: try deep-link into OKX Wallet app first; fall back to download
    setDeepLinking(true);
    openOkxDeepLink({ timeoutMs: 1800 });
    setTimeout(() => setDeepLinking(false), 2600);
  };

  const isLoading = step !== 'idle';

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div
      className="min-h-[100dvh] flex flex-col items-center justify-center p-6 bg-background"
      data-testid="page-auth"
    >
      <div className="w-full max-w-[360px] flex flex-col items-center gap-10">

        {/* Brand mark */}
        <div className="flex flex-col items-center gap-4">
          <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center ring-1 ring-primary/20">
            <ShieldCheck className="w-9 h-9 text-primary" />
          </div>
          <div className="text-center space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">Guardian</h1>
            <p className="text-sm text-muted-foreground">Portfolio protection for OKX</p>
          </div>
        </div>

        {/* Connect card */}
        <div className="w-full bg-card border border-card-border rounded-2xl overflow-hidden shadow-lg shadow-black/20">

          {/* ── Detecting ──────────────────────────────────────────────────── */}
          {detection === 'detecting' && (
            <div className="p-8 flex flex-col items-center gap-5">
              <p className="text-base font-medium text-foreground">Checking for OKX Wallet…</p>
              <div className="flex items-center gap-2 text-muted-foreground text-sm">
                <Loader2 className="w-4 h-4 animate-spin" />
                Scanning for wallet extensions
              </div>
            </div>
          )}

          {/* ── No OKX Wallet found ─────────────────────────────────────────── */}
          {detection === 'none' && (
            <div className="p-8 flex flex-col items-center gap-6">
              <div className="text-center space-y-2">
                <p className="text-base font-semibold text-foreground">OKX Wallet required</p>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {mobile
                    ? 'Open this page inside the OKX Wallet app, or install OKX Wallet first.'
                    : 'Install the OKX Wallet browser extension to continue.'}
                </p>
              </div>

              <div className="w-full space-y-3">
                <Button
                  onClick={handleGetOkx}
                  disabled={deepLinking}
                  className="w-full h-12 text-sm font-semibold bg-primary hover:bg-primary/90 text-primary-foreground gap-2.5"
                >
                  {deepLinking ? (
                    <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                  ) : (
                    <img
                      src={OKX_ICON_SVG}
                      alt=""
                      aria-hidden="true"
                      className="w-5 h-5 rounded-md shrink-0"
                    />
                  )}
                  <span className="flex-1 text-left">
                    {deepLinking
                      ? 'Opening OKX Wallet…'
                      : mobile
                        ? 'Open in OKX Wallet'
                        : 'Get OKX Wallet Extension'}
                  </span>
                  {!deepLinking && (
                    mobile
                      ? <Smartphone className="w-3.5 h-3.5 opacity-60 shrink-0" />
                      : <ExternalLink className="w-3.5 h-3.5 opacity-60 shrink-0" />
                  )}
                </Button>

                {mobile && !deepLinking && (
                  <p className="text-center text-xs text-muted-foreground/70 leading-relaxed">
                    Already installed?{' '}
                    <button
                      onClick={() => window.location.reload()}
                      className="text-primary underline underline-offset-2 hover:opacity-80 transition-opacity"
                    >
                      Refresh this page
                    </button>{' '}
                    to detect the wallet.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* ── OKX Wallet detected ─────────────────────────────────────────── */}
          {detection === 'ready' && (
            <div className="p-8 flex flex-col items-center gap-6">
              <div className="text-center space-y-1.5">
                <h2 className="text-base font-semibold text-foreground">
                  Sign in with OKX Wallet
                </h2>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  We'll ask you to sign a short message — no fees, no transaction.
                </p>
              </div>

              <div className="w-full flex flex-col gap-2.5">
                {wallets.map((wallet) => {
                  const isThisLoading  = isLoading && activeId === wallet.id;
                  const isOtherLoading = isLoading && activeId !== wallet.id;

                  return (
                    <Button
                      key={wallet.id}
                      onClick={() => handleConnect(wallet)}
                      disabled={isLoading}
                      data-testid={`btn-connect-${wallet.id}`}
                      className={[
                        'w-full h-12 text-sm font-semibold gap-3 justify-start px-4',
                        'bg-primary hover:bg-primary/90 text-primary-foreground',
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
                            (e.currentTarget as HTMLImageElement).style.display = 'none';
                          }}
                        />
                      )}
                      <span className="flex-1 text-left">
                        {isThisLoading ? STEP_LABELS[step] : `Connect ${wallet.name}`}
                      </span>
                    </Button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Fine print inside card — show once detection is complete */}
          {detection !== 'detecting' && (
            <div className="px-8 pb-7 -mt-1">
              <p className="text-xs text-muted-foreground/50 text-center leading-relaxed">
                Signing is free — no transaction will be sent.
              </p>
            </div>
          )}
        </div>

        {/* External fine print */}
        <p className="text-xs text-muted-foreground/35 text-center leading-5 max-w-[280px]">
          Guardian uses your OKX Wallet address to identify you.
          No email or password required.
        </p>
      </div>
    </div>
  );
}
