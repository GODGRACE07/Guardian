/**
 * BuySheet — bottom drawer for placing manual market buy orders via OKX.
 *
 * The user picks an asset, selects whether they want to enter a USD spend
 * amount or a coin quantity, sees a live price estimate, then confirms.
 *
 * ── Fire-and-forget UX ──────────────────────────────────────────────────────
 * The backend responds as soon as it has validated inputs and confirmed the
 * OKX connection (~300-500ms).  The actual OKX order runs in the background.
 * This component treats that fast ack as success: it closes immediately and
 * calls onSuccess() so the dashboard can add a pending entry to the Activity
 * Log and speed up its poll interval.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, TrendingUp, RefreshCw } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

// ─── Constants ────────────────────────────────────────────────────────────────

// Always-available coins beyond whatever the user holds.
// Kept to a practical list; USDT excluded (no USDT-USDT pair on OKX spot).
const COMMON_ASSETS = [
  'BTC', 'ETH', 'SOL', 'OKB', 'XRP', 'BNB',
  'DOGE', 'ADA', 'AVAX', 'MATIC', 'DOT', 'LINK',
  'UNI', 'ATOM', 'LTC',
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtUsd(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtCoin(n: number, asset: string): string {
  if (n === 0) return `0 ${asset}`;
  const decimals = n < 0.001 ? 8 : n < 1 ? 6 : 4;
  return `${n.toFixed(decimals).replace(/\.?0+$/, '')} ${asset}`;
}

// ─── Types ────────────────────────────────────────────────────────────────────

/** Passed to onSuccess so the dashboard can add an optimistic pending row. */
export interface BuyPendingAction {
  asset: string;
  description: string;
  submittedAt: number; // Date.now() at submission
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface BuySheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pre-selected asset when opened from an asset row. */
  defaultAsset?: string;
  /** Assets already in the user's portfolio — shown first in the selector. */
  portfolioAssets: string[];
  userId: string;
  /** Called immediately after the server acks the order so the dashboard can
   *  show a pending entry in the Activity Log. */
  onSuccess: (pending: BuyPendingAction) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function BuySheet({
  open,
  onOpenChange,
  defaultAsset,
  portfolioAssets,
  userId,
  onSuccess,
}: BuySheetProps) {
  const { toast } = useToast();

  // Merge portfolio coins first, then remaining common assets (no duplicates)
  const allAssets = [
    ...portfolioAssets,
    ...COMMON_ASSETS.filter((a) => !portfolioAssets.includes(a)),
  ];
  void allAssets; // computed for selector ordering below

  const initialAsset = defaultAsset ?? portfolioAssets[0] ?? 'BTC';

  const [asset, setAsset] = useState(initialAsset);
  /** spend = enter a USD amount; buy = enter a coin quantity */
  const [mode, setMode] = useState<'spend' | 'buy'>('spend');
  const [amount, setAmount] = useState('');
  const [price, setPrice] = useState<number | null>(null);
  const [priceLoading, setPriceLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // ── Live price from OKX public ticker ─────────────────────────────────────
  const fetchPrice = useCallback(async (sym: string) => {
    setPriceLoading(true);
    setPrice(null);
    try {
      const res = await fetch(
        `https://www.okx.com/api/v5/market/ticker?instId=${sym}-USDT`,
      );
      const json = (await res.json()) as {
        code: string;
        data?: Array<{ last: string }>;
      };
      if (json.code === '0' && json.data?.[0]) {
        const p = parseFloat(json.data[0].last);
        setPrice(isNaN(p) || p <= 0 ? null : p);
      }
    } catch {
      setPrice(null);
    }
    setPriceLoading(false);
  }, []);

  // Refresh price whenever the sheet opens or the selected asset changes
  useEffect(() => {
    if (open) fetchPrice(asset);
  }, [open, asset, fetchPrice]);

  // Reset form when sheet opens with a new default asset
  useEffect(() => {
    if (open) {
      setAsset(defaultAsset ?? portfolioAssets[0] ?? 'BTC');
      setAmount('');
      setMode('spend');
    }
  }, [open, defaultAsset, portfolioAssets]);

  // ── Derived estimates ──────────────────────────────────────────────────────
  const numAmount = parseFloat(amount) || 0;
  const estimatedCoins =
    mode === 'spend' && price && numAmount > 0 ? numAmount / price : null;
  const estimatedUsd =
    mode === 'buy' && price && numAmount > 0 ? numAmount * price : null;

  // Summary line shown before confirming
  let summary: string | null = null;
  if (numAmount > 0 && price) {
    if (mode === 'spend' && estimatedCoins) {
      summary = `Buy approximately ${fmtCoin(estimatedCoins, asset)} for ${fmtUsd(numAmount)}`;
    } else if (mode === 'buy' && estimatedUsd) {
      summary = `Buy ${fmtCoin(numAmount, asset)} for approximately ${fmtUsd(estimatedUsd)}`;
    }
  }

  // ── Confirm handler ────────────────────────────────────────────────────────
  const handleConfirm = async () => {
    if (!numAmount || numAmount <= 0) return;
    setSubmitting(true);

    try {
      const res = await fetch('/api/trade/buy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          asset,
          mode,
          amount: numAmount,
          estimatedPrice: price ?? undefined,
        }),
      });

      const json = (await res.json()) as {
        ok?: boolean;
        status?: string;
        error?: string;
      };

      if (!res.ok || !json.ok) {
        throw new Error(json.error ?? 'Unknown error');
      }

      // ── Fast ack received — close sheet and hand off to dashboard ─────────
      //
      // The server has validated the request and confirmed the OKX connection.
      // The actual order is being placed in the background.  We close
      // immediately and show a clear "check Activity Log" message so the user
      // knows exactly where to see the result.
      const description = summary
        ? `${summary} — order submitted, processing in background`
        : `${asset} order submitted — processing in background`;

      onOpenChange(false);

      toast({
        title: '✅ Order submitted',
        description: 'Processing in background. Check Activity Log for the result.',
      });

      // Tell the dashboard to add a pending row + speed up its poll.
      onSuccess({
        asset,
        description,
        submittedAt: Date.now(),
      });

    } catch (err: unknown) {
      const msg = (err as Error).message ?? 'Buy failed';
      toast({ variant: 'destructive', title: 'Buy failed', description: msg });
    } finally {
      setSubmitting(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="rounded-t-2xl px-5 pb-8 pt-5 max-h-[92dvh] overflow-y-auto"
      >
        <SheetHeader className="mb-5">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
              <TrendingUp className="w-4.5 h-4.5 text-primary" />
            </div>
            <div>
              <SheetTitle className="text-base leading-tight">Buy Crypto</SheetTitle>
              <SheetDescription className="text-xs mt-0.5">
                Place a market order on your OKX account
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <div className="space-y-5">

          {/* ── Asset selector ─────────────────────────────────────────────── */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Asset
            </label>
            <Select
              value={asset}
              onValueChange={(v) => {
                setAsset(v);
                setAmount('');
              }}
            >
              <SelectTrigger className="bg-card border-card-border h-11 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {portfolioAssets.length > 0 && (
                  <>
                    <div className="px-2 py-1.5 text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider">
                      In Your Portfolio
                    </div>
                    {portfolioAssets.map((sym) => (
                      <SelectItem key={`portfolio-${sym}`} value={sym}>
                        {sym}
                      </SelectItem>
                    ))}
                    <div className="px-2 py-1.5 text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider border-t border-card-border mt-1 pt-2">
                      Other Coins
                    </div>
                  </>
                )}
                {COMMON_ASSETS.filter((a) => !portfolioAssets.includes(a)).map(
                  (sym) => (
                    <SelectItem key={`common-${sym}`} value={sym}>
                      {sym}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
          </div>

          {/* ── Mode toggle ────────────────────────────────────────────────── */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Enter amount as
            </label>
            <div className="grid grid-cols-2 gap-2 bg-card border border-card-border rounded-xl p-1">
              <button
                type="button"
                onClick={() => { setMode('spend'); setAmount(''); }}
                className={[
                  'py-2 px-3 rounded-lg text-sm font-medium transition-colors',
                  mode === 'spend'
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                ].join(' ')}
              >
                Spend ($)
              </button>
              <button
                type="button"
                onClick={() => { setMode('buy'); setAmount(''); }}
                className={[
                  'py-2 px-3 rounded-lg text-sm font-medium transition-colors',
                  mode === 'buy'
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                ].join(' ')}
              >
                Buy ({asset})
              </button>
            </div>
          </div>

          {/* ── Amount input ────────────────────────────────────────────────── */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                {mode === 'spend' ? 'USD amount to spend' : `${asset} quantity to buy`}
              </label>
              {/* Live price + refresh */}
              <div className="flex items-center gap-1.5">
                {priceLoading ? (
                  <Loader2 className="w-3 h-3 animate-spin text-muted-foreground/60" />
                ) : price ? (
                  <span className="text-[10px] text-muted-foreground/60 tabular-nums">
                    {fmtUsd(price)}/{asset}
                  </span>
                ) : null}
                <button
                  type="button"
                  onClick={() => fetchPrice(asset)}
                  disabled={priceLoading}
                  className="text-muted-foreground/40 hover:text-muted-foreground transition-colors"
                  aria-label="Refresh price"
                >
                  <RefreshCw className="w-3 h-3" />
                </button>
              </div>
            </div>

            <div className="relative">
              {mode === 'spend' && (
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm select-none">
                  $
                </span>
              )}
              <Input
                type="number"
                min="0"
                step="any"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder={mode === 'spend' ? '100.00' : '0.001'}
                className={[
                  'bg-card border-card-border h-11 text-base',
                  mode === 'spend' ? 'pl-7' : '',
                ].join(' ')}
              />
            </div>

            {/* Inline estimate under the input */}
            {numAmount > 0 && !priceLoading && (
              <p className="text-xs text-muted-foreground tabular-nums pl-1">
                {mode === 'spend' && estimatedCoins
                  ? `≈ ${fmtCoin(estimatedCoins, asset)}`
                  : mode === 'buy' && estimatedUsd
                  ? `≈ ${fmtUsd(estimatedUsd)}`
                  : price === null
                  ? 'Price unavailable — cannot estimate'
                  : null}
              </p>
            )}
          </div>

          {/* ── Order summary ───────────────────────────────────────────────── */}
          {summary && (
            <div className="rounded-xl bg-primary/10 border border-primary/20 px-4 py-3">
              <p className="text-sm text-primary font-medium leading-relaxed">
                {summary}
              </p>
              <p className="text-[11px] text-primary/60 mt-1">
                Market order — final fill price may vary slightly
              </p>
            </div>
          )}

          {/* ── Confirm button ──────────────────────────────────────────────── */}
          <Button
            className="w-full h-11 text-sm font-semibold bg-primary hover:bg-primary/90 text-primary-foreground"
            disabled={!amount || numAmount <= 0 || submitting || priceLoading}
            onClick={handleConfirm}
          >
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                Submitting…
              </>
            ) : (
              'Confirm Buy'
            )}
          </Button>

          {/* ── Background-processing note ─────────────────────────────────── */}
          <p className="text-center text-[11px] text-muted-foreground/50 leading-relaxed -mt-1">
            Orders are submitted instantly. OKX may take a moment to fill —
            check Activity Log for confirmation.
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
