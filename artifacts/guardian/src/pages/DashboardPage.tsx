import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
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
  TrendingDown,
  Clock,
  Bell,
  Shield,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { fetchPortfolio, fetchTicker, type PortfolioData, type OkxConnection } from '@/lib/okx';
import { BottomNav } from '@/components/BottomNav';
import { BuySheet, type BuyPendingAction } from '@/components/BuySheet';

// ─── Types ────────────────────────────────────────────────────────────────────

interface TradeLogEntry {
  id: string;
  action_taken?: string;
  asset?: string;
  reason?: string;
  details?: string | null;
  created_at?: string;
  [key: string]: unknown;
}

interface PendingEntry {
  id: string;
  asset: string;
  description: string;
  submittedAt: number;
}

type PortfolioState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'no-connection' }
  | { status: 'ok'; data: PortfolioData; isDemo: boolean };

interface WorkerCycleStatus {
  lastCycleAt: string | null;
  lastCycleDurationMs: number;
  usersMonitored: number;
  rulesChecked: number;
  triggered: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const REFRESH_INTERVAL_MS         = 30_000;
const PENDING_REFRESH_INTERVAL_MS = 5_000;
const PENDING_EXPIRY_MS           = 5 * 60_000;

// ─── Asset accent palette ─────────────────────────────────────────────────────

const ASSET_COLORS: Record<string, string> = {
  BTC:   '#fb923c',
  ETH:   '#818cf8',
  SOL:   '#22d3ee',
  BNB:   '#fbbf24',
  XRP:   '#60a5fa',
  ADA:   '#c084fc',
  DOGE:  '#fcd34d',
  USDT:  '#34d399',
  USDC:  '#34d399',
  TUSD:  '#34d399',
  BUSD:  '#34d399',
  MATIC: '#a855f7',
  AVAX:  '#f87171',
  LINK:  '#3b82f6',
  DOT:   '#e879f9',
  LTC:   '#94a3b8',
  UNI:   '#f472b6',
  ATOM:  '#6366f1',
  NEAR:  '#4ade80',
  FIL:   '#0ea5e9',
  AAVE:  '#a78bfa',
  MKR:   '#14b8a6',
  ARB:   '#60a5fa',
  OP:    '#f87171',
  SUI:   '#38bdf8',
  APT:   '#818cf8',
  INJ:   '#fb7185',
  TRX:   '#ef4444',
};

const FALLBACK_COLORS = [
  '#60a5fa', '#f472b6', '#34d399', '#fbbf24',
  '#a78bfa', '#22d3ee', '#fb923c', '#818cf8',
];

function getAssetColor(symbol: string): string {
  if (ASSET_COLORS[symbol]) return ASSET_COLORS[symbol];
  const hash = symbol.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return FALLBACK_COLORS[hash % FALLBACK_COLORS.length];
}

const STABLECOINS = new Set(['USDT', 'USDC', 'TUSD', 'BUSD', 'DAI', 'FRAX', 'USDP']);

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
  if (n < 0.0001) return n.toFixed(8).replace(/\.?0+$/, '') || '0';
  if (n < 1) return n.toPrecision(4);
  if (n < 1000) return n.toFixed(4).replace(/\.?0+$/, '');
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function fmtPrice(n: number): string {
  if (n >= 10_000) return `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  if (n >= 1_000)  return `$${n.toLocaleString('en-US', { maximumFractionDigits: 1 })}`;
  if (n >= 100)    return `$${n.toFixed(2)}`;
  if (n >= 1)      return `$${n.toFixed(3)}`;
  if (n >= 0.01)   return `$${n.toFixed(4)}`;
  return `$${n.toFixed(6)}`;
}

let pendingIdCounter = 0;
function newPendingId() {
  return `pending-${Date.now()}-${++pendingIdCounter}`;
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

/** Fetches live spot prices for all portfolio symbols from OKX's public ticker. */
function useLivePrices(symbols: string[]) {
  const [prices, setPrices] = useState<Record<string, number>>({});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const symbolsKey = symbols.join(',');

  useEffect(() => {
    if (!symbolsKey) return;
    let cancelled = false;

    const fetchAll = async () => {
      const results = await Promise.allSettled(
        symbols.map(async (sym): Promise<[string, number]> => {
          if (STABLECOINS.has(sym)) return [sym, 1];
          const { last } = await fetchTicker(sym);
          return [sym, last];
        }),
      );
      if (cancelled) return;
      const map: Record<string, number> = {};
      for (const r of results) {
        if (r.status === 'fulfilled') {
          const [sym, price] = r.value;
          map[sym] = price;
        }
      }
      setPrices((prev) => ({ ...prev, ...map }));
    };

    fetchAll();
    const id = setInterval(fetchAll, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // symbolsKey is the stable dep — symbols itself changes reference every render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbolsKey]);

  return prices;
}

/** Polls /api/status every 30s for worker cycle info. */
function useWorkerStatus() {
  const [status, setStatus] = useState<WorkerCycleStatus | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/status');
      if (res.ok) setStatus((await res.json()) as WorkerCycleStatus);
    } catch {
      // non-critical — hero will simply omit the last-check time
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 30_000);
    return () => clearInterval(id);
  }, [refresh]);

  return status;
}

// ─── Coin icon ────────────────────────────────────────────────────────────────

function CoinIcon({ symbol }: { symbol: string }) {
  const [failed, setFailed] = useState(false);
  const color = getAssetColor(symbol);

  if (failed) {
    return (
      <div
        className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 text-[11px] font-bold leading-none select-none"
        style={{ background: color + '22', color }}
      >
        {symbol.slice(0, 2)}
      </div>
    );
  }

  return (
    <img
      src={`https://assets.coincap.io/assets/icons/${symbol.toLowerCase()}@2x.png`}
      alt={symbol}
      width={36}
      height={36}
      className="w-9 h-9 rounded-full shrink-0 object-contain bg-white/5"
      onError={() => setFailed(true)}
    />
  );
}

