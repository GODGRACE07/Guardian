import { useState, useEffect, useCallback, useRef } from 'react';
import { Link, useLocation } from 'wouter';
import {
  ShieldCheck,
  Loader2,
  RefreshCw,
  AlertTriangle,
  ChevronRight,
  Zap,
  LogOut,
  TrendingUp,
  Clock,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { fetchPortfolio, type PortfolioData, type OkxConnection } from '@/lib/okx';
import { BottomNav } from '@/components/BottomNav';
import { BuySheet, type BuyPendingAction } from '@/components/BuySheet';

// ─── Types ────────────────────────────────────────────────────────────────────

interface TradeLogEntry {
  id: string;
  action_taken?: string;  // NOT NULL column — the action label
  asset?: string;
  reason?: string;
  details?: string | null; // nullable — holds "amount: X" or orderId info
  created_at?: string;
  [key: string]: unknown;
}

/**
 * A locally-synthesised entry that represents an action that has been
 * submitted to the server but hasn't yet appeared in trade_log.
 * Shown at the top of the Activity Log with a pulsing indicator until the
 * real entry arrives (or until the expiry timeout is reached).
 */
interface PendingEntry {
  /** client-side unique id — never matches a real trade_log id */
  id: string;
  asset: string;
  description: string;
  /** Date.now() at submission — used to match against real entries */
  submittedAt: number;
}

type PortfolioState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'no-connection' }
  | { status: 'ok'; data: PortfolioData; isDemo: boolean };

// ─── Constants ────────────────────────────────────────────────────────────────

/** Normal poll interval when nothing is pending */
const REFRESH_INTERVAL_MS = 30_000;
/** Faster poll while a pending entry is waiting to be confirmed */
const PENDING_REFRESH_INTERVAL_MS = 5_000;
/** Remove a pending entry if the real log entry still hasn't appeared after this long */
const PENDING_EXPIRY_MS = 5 * 60_000; // 5 minutes

// ─── Helpers ──────────────────────────────────────────────────────────────────

function relativeTime(iso?: string): string {
  if (!iso) return '';
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60)    return `${diff}s ago`;
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function fmtUsd(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtBal(n: number): string {
  if (n === 0) return '0';
  if (n < 0.0001) return n.toExponential(2);
  if (n < 1) return n.toPrecision(4);
  if (n < 1000) return n.toFixed(4).replace(/\.?0+$/, '');
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

let pendingIdCounter = 0;
function newPendingId() {
  return `pending-${Date.now()}-${++pendingIdCounter}`;
}

// ─── Coin icon ────────────────────────────────────────────────────────────────

function CoinIcon({ symbol }: { symbol: string }) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
        <span className="text-[11px] font-bold text-primary leading-none select-none">
          {symbol.slice(0, 2)}
        </span>
      </div>
    );
  }

  return (
    <img
      src={`https://assets.coincap.io/assets/icons/${symbol.toLowerCase()}@2x.png`}
      alt={symbol}
      width={32}
      height={32}
      className="w-8 h-8 rounded-full shrink-0 object-contain bg-white/5"
      onError={() => setFailed(true)}
    />
  );
}

// ─── Sub-sections ─────────────────────────────────────────────────────────────

