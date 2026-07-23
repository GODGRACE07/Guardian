import { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { ShieldCheck, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
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

// ─── OKX wallet filter ────────────────────────────────────────────────────────

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

// ─── OKX brand icon (five-square quincunx on black) ───────────────────────────

const OKX_ICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' rx='18' fill='%23000'/%3E%3Crect x='18' y='18' width='26' height='26' rx='3' fill='%23fff'/%3E%3Crect x='56' y='18' width='26' height='26' rx='3' fill='%23fff'/%3E%3Crect x='37' y='37' width='26' height='26' rx='3' fill='%23fff'/%3E%3Crect x='18' y='56' width='26' height='26' rx='3' fill='%23fff'/%3E%3Crect x='56' y='56' width='26' height='26' rx='3' fill='%23fff'/%3E%3C/svg%3E";

// ─── Types ────────────────────────────────────────────────────────────────────

type DetectionState = 'detecting' | 'none' | 'ready';
type ConnectStep    = 'idle' | 'connecting' | 'signing' | 'verifying';

const STEP_LABELS: Record<ConnectStep, string> = {
  idle:       'Connect OKX Wallet',
  connecting: 'Connecting…',
  signing:    'Sign in OKX Wallet…',
  verifying:  'Verifying…',
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function AuthPage() {
  const [, setLocation]      = useLocation();
  const { toast }            = useToast();
  const { setWalletSession } = useAuth();

  const [detection, setDetection]     = useState<DetectionState>('detecting');
  const [wallets, setWallets]         = useState<DetectedWallet[]>([]);
  const [step, setStep]               = useState<ConnectStep>('idle');
  const [deepLinking, setDeepLinking] = useState(false);

  const mobile = isMobileBrowser();

  // ── Wallet detection ────────────────────────────────────────────────────────
  // Fast-path: OKX Wallet's in-app browser injects window.okxwallet synchronously,
  // so we can skip the 200ms EIP-6963 scan and go straight to 'ready'.
  useEffect(() => {
    if (window.okxwallet) {
      setWallets([{
        id:       'com.okex.okxwallet',
        name:     'OKX Wallet',
        icon:     OKX_ICON,
        provider: window.okxwallet,
        priority: 0,
      }]);
      setDetection('ready');
      return;
    }
    // Normal path: run EIP-6963 + legacy injection scan
    detectWallets().then((found) => {
      const okx = found.filter(isOkxWallet);
      setWallets(okx);
      setDetection(okx.length === 0 ? 'none' : 'ready');
    });
  }, []);

  // ── EIP-1193 connect + sign flow ────────────────────────────────────────────
  const handleConnect = async (wallet: DetectedWallet) => {
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
    }
  };

  // ── Mobile deep-link / desktop install handler ──────────────────────────────
  // On mobile in a normal browser: attempt the OKX deep link so the user is
  // taken to the OKX Wallet app, which opens Guardian in its built-in browser
  // where window.okxwallet is injected and sign-in completes normally.
  // On desktop: open the Chrome Web Store extension page.
  const handleGetOkx = () => {
    if (!mobile) {
      window.open(
        'https://chromewebstore.google.com/detail/okx-wallet/mcohilncbfahbmgdjkbpemcciiolgcge',
        '_blank',
        'noopener,noreferrer',
      );
      return;
    }
    setDeepLinking(true);
    openOkxDeepLink({ timeoutMs: 1800 });
    // Reset after the timeout window passes so the button is usable again
    setTimeout(() => setDeepLinking(false), 2600);
  };

  // ── Single button click handler ─────────────────────────────────────────────
  const handleButtonClick = () => {
    if (detection === 'ready' && wallets[0]) {
      handleConnect(wallets[0]);
    } else if (detection === 'none') {
      handleGetOkx();
    }
    // 'detecting' → button is disabled; do nothing
  };

  // ── Derived button state ────────────────────────────────────────────────────
  const isConnecting = step !== 'idle';
  const isDisabled   = detection === 'detecting' || isConnecting || deepLinking;
  const showSpinner  = detection === 'detecting' || isConnecting || deepLinking;

  let buttonText: string;
  if (detection === 'detecting')      buttonText = 'Detecting wallet…';
  else if (isConnecting)              buttonText = STEP_LABELS[step];
  else if (deepLinking)               buttonText = 'Opening OKX Wallet…';
  else if (detection === 'none')      buttonText = mobile ? 'Open in OKX Wallet' : 'Get OKX Wallet';
  else                                buttonText = 'Connect OKX Wallet';

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div
      className="min-h-[100dvh] flex flex-col items-center justify-center px-6 relative overflow-hidden select-none"
      data-testid="page-auth"
      style={{
        // Dark radial glow from top-centre in the primary mint colour, over the app background
        background:
          'radial-gradient(ellipse 90% 55% at 50% -2%, rgba(79,209,165,0.11) 0%, transparent 68%),' +
          'linear-gradient(180deg, #060a0d 0%, hsl(204,20%,5%) 100%)',
      }}
    >
      {/* Hairline top-glow line */}
      <div
        className="absolute top-0 inset-x-0 h-px"
        style={{
          background:
            'linear-gradient(90deg, transparent, rgba(79,209,165,0.35) 40%, rgba(79,209,165,0.35) 60%, transparent)',
        }}
      />

      <div className="relative flex flex-col items-center gap-0 w-full max-w-[300px]">

        {/* ── Logo ─────────────────────────────────────────────────────────── */}
        <div className="relative mb-8 flex items-center justify-center">
          {/* Soft bloom glow behind the icon */}
          <div
            className="absolute rounded-full pointer-events-none"
            style={{
              width: 180,
              height: 180,
              background:
                'radial-gradient(circle, rgba(79,209,165,0.16) 0%, transparent 70%)',
            }}
          />
          {/* Icon container */}
          <div
            className="relative flex items-center justify-center"
            style={{
              width: 96,
              height: 96,
              borderRadius: 28,
              background: 'rgba(79,209,165,0.07)',
              border: '1px solid rgba(79,209,165,0.18)',
            }}
          >
            <ShieldCheck
              className="text-primary"
              style={{ width: 48, height: 48 }}
              strokeWidth={1.5}
            />
          </div>
        </div>

        {/* ── Wordmark ──────────────────────────────────────────────────────── */}
        <h1
          className="text-foreground font-bold tracking-tight text-center"
          style={{ fontSize: 38, lineHeight: 1.1, letterSpacing: '-0.02em' }}
        >
          Guardian
        </h1>
        <p className="mt-2.5 mb-12 text-sm text-muted-foreground text-center leading-snug">
          Portfolio protection for OKX
        </p>

        {/* ── Connect button ────────────────────────────────────────────────── */}
        <button
          onClick={handleButtonClick}
          disabled={isDisabled}
          className={[
            'w-full h-14 rounded-full flex items-center justify-center gap-2.5',
            'text-[15px] font-semibold transition-all duration-150',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
            isDisabled
              ? 'opacity-55 cursor-not-allowed'
              : 'active:scale-[0.97]',
          ].join(' ')}
          style={{
            background: isDisabled
              ? 'rgba(79,209,165,0.45)'
              : 'hsl(160,58%,56%)',
            color: 'hsl(204,20%,5%)',
            boxShadow: isDisabled
              ? 'none'
              : '0 0 0 1px rgba(79,209,165,0.3), 0 4px 24px rgba(79,209,165,0.18)',
          }}
        >
          {showSpinner ? (
            <Loader2 className="w-5 h-5 animate-spin shrink-0" style={{ color: 'hsl(204,20%,5%)' }} />
          ) : (
            <img
              src={OKX_ICON}
              alt=""
              aria-hidden="true"
              className="shrink-0 rounded-full"
              style={{ width: 24, height: 24 }}
            />
          )}
          <span>{buttonText}</span>
        </button>

        {/* ── Trust copy ────────────────────────────────────────────────────── */}
        <p
          className="mt-5 text-center leading-relaxed"
          style={{ fontSize: 11.5, color: 'rgba(100,116,139,0.75)', maxWidth: 240 }}
        >
          Your wallet is your identity — no email, no password, no data stored.
        </p>

        {/* ── Mobile retry hint (shown when asking user to install) ─────────── */}
        {detection === 'none' && mobile && !deepLinking && (
          <button
            onClick={() => window.location.reload()}
            className="mt-4 text-xs transition-colors"
            style={{ color: 'rgba(100,116,139,0.55)' }}
            onMouseEnter={(e) =>
              ((e.currentTarget as HTMLButtonElement).style.color = 'rgba(100,116,139,0.85)')
            }
            onMouseLeave={(e) =>
              ((e.currentTarget as HTMLButtonElement).style.color = 'rgba(100,116,139,0.55)')
            }
          >
            Already installed? Tap to retry
          </button>
        )}
      </div>

      {/* ── Bottom wordmark ───────────────────────────────────────────────────── */}
      <p
        className="absolute bottom-7 text-center"
        style={{ fontSize: 11, color: 'rgba(100,116,139,0.30)', letterSpacing: '0.04em' }}
      >
        GUARDIAN · PORTFOLIO PROTECTION
      </p>
    </div>
  );
}