// ─── Guardian Status Hero ─────────────────────────────────────────────────────

function GuardianStatusHero({
  activeRuleCount,
  workerStatus,
}: {
  activeRuleCount: number | null;
  workerStatus: WorkerCycleStatus | null;
}) {
  return (
    <div
      className="relative rounded-2xl overflow-hidden border p-4"
      style={{
        borderColor: 'rgba(52,211,153,0.22)',
        background: 'linear-gradient(135deg, rgba(10,31,24,0.9) 0%, hsl(var(--card)) 100%)',
      }}
    >
      {/* Radial glow origin at top-left */}
      <div
        className="absolute top-0 left-0 w-48 h-48 pointer-events-none"
        style={{
          background:
            'radial-gradient(circle at 0% 0%, rgba(52,211,153,0.14) 0%, transparent 65%)',
        }}
      />

      <div className="relative flex items-center justify-between gap-3">
        {/* Left: indicator + label */}
        <div className="flex items-center gap-3 min-w-0">
          {/* Pulsing dot */}
          <div className="relative shrink-0 w-2.5 h-2.5">
            <div
              className="absolute inset-0 rounded-full animate-ping"
              style={{ backgroundColor: '#34d399', opacity: 0.6 }}
            />
            <div
              className="relative rounded-full w-2.5 h-2.5"
              style={{ backgroundColor: '#34d399' }}
            />
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <p className="text-sm font-semibold text-foreground">Guardian Active</p>
              <Shield className="w-3.5 h-3.5 shrink-0" style={{ color: '#34d399', opacity: 0.7 }} />
            </div>
            <p className="text-xs text-muted-foreground leading-snug mt-0.5">
              {activeRuleCount === null ? (
                'Checking rules…'
              ) : activeRuleCount === 0 ? (
                'No active rules — add one to start monitoring'
              ) : (
                <>
                  Monitoring{' '}
                  <span className="font-semibold" style={{ color: '#34d399' }}>
                    {activeRuleCount}
                  </span>{' '}
                  {activeRuleCount === 1 ? 'rule' : 'rules'} across your portfolio
                </>
              )}
            </p>
          </div>
        </div>

        {/* Right: last cycle time */}
        {workerStatus !== null && (
          <div className="text-right shrink-0">
            <p className="text-[9px] uppercase tracking-widest text-muted-foreground/40 mb-0.5">
              Last check
            </p>
            <p
              className="text-xs font-medium tabular-nums"
              style={{ color: 'rgba(52,211,153,0.75)' }}
            >
              {workerStatus.lastCycleAt
                ? relativeTime(workerStatus.lastCycleAt)
                : 'Starting…'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Portfolio section ────────────────────────────────────────────────────────

function PortfolioSection({
  state,
  onRetry,
  onSwitchAccount,
  livePrices,
}: {
  state: PortfolioState;
  onRetry: () => void;
  onSwitchAccount: () => void;
  livePrices: Record<string, number>;
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
          <Button size="sm" style={{ background: '#34d399', color: '#0a0d0f' }}>
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
            <p className="text-sm font-medium text-[#f59e0b]">Couldn't fetch your portfolio.</p>
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
          {data.assets.map((a) => {
            const accentColor = getAssetColor(a.symbol);
            const livePrice   = livePrices[a.symbol];

            return (
              <li key={a.symbol} className="px-5 py-3.5 flex items-center gap-3">
                {/* Left accent stripe */}
                <div
                  className="w-0.5 h-8 rounded-full shrink-0"
                  style={{ backgroundColor: accentColor, opacity: 0.5 }}
                />

                <CoinIcon symbol={a.symbol} />

                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground">{a.symbol}</p>
                  <p className="text-xs text-muted-foreground/70 tabular-nums">
                    {fmtBal(a.balance)}&nbsp;{a.symbol}
                  </p>
                </div>

                <div className="text-right shrink-0">
                  <p className="text-sm font-semibold text-foreground tabular-nums">
                    {fmtUsd(a.usdValue)}
                  </p>
                  {/* Live market price */}
                  {livePrice !== undefined ? (
                    <p
                      className="text-[11px] tabular-nums mt-0.5"
                      style={{ color: accentColor, opacity: 0.75 }}
                    >
                      {fmtPrice(livePrice)}&nbsp;/{a.symbol}
                    </p>
                  ) : (
                    <p className="text-[11px] text-muted-foreground/30 mt-0.5">loading…</p>
                  )}
                  {/* Allocation bar */}
                  <div className="flex items-center gap-1.5 justify-end mt-1.5">
                    <div className="h-1.5 rounded-full bg-white/5 w-16 overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-700"
                        style={{
                          width: `${Math.min(a.pct, 100)}%`,
                          backgroundColor: accentColor,
                          opacity: 0.75,
                        }}
                      />
                    </div>
                    <span className="text-[10px] text-muted-foreground/50 tabular-nums w-8 text-right">
                      {a.pct.toFixed(0)}%
                    </span>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ─── Active rules row ─────────────────────────────────────────────────────────

function ActiveRulesRow({ count }: { count: number | null }) {
  return (
    <Link href="/rules">
      <div className="rounded-xl border border-card-border bg-card px-4 py-3 flex items-center gap-3 hover:border-blue-500/30 transition-colors group">
        <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center shrink-0">
          <ShieldCheck className="w-4 h-4 text-blue-400" />
        </div>
        <div className="flex-1">
          {count === null ? (
            <p className="text-sm text-muted-foreground">Loading rules…</p>
          ) : (
            <p className="text-sm font-medium text-foreground">
              <span className="text-blue-400">{count}</span>{' '}
              {count === 1 ? 'active rule' : 'active rules'} protecting your portfolio
            </p>
          )}
        </div>
        <ChevronRight className="w-4 h-4 text-muted-foreground/50 group-hover:text-muted-foreground transition-colors" />
      </div>
    </Link>
  );
}

// ─── Activity log ─────────────────────────────────────────────────────────────

type ActionIconType = typeof Zap;

interface ActionStyle {
  Icon: ActionIconType;
  iconColor: string;
  iconBg: string;
  rowBg?: string;
}

function getActionStyle(action: string): ActionStyle {
  const lower = action.toLowerCase();
  if (lower.includes('sold') || lower.includes('sell') || lower.includes('failed')) {
    return {
      Icon: TrendingDown,
      iconColor: '#f87171',
      iconBg: 'rgba(239,68,68,0.15)',
      rowBg: 'rgba(239,68,68,0.03)',
    };
  }
  if (lower.includes('buy') || lower.includes('bought') || lower.includes('purchase')) {
    return {
      Icon: TrendingUp,
      iconColor: '#34d399',
      iconBg: 'rgba(52,211,153,0.15)',
      rowBg: 'rgba(52,211,153,0.03)',
    };
  }
  if (lower.includes('alert')) {
    return {
      Icon: Bell,
      iconColor: '#fbbf24',
      iconBg: 'rgba(251,191,36,0.15)',
    };
  }
  return {
    Icon: Zap,
    iconColor: 'hsl(var(--muted-foreground))',
    iconBg: 'rgba(255,255,255,0.06)',
  };
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
          <div className="w-12 h-12 rounded-2xl bg-blue-500/10 flex items-center justify-center">
            <ShieldCheck className="w-6 h-6 text-blue-400/60" />
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

          {/* ── Pending rows ──────────────────────────────────────────────── */}
          {pendingEntries.map((p) => (
            <div key={p.id} className="px-4 py-3 flex gap-3 items-start bg-amber-500/5">
              <div className="mt-0.5 w-7 h-7 rounded-lg bg-amber-500/15 flex items-center justify-center shrink-0">
                <Clock className="w-3.5 h-3.5 text-amber-400" />
              </div>
              <div className="flex-1 min-w-0 space-y-0.5">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <p className="text-sm font-medium text-foreground/80">
                    {p.asset ? `Buying ${p.asset}` : 'Order submitted'}
                  </p>
                  {p.asset && (
                    <span
                      className="text-xs font-semibold px-1.5 py-0.5 rounded"
                      style={{
                        color: getAssetColor(p.asset),
                        background: getAssetColor(p.asset) + '22',
                      }}
                    >
                      {p.asset}
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  Submitted — waiting for OKX confirmation
                </p>
              </div>
              <span className="text-[10px] text-amber-400/60 shrink-0 mt-0.5 flex items-center gap-1">
                <span className="w-1 h-1 rounded-full bg-amber-400/60 animate-pulse inline-block" />
                Processing…
              </span>
            </div>
          ))}

          {/* ── Confirmed log entries ─────────────────────────────────────── */}
          {entries.map((entry) => {
            const action = String(entry.action_taken ?? entry.action ?? 'Action');
            const asset  = String(entry.asset ?? '—');
            const reason = String(entry.reason ?? '');
            const amount = entry.details
              ? String(entry.details).replace(/^amount:\s*/, '')
              : null;
            const ts = entry.created_at;
            const { Icon, iconColor, iconBg, rowBg } = getActionStyle(action);

            return (
              <div
                key={entry.id}
                className="px-4 py-3 flex gap-3 items-start"
                style={rowBg ? { background: rowBg } : undefined}
              >
                <div
                  className="mt-0.5 w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                  style={{ background: iconBg }}
                >
                  <Icon className="w-3.5 h-3.5" style={{ color: iconColor }} />
                </div>
                <div className="flex-1 min-w-0 space-y-0.5">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <p className="text-sm font-medium text-foreground capitalize">
                      {action.replace(/_/g, ' ')}
                    </p>
                    {asset !== '—' && (
                      <span
                        className="text-xs font-semibold px-1.5 py-0.5 rounded"
                        style={{
                          color: getAssetColor(asset),
                          background: getAssetColor(asset) + '22',
                        }}
                      >
                        {asset}
                      </span>
                    )}
                    {amount && (
                      <span className="text-xs text-muted-foreground">{amount}</span>
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

  // ── Live prices ────────────────────────────────────────────────────────────
  const portfolioSymbols = useMemo(() => {
    if (portfolioState.status !== 'ok') return [];
    return portfolioState.data.assets.map((a) => a.symbol);
  }, [portfolioState]);

  const livePrices = useLivePrices(portfolioSymbols);

  // ── Worker status (for Guardian Status hero) ───────────────────────────────
  const workerStatus = useWorkerStatus();

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
    const { count, error } = await supabase
      .from('rules')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('active', true);
    if (error) {
      console.error('[dashboard] loadRuleCount error:', error.message, error.code);
      return;
    }
    setActiveRuleCount(count ?? 0);
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

    setPendingEntries((prev) => {
      if (prev.length === 0) return prev;
      const now = Date.now();
      return prev.filter((p) => {
        if (now - p.submittedAt > PENDING_EXPIRY_MS) return false;
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

  // ── Auto-refresh log ───────────────────────────────────────────────────────
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

  // ── Buy success ────────────────────────────────────────────────────────────
  const handleBuySuccess = (pending: BuyPendingAction) => {
    setPendingEntries((prev) => [
      ...prev,
      { id: newPendingId(), ...pending },
    ]);
    loadLog(false);
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-[100dvh] flex flex-col bg-background">
      <div className="w-full max-w-[420px] mx-auto px-4 pt-10 pb-2 space-y-4">

        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">Dashboard</h1>
            <p className="text-sm text-muted-foreground">Your OKX portfolio, live.</p>
          </div>
          <button
            onClick={handleSignOut}
            aria-label="Sign out"
            className="mt-1 p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors shrink-0"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>

        {/* Guardian Status Hero */}
        <GuardianStatusHero
          activeRuleCount={activeRuleCount}
          workerStatus={workerStatus}
        />

        {/* Portfolio snapshot */}
        <PortfolioSection
          state={portfolioState}
          onRetry={() => connRef.current && loadPortfolio(connRef.current)}
          onSwitchAccount={() => setShowDisconnectConfirm(true)}
          livePrices={livePrices}
        />

        {/* Disconnect confirmation card */}
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

        {/* Quick Buy — green is correct here: it IS a buy action */}
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

        {/* Active protection rules — blue, not green (not a gain/buy signal) */}
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

      {/* Buy sheet */}
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