function PortfolioSection({
  state,
  onRetry,
  onSwitchAccount,
}: {
  state: PortfolioState;
  onRetry: () => void;
  onSwitchAccount: () => void;
}) {
  if (state.status === 'loading') {
    return (
      <div className="rounded-2xl border border-card-border bg-card p-6 flex items-center justify-center gap-2 text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" />
        <span className="text-sm">Fetching portfolio…</span>
      </div>
    );
  }

  if (state.status === 'no-connection') {
    return (
      <div className="rounded-2xl border border-card-border bg-card p-6 text-center space-y-3">
        <p className="text-sm text-muted-foreground">No active OKX connection found.</p>
        <Link href="/connect-okx">
          <Button
            size="sm"
            className="bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            Connect OKX Account
          </Button>
        </Link>
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="rounded-2xl border border-[#f59e0b]/30 bg-[#451a03]/60 p-5 space-y-3">
        <div className="flex gap-2 items-start">
          <AlertTriangle className="w-4 h-4 text-[#f59e0b] shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="text-sm font-medium text-[#f59e0b]">
              Couldn't fetch your portfolio.
            </p>
            <p className="text-xs text-[#f59e0b]/70 leading-relaxed">
              {state.message} — Check your OKX connection or{' '}
              <Link href="/connect-okx" className="underline underline-offset-2">
                reconnect
              </Link>
              .
            </p>
          </div>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={onRetry}
          className="border-[#f59e0b]/30 text-[#f59e0b]/80 hover:text-[#f59e0b] hover:bg-[#f59e0b]/5 text-xs gap-1.5"
        >
          <RefreshCw className="w-3 h-3" /> Retry
        </Button>
      </div>
    );
  }

  const { data, isDemo } = state;

  return (
    <div className="rounded-2xl border border-card-border bg-card overflow-hidden">
      {/* Total value header */}
      <div className="p-5 border-b border-card-border/60">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium mb-1">
              Portfolio Value
            </p>
            <p className="text-3xl font-semibold text-foreground tabular-nums">
              {fmtUsd(data.totalUsd)}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1.5 mt-1">
            <span
              className={[
                'text-[10px] font-semibold px-2 py-1 rounded-full border',
                isDemo
                  ? 'bg-primary/10 text-primary border-primary/20'
                  : 'bg-amber-500/10 text-amber-400 border-amber-500/20',
              ].join(' ')}
            >
              {isDemo ? 'Demo Trading' : 'Live Trading'}
            </span>
            <button
              onClick={onSwitchAccount}
              className="text-[10px] text-muted-foreground/60 hover:text-muted-foreground transition-colors underline-offset-2 hover:underline"
            >
              Switch account
            </button>
          </div>
        </div>
      </div>

      {/* Asset breakdown */}
      {data.assets.length === 0 ? (
        <div className="px-5 py-6 text-center text-sm text-muted-foreground">
          No assets found in this account.
        </div>
      ) : (
        <ul className="divide-y divide-card-border/40">
          {data.assets.map((a) => (
            <li key={a.symbol} className="px-5 py-3 flex items-center gap-3">
              <CoinIcon symbol={a.symbol} />

              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">{a.symbol}</p>
                <p className="text-xs text-muted-foreground tabular-nums">
                  {fmtBal(a.balance)}&nbsp;{a.symbol}
                </p>
              </div>

              <div className="text-right shrink-0 space-y-1">
                <p className="text-sm font-medium text-foreground tabular-nums">
                  {fmtUsd(a.usdValue)}
                </p>
                <div className="flex items-center gap-1.5 justify-end">
                  <div className="h-1 rounded-full bg-card-border/60 w-16 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-primary/60"
                      style={{ width: `${Math.min(a.pct, 100)}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-muted-foreground/70 tabular-nums w-9 text-right">
                    {a.pct.toFixed(1)}%
                  </span>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ActiveRulesRow({ count }: { count: number | null }) {
  return (
    <Link href="/rules">
      <div className="rounded-xl border border-card-border bg-card px-4 py-3 flex items-center gap-3 hover:border-primary/30 transition-colors group">
        <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
          <ShieldCheck className="w-4 h-4 text-primary" />
        </div>
        <div className="flex-1">
          {count === null ? (
            <p className="text-sm text-muted-foreground">Loading rules…</p>
          ) : (
            <p className="text-sm font-medium text-foreground">
              <span className="text-primary">{count}</span>{' '}
              {count === 1 ? 'active rule' : 'active rules'} protecting your portfolio
            </p>
          )}
        </div>
        <ChevronRight className="w-4 h-4 text-muted-foreground/50 group-hover:text-muted-foreground transition-colors" />
      </div>
    </Link>
  );
}

function ActivityLog({
  entries,
  pendingEntries,
  loading,
  lastRefreshed,
  onRefresh,
}: {
  entries: TradeLogEntry[];
  pendingEntries: PendingEntry[];
  loading: boolean;
  lastRefreshed: Date | null;
  onRefresh: () => void;
}) {
  const isEmpty = entries.length === 0 && pendingEntries.length === 0;

  return (
    <div className="space-y-3">
      {/* Section header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-foreground">Activity Log</h2>
          {/* Subtle "live" indicator when we have pending entries */}
          {pendingEntries.length > 0 && (
            <span className="flex items-center gap-1 text-[10px] font-medium text-amber-400/80 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
              Processing
            </span>
          )}
        </div>
        <button
          onClick={onRefresh}
          disabled={loading}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Refresh log"
        >
          <RefreshCw className={['w-3 h-3', loading ? 'animate-spin' : ''].join(' ')} />
          {lastRefreshed ? relativeTime(lastRefreshed.toISOString()) : ''}
        </button>
      </div>

      {loading && isEmpty ? (
        <div className="rounded-2xl border border-card-border bg-card p-6 flex items-center justify-center gap-2 text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-sm">Loading activity…</span>
        </div>
      ) : isEmpty ? (
        <div className="rounded-2xl border border-dashed border-card-border bg-card/50 p-8 flex flex-col items-center text-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center">
            <ShieldCheck className="w-6 h-6 text-primary/60" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">No actions yet</p>
            <p className="text-xs text-muted-foreground leading-relaxed max-w-[240px]">
              Guardian is watching your portfolio and will act automatically if a rule is triggered.
            </p>
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-card-border bg-card divide-y divide-card-border/40 overflow-hidden">

          {/* ── Pending rows at the top ─────────────────────────────────── */}
          {pendingEntries.map((p) => (
            <div key={p.id} className="px-4 py-3 flex gap-3 items-start bg-amber-500/5">
              {/* Pulsing amber icon to distinguish from confirmed entries */}
              <div className="mt-0.5 w-7 h-7 rounded-lg bg-amber-500/15 flex items-center justify-center shrink-0">
                <Clock className="w-3.5 h-3.5 text-amber-400" />
              </div>
              <div className="flex-1 min-w-0 space-y-0.5">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <p className="text-sm font-medium text-foreground/80">
                    {p.asset ? `Buying ${p.asset}` : 'Order submitted'}
                  </p>
                  {p.asset && (
                    <span className="text-xs font-semibold text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded">
                      {p.asset}
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Submitted — waiting for OKX confirmation
                </p>
              </div>
              <span className="text-[10px] text-amber-400/60 shrink-0 mt-0.5 flex items-center gap-1">
                <span className="w-1 h-1 rounded-full bg-amber-400/60 animate-pulse inline-block" />
                Processing…
              </span>
            </div>
          ))}

          {/* ── Confirmed log entries ───────────────────────────────────── */}
          {entries.map((entry) => {
            const action = String(entry.action_taken ?? entry.action ?? 'Action');
            const asset  = String(entry.asset ?? '—');
            const reason = String(entry.reason ?? '');
            const amount = entry.details
              ? String(entry.details).replace(/^amount:\s*/, '')
              : null;
            const ts = entry.created_at;

            return (
              <div key={entry.id} className="px-4 py-3 flex gap-3 items-start">
                <div className="mt-0.5 w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <Zap className="w-3.5 h-3.5 text-primary" />
                </div>
                <div className="flex-1 min-w-0 space-y-0.5">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <p className="text-sm font-medium text-foreground capitalize">
                      {action.replace(/_/g, ' ')}
                    </p>
                    {asset !== '—' && (
                      <span className="text-xs font-semibold text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                        {asset}
                      </span>
                    )}
                    {amount && (
                      <span className="text-xs text-muted-foreground">
                        {amount}
                      </span>
                    )}
                  </div>
                  {reason && (
                    <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">
                      {reason}
                    </p>
                  )}
                </div>
                <span className="text-[10px] text-muted-foreground/60 shrink-0 mt-0.5 tabular-nums">
                  {relativeTime(ts as string | undefined)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { userId, clearWalletSession } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const handleSignOut = () => {
    clearWalletSession();
    setLocation('/auth');
  };

  const [portfolioState, setPortfolioState] = useState<PortfolioState>({ status: 'loading' });
  const [activeRuleCount, setActiveRuleCount] = useState<number | null>(null);
  const [logEntries, setLogEntries] = useState<TradeLogEntry[]>([]);
  const [logLoading, setLogLoading] = useState(true);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  /** Optimistic pending entries — submitted but not yet confirmed in trade_log */
  const [pendingEntries, setPendingEntries] = useState<PendingEntry[]>([]);

  const connRef   = useRef<OkxConnection | null>(null);
  const connIdRef = useRef<string | null>(null);

  // ── Buy sheet state ────────────────────────────────────────────────────────
  const [buyOpen, setBuyOpen] = useState(false);
  const [buyDefaultAsset, setBuyDefaultAsset] = useState<string | undefined>(undefined);

  const openBuy = (asset?: string) => {
    setBuyDefaultAsset(asset);
    setBuyOpen(true);
  };

  // ── Disconnect confirmation state ──────────────────────────────────────────
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  const handleDisconnect = async () => {
    if (!connIdRef.current) return;
    setIsDisconnecting(true);
    const { error } = await supabase
      .from('okx_connections')
      .update({ active: false })
      .eq('id', connIdRef.current);

    if (error) {
      toast({ variant: 'destructive', title: 'Disconnect failed', description: error.message });
      setIsDisconnecting(false);
      setShowDisconnectConfirm(false);
      return;
    }

    setLocation('/connect-okx');
  };

  // ── Load OKX connection + portfolio ────────────────────────────────────────
  const loadPortfolio = useCallback(async (conn: OkxConnection) => {
    setPortfolioState({ status: 'loading' });
    try {
      const data = await fetchPortfolio(conn);
      setPortfolioState({ status: 'ok', data, isDemo: conn.is_demo });
    } catch (err: unknown) {
      const msg = (err as { message?: string }).message ?? 'Unknown error';
      setPortfolioState({ status: 'error', message: msg });
    }
  }, []);

  const initPortfolio = useCallback(async () => {
    if (!userId) return;
    const { data: conn, error: connError } = await supabase
      .from('okx_connections')
      .select('id, api_key, api_secret, api_passphrase, is_demo')
      .eq('user_id', userId)
      .eq('active', true)
      .maybeSingle();

    if (connError) {
      setPortfolioState({
        status: 'error',
        message: connError.code === 'PGRST116'
          ? 'Multiple active connections found — please reconnect your OKX account.'
          : connError.message,
      });
      return;
    }

    if (!conn) {
      setPortfolioState({ status: 'no-connection' });
      return;
    }
    connIdRef.current = conn.id as string;
    const creds: OkxConnection = {
      api_key:        conn.api_key as string,
      api_secret:     conn.api_secret as string,
      api_passphrase: conn.api_passphrase as string,
      is_demo:        conn.is_demo as boolean,
    };
    connRef.current = creds;
    await loadPortfolio(creds);
  }, [userId, loadPortfolio]);

  // ── Load active rule count ─────────────────────────────────────────────────
  const loadRuleCount = useCallback(async () => {
    if (!userId) return;
    const { data } = await supabase
      .from('rules')
      .select('id')
      .eq('user_id', userId)
      .eq('active', true);
    setActiveRuleCount(data?.length ?? 0);
  }, [userId]);

  // ── Load activity log ──────────────────────────────────────────────────────
  const loadLog = useCallback(async (showSpinner = false) => {
    if (!userId) return;
    if (showSpinner) setLogLoading(true);

    const { data, error } = await supabase
      .from('trade_log')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50);

    let fresh: TradeLogEntry[];
    if (error) {
      const { data: fallback } = await supabase
        .from('trade_log')
        .select('*')
        .eq('user_id', userId)
        .limit(50);
      fresh = (fallback as TradeLogEntry[]) ?? [];
    } else {
      fresh = (data as TradeLogEntry[]) ?? [];
    }

    setLogEntries(fresh);
    setLastRefreshed(new Date());
    setLogLoading(false);

    // ── Reconcile pending entries ──────────────────────────────────────────
    // Remove any pending entry that either:
    //   (a) has a matching real entry (same asset, created_at >= submittedAt), or
    //   (b) has expired (> PENDING_EXPIRY_MS old)
    setPendingEntries((prev) => {
      if (prev.length === 0) return prev;
      const now = Date.now();
      return prev.filter((p) => {
        // Expire after timeout regardless
        if (now - p.submittedAt > PENDING_EXPIRY_MS) return false;

        // Clear if a real entry with this asset appeared after submission
        const fulfilled = fresh.some((e) => {
          if (!e.asset || e.asset !== p.asset) return false;
          if (!e.created_at) return false;
          return new Date(e.created_at).getTime() >= p.submittedAt;
        });
        return !fulfilled;
      });
    });
  }, [userId]);

  // ── Initial load ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!userId) return;
    initPortfolio();
    loadRuleCount();
    loadLog(true);
  }, [userId, initPortfolio, loadRuleCount, loadLog]);

  // ── Auto-refresh log — faster when there are pending entries ──────────────
  useEffect(() => {
    const interval = pendingEntries.length > 0
      ? PENDING_REFRESH_INTERVAL_MS
      : REFRESH_INTERVAL_MS;
    const id = setInterval(() => loadLog(false), interval);
    return () => clearInterval(id);
  }, [loadLog, pendingEntries.length]);

  // ── Refresh on tab focus ───────────────────────────────────────────────────
  useEffect(() => {
    const onFocus = () => loadLog(false);
    document.addEventListener('visibilitychange', onFocus);
    return () => document.removeEventListener('visibilitychange', onFocus);
  }, [loadLog]);

  // ── Manual log refresh ─────────────────────────────────────────────────────
  const handleLogRefresh = () => {
    loadLog(true);
    if (connRef.current) loadPortfolio(connRef.current);
    loadRuleCount();
  };

  // ── Handle buy submission ack ──────────────────────────────────────────────
  //
  // Called by BuySheet immediately after the server acks the request (~300ms).
  // We add a pending entry so the user sees immediate feedback, and the faster
  // poll interval kicks in automatically (pendingEntries.length > 0).
  const handleBuySuccess = (pending: BuyPendingAction) => {
    setPendingEntries((prev) => [
      ...prev,
      { id: newPendingId(), ...pending },
    ]);
    // Trigger one immediate silent refresh so the log is as fresh as possible
    loadLog(false);
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-[100dvh] flex flex-col bg-background">
      <div className="w-full max-w-[420px] mx-auto px-4 pt-10 pb-2 space-y-5">

        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">Dashboard</h1>
            <p className="text-sm text-muted-foreground">
              Your OKX portfolio, live.
            </p>
          </div>
          <button
            onClick={handleSignOut}
            aria-label="Sign out"
            className="mt-1 p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors shrink-0"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>

        {/* Portfolio snapshot */}
        <PortfolioSection
          state={portfolioState}
          onRetry={() => connRef.current && loadPortfolio(connRef.current)}
          onSwitchAccount={() => setShowDisconnectConfirm(true)}
        />

        {/* ── Disconnect confirmation card ─────────────────────────────── */}
        {showDisconnectConfirm && (
          <div className="rounded-2xl border border-[#f59e0b]/30 bg-[#451a03]/60 p-5 space-y-4">
            <div className="space-y-1">
              <p className="text-sm font-semibold text-[#f59e0b]">Disconnect OKX account?</p>
              <p className="text-xs text-[#f59e0b]/75 leading-relaxed">
                This will disconnect your current OKX connection. Guardian will stop monitoring
                your portfolio until you reconnect. You can reconnect anytime.
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowDisconnectConfirm(false)}
                disabled={isDisconnecting}
                className="flex-1 border-[#f59e0b]/30 text-[#f59e0b]/80 hover:text-[#f59e0b] hover:bg-[#f59e0b]/5 text-xs"
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleDisconnect}
                disabled={isDisconnecting}
                className="flex-1 bg-[#f59e0b] hover:bg-[#f59e0b]/90 text-black font-semibold text-xs gap-1.5"
              >
                {isDisconnecting && <Loader2 className="w-3 h-3 animate-spin" />}
                {isDisconnecting ? 'Disconnecting…' : 'Disconnect'}
              </Button>
            </div>
          </div>
        )}

        {/* Quick Buy action — only shown when a connection is active */}
        {portfolioState.status === 'ok' && (
          <button
            onClick={() => openBuy()}
            className="w-full rounded-xl border border-card-border bg-card px-4 py-3 flex items-center gap-3 hover:border-primary/30 transition-colors group text-left"
          >
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <TrendingUp className="w-4 h-4 text-primary" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-foreground">Buy Crypto</p>
              <p className="text-xs text-muted-foreground">Place a market order on OKX</p>
            </div>
            <ChevronRight className="w-4 h-4 text-muted-foreground/50 group-hover:text-muted-foreground transition-colors" />
          </button>
        )}

        {/* Active protection summary */}
        <ActiveRulesRow count={activeRuleCount} />

        {/* Activity log */}
        <ActivityLog
          entries={logEntries}
          pendingEntries={pendingEntries}
          loading={logLoading}
          lastRefreshed={lastRefreshed}
          onRefresh={handleLogRefresh}
        />
      </div>

      {/* Buy sheet — rendered at page level so it overlays everything */}
      <BuySheet
        open={buyOpen}
        onOpenChange={setBuyOpen}
        defaultAsset={buyDefaultAsset}
        portfolioAssets={
          portfolioState.status === 'ok'
            ? portfolioState.data.assets.map((a) => a.symbol)
            : []
        }
        userId={userId ?? ''}
        onSuccess={handleBuySuccess}
      />

      <BottomNav />
    </div>
  );
}
