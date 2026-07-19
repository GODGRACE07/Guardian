import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'wouter';
import {
  ShieldCheck,
  Loader2,
  RefreshCw,
  AlertTriangle,
  ChevronRight,
  Zap,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { fetchPortfolio, type PortfolioData, type OkxConnection } from '@/lib/okx';
import { BottomNav } from '@/components/BottomNav';

// ─── Types ────────────────────────────────────────────────────────────────────

interface TradeLogEntry {
  id: string;
  action?: string;
  asset?: string;
  reason?: string;
  amount?: number | string;
  created_at?: string;
  [key: string]: unknown;
}

type PortfolioState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'no-connection' }
  | { status: 'ok'; data: PortfolioData; isDemo: boolean };

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
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(2)}K`;
  return `$${n.toFixed(2)}`;
}

function fmtBal(n: number): string {
  if (n === 0) return '0';
  if (n < 0.0001) return n.toExponential(2);
  if (n < 1) return n.toPrecision(4);
  if (n < 1000) return n.toFixed(4).replace(/\.?0+$/, '');
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

// ─── Sub-sections ─────────────────────────────────────────────────────────────

function PortfolioSection({ state, onRetry }: { state: PortfolioState; onRetry: () => void }) {
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
          <span
            className={[
              'text-[10px] font-semibold px-2 py-1 rounded-full border mt-1',
              isDemo
                ? 'bg-primary/10 text-primary border-primary/20'
                : 'bg-amber-500/10 text-amber-400 border-amber-500/20',
            ].join(' ')}
          >
            {isDemo ? 'Demo Trading' : 'Live Trading'}
          </span>
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
              {/* Symbol badge */}
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <span className="text-[10px] font-bold text-primary">
                  {a.symbol.slice(0, 3)}
                </span>
              </div>
              {/* Name + amount */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">{a.symbol}</p>
                <p className="text-xs text-muted-foreground tabular-nums">
                  {fmtBal(a.balance)}
                </p>
              </div>
              {/* Value + bar */}
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
  loading,
  lastRefreshed,
  onRefresh,
}: {
  entries: TradeLogEntry[];
  loading: boolean;
  lastRefreshed: Date | null;
  onRefresh: () => void;
}) {
  return (
    <div className="space-y-3">
      {/* Section header */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">Activity Log</h2>
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

      {loading && entries.length === 0 ? (
        <div className="rounded-2xl border border-card-border bg-card p-6 flex items-center justify-center gap-2 text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-sm">Loading activity…</span>
        </div>
      ) : entries.length === 0 ? (
        // Empty state
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
          {entries.map((entry) => {
            // Gracefully handle unknown column layouts
            const action  = String(entry.action  ?? entry.rule_type ?? entry.type ?? 'Action');
            const asset   = String(entry.asset   ?? entry.symbol   ?? '—');
            const reason  = String(entry.reason  ?? entry.description ?? entry.notes ?? '');
            const amount  = entry.amount != null ? String(entry.amount) : null;
            const ts      = entry.created_at ?? entry.timestamp ?? entry.executed_at;

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

const REFRESH_INTERVAL_MS = 30_000;

export default function DashboardPage() {
  const { userId } = useAuth();
  const { toast } = useToast();

  const [portfolioState, setPortfolioState] = useState<PortfolioState>({ status: 'loading' });
  const [activeRuleCount, setActiveRuleCount] = useState<number | null>(null);
  const [logEntries, setLogEntries] = useState<TradeLogEntry[]>([]);
  const [logLoading, setLogLoading] = useState(true);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  const connRef = useRef<OkxConnection | null>(null);

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
    const { data: conn } = await supabase
      .from('okx_connections')
      .select('api_key, api_secret, api_passphrase, is_demo')
      .eq('user_id', userId)
      .eq('active', true)
      .maybeSingle();

    if (!conn) {
      setPortfolioState({ status: 'no-connection' });
      return;
    }
    connRef.current = conn as OkxConnection;
    await loadPortfolio(conn as OkxConnection);
  }, [userId, loadPortfolio]);

  // ── Load active rule count ─────────────────────────────────────────────────
  // Note: { count: 'exact', head: true } makes a HEAD request whose Content-Range
  // header returns null when there is no Supabase Auth session (our wallet auth
  // bypasses Supabase Auth). Fetching the actual IDs and counting them is reliable.
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

    if (error) {
      // trade_log may not have created_at — try without ordering
      const { data: fallback } = await supabase
        .from('trade_log')
        .select('*')
        .eq('user_id', userId)
        .limit(50);
      setLogEntries((fallback as TradeLogEntry[]) ?? []);
    } else {
      setLogEntries((data as TradeLogEntry[]) ?? []);
    }
    setLastRefreshed(new Date());
    setLogLoading(false);
  }, [userId]);

  // ── Initial load ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!userId) return;
    initPortfolio();
    loadRuleCount();
    loadLog(true);
  }, [userId, initPortfolio, loadRuleCount, loadLog]);

  // ── Auto-refresh log every 30s ─────────────────────────────────────────────
  useEffect(() => {
    const interval = setInterval(() => loadLog(false), REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [loadLog]);

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

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-[100dvh] flex flex-col bg-background">
      <div className="w-full max-w-[420px] mx-auto px-4 pt-10 pb-2 space-y-5">

        {/* Header */}
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Your OKX portfolio, live.
          </p>
        </div>

        {/* Portfolio snapshot */}
        <PortfolioSection
          state={portfolioState}
          onRetry={() => connRef.current && loadPortfolio(connRef.current)}
        />

        {/* Active protection summary */}
        <ActiveRulesRow count={activeRuleCount} />

        {/* Activity log */}
        <ActivityLog
          entries={logEntries}
          loading={logLoading}
          lastRefreshed={lastRefreshed}
          onRefresh={handleLogRefresh}
        />
      </div>

      <BottomNav />
    </div>
  );
}
