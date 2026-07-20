import { useState, useEffect, useCallback, Fragment } from 'react';
import { useLocation } from 'wouter';
import {
  ShieldCheck,
  Plus,
  Trash2,
  ChevronLeft,
  Loader2,
  TrendingDown,
  PieChart,
  Shuffle,
  ToggleLeft,
  ToggleRight,
  LogOut,
  FlaskConical,
  CheckCircle2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { BottomNav } from '@/components/BottomNav';

// ─── Types ────────────────────────────────────────────────────────────────────

type RuleType = 'stop_loss' | 'concentration_alert' | 'rebalance_alert';
type StopLossMode = 'pct' | 'price';

interface Rule {
  id: string;
  rule_type: RuleType;
  asset: string;
  threshold_pct: number | null;
  target_price: number | null;
  active: boolean;
}

type AddStep = 'type' | 'details';

// ─── Constants ────────────────────────────────────────────────────────────────

const RULE_META: Record<
  RuleType,
  {
    label: string;
    description: string;
    icon: React.ReactNode;
    helperText: (pct: number) => string;
    plain: (asset: string, pct: number) => string;
    defaultThreshold: number;
    min: number;
    max: number;
    step: number;
    unit: string;
  }
> = {
  stop_loss: {
    label: 'Stop-Loss',
    description: 'Automatically sell if a position drops too far',
    icon: <TrendingDown className="w-5 h-5" />,
    helperText: (pct) =>
      `Guardian will place a market sell order if ${pct}% below your average entry price.`,
    plain: (asset, pct) => `Sell ${asset} if it drops ${pct}%`,
    defaultThreshold: 15,
    min: 2,
    max: 50,
    step: 1,
    unit: '% drop',
  },
  concentration_alert: {
    label: 'Concentration Alert',
    description: 'Warn me if one asset gets too big a share of my portfolio',
    icon: <PieChart className="w-5 h-5" />,
    helperText: (pct) =>
      `You'll be alerted when this asset exceeds ${pct}% of your total portfolio value.`,
    plain: (asset, pct) => `Alert if ${asset} exceeds ${pct}% of portfolio`,
    defaultThreshold: 40,
    min: 5,
    max: 90,
    step: 5,
    unit: '% of portfolio',
  },
  rebalance_alert: {
    label: 'Rebalance Alert',
    description: 'Warn me when my allocation drifts from target',
    icon: <Shuffle className="w-5 h-5" />,
    helperText: (pct) =>
      `You'll be alerted when this asset drifts more than ${pct}% from your target allocation.`,
    plain: (asset, pct) => `Alert if ${asset} drifts ${pct}% from target`,
    defaultThreshold: 10,
    min: 2,
    max: 40,
    step: 1,
    unit: '% drift',
  },
};

const RULE_TYPE_ORDER: RuleType[] = [
  'stop_loss',
  'concentration_alert',
  'rebalance_alert',
];

// ─── Sub-components ───────────────────────────────────────────────────────────

/** Human-readable description of a rule, handling both stop-loss modes. */
function ruleDescription(rule: Rule): string {
  if (rule.rule_type === 'stop_loss') {
    if (rule.target_price != null && rule.target_price > 0) {
      return `Sell ${rule.asset} if price drops to ${rule.target_price.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 6 })}`;
    }
    const pct = rule.threshold_pct ?? 0;
    return RULE_META.stop_loss.plain(rule.asset, pct);
  }
  const pct = rule.threshold_pct ?? 0;
  return RULE_META[rule.rule_type].plain(rule.asset, pct);
}

function RuleCard({
  rule,
  onToggle,
  onDelete,
  onTestTrigger,
}: {
  rule: Rule;
  onToggle: (id: string, active: boolean) => void;
  onDelete: (id: string) => void;
  onTestTrigger: (id: string) => void;
}) {
  const meta = RULE_META[rule.rule_type];

  return (
    <div
      className={[
        'rounded-xl border p-4 flex items-start gap-3 transition-colors',
        rule.active
          ? 'bg-card border-card-border'
          : 'bg-card/50 border-card-border/50',
      ].join(' ')}
      data-testid={`rule-card-${rule.id}`}
    >
      {/* Icon */}
      <div
        className={[
          'mt-0.5 shrink-0 w-8 h-8 rounded-lg flex items-center justify-center',
          rule.active ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
        ].join(' ')}
      >
        {meta.icon}
      </div>

      {/* Text */}
      <div className="flex-1 min-w-0">
        <p
          className={[
            'text-sm font-medium leading-snug',
            rule.active ? 'text-foreground' : 'text-muted-foreground',
          ].join(' ')}
        >
          {ruleDescription(rule)}
        </p>
        <p className="text-xs text-muted-foreground/70 mt-0.5">
          {meta.label}
          {rule.rule_type === 'stop_loss' && rule.target_price != null && (
            <span className="ml-1 text-primary/60">· price target</span>
          )}
        </p>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-1 shrink-0 ml-1">
        {/* Test Trigger — amber flask icon, clearly a testing action */}
        <button
          onClick={() => onTestTrigger(rule.id)}
          className="text-amber-500/50 hover:text-amber-500 transition-colors p-1"
          aria-label="Test trigger — manually fire this rule now"
          title="Test Trigger"
          data-testid={`test-trigger-${rule.id}`}
        >
          <FlaskConical className="w-4 h-4" />
        </button>
        <button
          onClick={() => onToggle(rule.id, rule.active)}
          className={[
            'transition-colors',
            rule.active ? 'text-primary hover:text-primary/70' : 'text-muted-foreground hover:text-foreground',
          ].join(' ')}
          aria-label={rule.active ? 'Deactivate rule' : 'Activate rule'}
          data-testid={`toggle-rule-${rule.id}`}
        >
          {rule.active ? (
            <ToggleRight className="w-8 h-8" />
          ) : (
            <ToggleLeft className="w-8 h-8" />
          )}
        </button>
        <button
          onClick={() => onDelete(rule.id)}
          className="text-muted-foreground/50 hover:text-destructive transition-colors p-1"
          aria-label="Delete rule"
          data-testid={`delete-rule-${rule.id}`}
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function RulesPage() {
  const [, setLocation] = useLocation();
  const { userId, clearWalletSession } = useAuth();
  const { toast } = useToast();

  // ── Data state ──────────────────────────────────────────────────────────────
  const [rules, setRules] = useState<Rule[]>([]);
  const [loadingRules, setLoadingRules] = useState(true);

  // ── Test Trigger state ──────────────────────────────────────────────────────
  // confirmingTestId: which rule's confirmation panel is open
  // submittingTestId: which rule is currently being submitted (shows spinner)
  // submittedTestId:  which rule just got acked (shows checkmark before panel closes)
  const [confirmingTestId, setConfirmingTestId] = useState<string | null>(null);
  const [submittingTestId, setSubmittingTestId] = useState<string | null>(null);
  const [submittedTestId, setSubmittedTestId] = useState<string | null>(null);

  // ── Add-rule form state ─────────────────────────────────────────────────────
  const [adding, setAdding] = useState(false);
  const [addStep, setAddStep] = useState<AddStep>('type');
  const [selectedType, setSelectedType] = useState<RuleType | null>(null);
  const [asset, setAsset] = useState('');
  const [threshold, setThreshold] = useState(15);
  const [stopLossMode, setStopLossMode] = useState<StopLossMode>('pct');
  const [targetPrice, setTargetPrice] = useState('');
  const [saving, setSaving] = useState(false);

  // ── Fetch rules ─────────────────────────────────────────────────────────────
  const fetchRules = useCallback(async () => {
    if (!userId) return;

    let { data, error } = await supabase
      .from('rules')
      .select('id, rule_type, asset, threshold_pct, target_price, active')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error?.code === '42703') {
      const fallback = await supabase
        .from('rules')
        .select('id, rule_type, asset, threshold_pct, active')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });
      data = fallback.data;
      error = fallback.error;
      if (!error && data) {
        data = (data as Omit<Rule, 'target_price'>[]).map((r) => ({ ...r, target_price: null })) as Rule[];
      }
    }

    if (error) {
      toast({ variant: 'destructive', title: 'Failed to load rules', description: error.message });
    } else {
      setRules((data as Rule[]) ?? []);
    }
    setLoadingRules(false);
  }, [userId, toast]);

  useEffect(() => { fetchRules(); }, [fetchRules]);

  // ── Toggle active ───────────────────────────────────────────────────────────
  const handleToggle = async (id: string, currentActive: boolean) => {
    setRules((prev) =>
      prev.map((r) => (r.id === id ? { ...r, active: !currentActive } : r)),
    );
    const { error } = await supabase
      .from('rules')
      .update({ active: !currentActive })
      .eq('id', id);

    if (error) {
      setRules((prev) =>
        prev.map((r) => (r.id === id ? { ...r, active: currentActive } : r)),
      );
      toast({ variant: 'destructive', title: 'Update failed', description: error.message });
    }
  };

  // ── Delete rule ─────────────────────────────────────────────────────────────
  const handleDelete = async (id: string) => {
    setRules((prev) => prev.filter((r) => r.id !== id));
    const { error } = await supabase.from('rules').delete().eq('id', id);
    if (error) {
      toast({ variant: 'destructive', title: 'Delete failed', description: error.message });
      fetchRules();
    }
  };

  // ── Open add form ───────────────────────────────────────────────────────────
  const openAdd = () => {
    setSelectedType(null);
    setAsset('');
    setThreshold(15);
    setStopLossMode('pct');
    setTargetPrice('');
    setAddStep('type');
    setAdding(true);
  };

  const cancelAdd = () => setAdding(false);

  // ── Select rule type → step 2 ───────────────────────────────────────────────
  const pickType = (type: RuleType) => {
    setSelectedType(type);
    setThreshold(RULE_META[type].defaultThreshold);
    setAsset('');
    setStopLossMode('pct');
    setTargetPrice('');
    setAddStep('details');
  };

  // ── Save new rule ───────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!userId || !selectedType) return;
    const trimmedAsset = asset.trim().toUpperCase();
    if (!trimmedAsset) {
      toast({ variant: 'destructive', title: 'Asset required', description: 'Enter a token symbol like BTC or SOL.' });
      return;
    }

    const isPriceMode = selectedType === 'stop_loss' && stopLossMode === 'price';
    const parsedPrice = isPriceMode ? parseFloat(targetPrice) : null;
    if (isPriceMode && (isNaN(parsedPrice!) || parsedPrice! <= 0)) {
      toast({ variant: 'destructive', title: 'Invalid price', description: 'Enter a valid positive target price.' });
      return;
    }

    setSaving(true);
    const insertPayload: Record<string, unknown> = {
      user_id:       userId,
      rule_type:     selectedType,
      asset:         trimmedAsset,
      threshold_pct: isPriceMode ? 0 : threshold,
      target_price:  parsedPrice ?? null,
      active:        true,
    };

    const { data, error } = await supabase
      .from('rules')
      .insert(insertPayload)
      .select('id, rule_type, asset, threshold_pct, target_price, active')
      .single();

    if (error) {
      if (error.code === '42703' && error.message.includes('target_price')) {
        const { data: d2, error: e2 } = await supabase
          .from('rules')
          .insert({ ...insertPayload, target_price: undefined })
          .select('id, rule_type, asset, threshold_pct, active')
          .single();
        if (e2) {
          toast({ variant: 'destructive', title: 'Failed to save rule', description: e2.message });
        } else {
          setRules((prev) => [{ ...d2, target_price: null } as Rule, ...prev]);
          setAdding(false);
          toast({ title: 'Rule saved', description: ruleDescription({ ...d2, target_price: null } as Rule) });
        }
      } else {
        toast({ variant: 'destructive', title: 'Failed to save rule', description: error.message });
      }
    } else {
      setRules((prev) => [data as Rule, ...prev]);
      setAdding(false);
      toast({ title: 'Rule saved', description: ruleDescription(data as Rule) });
    }
    setSaving(false);
  };

  // ── Test Trigger ─────────────────────────────────────────────────────────────
  //
  // Fire-and-forget UX: send the request, get a fast ack from the server
  // (~300-500ms — just a Supabase lookup), close the confirmation panel
  // immediately, show a toast directing the user to the Activity Log.
  // The actual OKX call continues in the background on the server.
  const handleTestTrigger = async (ruleId: string) => {
    if (!userId) return;
    setSubmittingTestId(ruleId);
    try {
      const res = await fetch(`/api/rules/${ruleId}/test-trigger`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
      const json = await res.json() as {
        ok?: boolean;
        status?: string;
        error?: string;
      };
      if (!res.ok || !json.ok) throw new Error(json.error ?? 'Unknown error');

      // ── Fast ack received — give a brief "submitted" flash then close ──
      setSubmittingTestId(null);
      setSubmittedTestId(ruleId);

      // Show submitted state briefly, then close the panel
      setTimeout(() => {
        setSubmittedTestId(null);
        setConfirmingTestId(null);
      }, 900);

      toast({
        title: '🧪 Test trigger submitted',
        description: 'Processing in background — check Activity Log shortly for the result.',
      });

    } catch (err: unknown) {
      setSubmittingTestId(null);
      toast({
        variant: 'destructive',
        title: 'Test trigger failed',
        description: (err as Error).message,
      });
    }
  };

  // ── Sign out ────────────────────────────────────────────────────────────────
  const handleSignOut = () => {
    clearWalletSession();
    setLocation('/auth');
  };

  // ── Derived ─────────────────────────────────────────────────────────────────
  const meta = selectedType ? RULE_META[selectedType] : null;

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-[100dvh] flex flex-col bg-background">
      <div className="w-full max-w-[420px] mx-auto px-4 py-10 space-y-6">

        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              Protection Rules
            </h1>
            <p className="text-sm text-muted-foreground">
              Guardian checks these every minute and acts automatically.
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

        {/* ── Rules list ─────────────────────────────────────────────────────── */}
        {loadingRules ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm">Loading rules…</span>
          </div>
        ) : rules.length === 0 && !adding ? (
          <div className="rounded-xl border border-dashed border-card-border flex flex-col items-center justify-center py-10 text-center gap-2">
            <ShieldCheck className="w-8 h-8 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">No rules yet.</p>
            <p className="text-xs text-muted-foreground/60">Add your first protection rule below.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {rules.map((rule) => (
              <Fragment key={rule.id}>
                <RuleCard
                  rule={rule}
                  onToggle={handleToggle}
                  onDelete={handleDelete}
                  onTestTrigger={(id) => {
                    setConfirmingTestId(confirmingTestId === id ? null : id);
                  }}
                />

                {/* ── Test Trigger confirmation panel ── */}
                {confirmingTestId === rule.id && (
                  <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 space-y-3 -mt-1">
                    {/* Label */}
                    <div className="flex items-center gap-2">
                      <FlaskConical className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                      <p className="text-xs font-semibold text-amber-400 uppercase tracking-wide">
                        Test Trigger
                      </p>
                    </div>

                    {/* Explanation */}
                    <p className="text-xs text-amber-400/75 leading-relaxed">
                      This will immediately execute this rule's action for demo
                      purposes, ignoring current market conditions.{' '}
                      {rule.rule_type === 'stop_loss'
                        ? 'A real market sell order will be placed via OKX (respecting demo/live mode). OKX may take a moment to process — the result will appear in your Activity Log on the Dashboard.'
                        : 'An alert entry will be written to your Activity Log on the Dashboard.'}
                    </p>

                    {/* Buttons */}
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setConfirmingTestId(null)}
                        disabled={submittingTestId === rule.id || submittedTestId === rule.id}
                        className="flex-1 text-xs border-amber-500/30 text-amber-400/70 hover:text-amber-400 hover:bg-amber-500/5"
                      >
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => handleTestTrigger(rule.id)}
                        disabled={submittingTestId === rule.id || submittedTestId === rule.id}
                        className={[
                          'flex-1 text-xs font-semibold gap-1.5 transition-colors',
                          submittedTestId === rule.id
                            ? 'bg-green-500 hover:bg-green-500 text-white'
                            : 'bg-amber-500 hover:bg-amber-400 text-black',
                        ].join(' ')}
                      >
                        {submittingTestId === rule.id ? (
                          <>
                            <Loader2 className="w-3 h-3 animate-spin" />
                            Submitting…
                          </>
                        ) : submittedTestId === rule.id ? (
                          <>
                            <CheckCircle2 className="w-3 h-3" />
                            Submitted!
                          </>
                        ) : (
                          <>
                            <FlaskConical className="w-3 h-3" />
                            Confirm
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                )}
              </Fragment>
            ))}
          </div>
        )}

        {/* ── Add Rule panel ──────────────────────────────────────────────────── */}
        {!adding ? (
          <Button
            onClick={openAdd}
            className="w-full h-11 bg-primary hover:bg-primary/90 text-primary-foreground font-medium gap-2"
            data-testid="btn-add-rule"
          >
            <Plus className="w-4 h-4" />
            Add Rule
          </Button>
        ) : (
          <div className="rounded-2xl border border-card-border bg-card overflow-hidden">

            {/* ── Step 1: pick type ───────────────────────────────────────────── */}
            {addStep === 'type' && (
              <div className="p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-foreground">Choose rule type</p>
                  <button
                    onClick={cancelAdd}
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Cancel
                  </button>
                </div>

                <div className="space-y-2">
                  {RULE_TYPE_ORDER.map((type) => {
                    const m = RULE_META[type];
                    return (
                      <button
                        key={type}
                        onClick={() => pickType(type)}
                        data-testid={`rule-type-${type}`}
                        className="w-full text-left rounded-xl border border-card-border bg-background hover:border-primary/40 hover:bg-primary/5 transition-all p-4 flex gap-3 group"
                      >
                        <div className="shrink-0 w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                          {m.icon}
                        </div>
                        <div>
                          <p className="text-sm font-medium text-foreground">{m.label}</p>
                          <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{m.description}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── Step 2: asset + threshold ───────────────────────────────────── */}
            {addStep === 'details' && meta && selectedType && (
              <div className="p-5 space-y-5">
                {/* Step header */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setAddStep('type')}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                    aria-label="Back to rule type"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-md bg-primary/10 text-primary flex items-center justify-center">
                      {meta.icon}
                    </div>
                    <p className="text-sm font-semibold text-foreground">{meta.label}</p>
                  </div>
                </div>

                {/* Asset input */}
                <div className="space-y-2">
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Token
                  </label>
                  <input
                    type="text"
                    value={asset}
                    onChange={(e) => setAsset(e.target.value.toUpperCase())}
                    placeholder="e.g. SOL, BTC, ETH"
                    maxLength={10}
                    autoFocus
                    data-testid="input-asset"
                    className="w-full h-11 rounded-lg bg-input border border-border px-3 text-sm font-mono text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>

                {/* Stop-loss mode toggle — only for stop_loss */}
                {selectedType === 'stop_loss' && (
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      Trigger type
                    </label>
                    <div className="flex bg-input rounded-lg p-1 border border-border">
                      <button
                        type="button"
                        onClick={() => setStopLossMode('pct')}
                        className={`flex-1 text-xs font-medium py-2 px-2 rounded-md transition-colors ${
                          stopLossMode === 'pct'
                            ? 'bg-card text-foreground shadow-sm'
                            : 'text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        Drop by %
                      </button>
                      <button
                        type="button"
                        onClick={() => setStopLossMode('price')}
                        className={`flex-1 text-xs font-medium py-2 px-2 rounded-md transition-colors ${
                          stopLossMode === 'price'
                            ? 'bg-card text-foreground shadow-sm'
                            : 'text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        Exact price
                      </button>
                    </div>
                  </div>
                )}

                {/* Threshold — shown for pct mode OR non-stop_loss rules */}
                {!(selectedType === 'stop_loss' && stopLossMode === 'price') && (
                  <div className="space-y-3">
                    <div className="flex items-baseline justify-between">
                      <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                        Threshold
                      </label>
                      <span className="text-xl font-semibold text-primary tabular-nums">
                        {threshold}%
                      </span>
                    </div>

                    <input
                      type="range"
                      min={meta.min}
                      max={meta.max}
                      step={meta.step}
                      value={threshold}
                      onChange={(e) => setThreshold(Number(e.target.value))}
                      data-testid="slider-threshold"
                      className="w-full accent-primary h-2 cursor-pointer"
                    />

                    <div className="flex justify-between text-xs text-muted-foreground/60">
                      <span>{meta.min}%</span>
                      <span>{meta.max}%</span>
                    </div>

                    <p className="text-xs text-muted-foreground/80 leading-relaxed bg-muted/30 rounded-lg p-3">
                      {meta.helperText(threshold)}
                    </p>
                  </div>
                )}

                {/* Price target — shown for stop_loss + price mode */}
                {selectedType === 'stop_loss' && stopLossMode === 'price' && (
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      Target price (USD)
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground font-medium pointer-events-none">
                        $
                      </span>
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={targetPrice}
                        onChange={(e) => setTargetPrice(e.target.value)}
                        placeholder="e.g. 58000"
                        data-testid="input-target-price"
                        className="w-full h-11 rounded-lg bg-input border border-border pl-7 pr-3 text-sm font-mono text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                    </div>
                    <p className="text-xs text-muted-foreground/80 leading-relaxed bg-muted/30 rounded-lg p-3">
                      Guardian will place a market sell if the {asset.trim() || 'asset'} price falls to or below this value.
                    </p>
                  </div>
                )}

                {/* Preview */}
                {asset.trim() && (
                  <div className="rounded-lg bg-primary/5 border border-primary/20 px-3 py-2">
                    <p className="text-xs text-primary/80 font-medium">
                      {selectedType === 'stop_loss' && stopLossMode === 'price'
                        ? targetPrice
                          ? `Sell ${asset.trim().toUpperCase()} if price drops to ${parseFloat(targetPrice).toLocaleString()}`
                          : `Sell ${asset.trim().toUpperCase()} if price drops to… (enter a price above)`
                        : meta.plain(asset.trim().toUpperCase(), threshold)
                      }
                    </p>
                  </div>
                )}

                {/* Actions */}
                <div className="flex gap-2 pt-1">
                  <Button
                    variant="outline"
                    onClick={cancelAdd}
                    className="flex-1 h-10 text-sm border-card-border text-muted-foreground hover:text-foreground hover:bg-white/5"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleSave}
                    disabled={
                      saving ||
                      !asset.trim() ||
                      (selectedType === 'stop_loss' && stopLossMode === 'price' && !targetPrice.trim())
                    }
                    className="flex-1 h-10 text-sm bg-primary hover:bg-primary/90 text-primary-foreground font-medium"
                    data-testid="btn-save-rule"
                  >
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save Rule'}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <BottomNav />
    </div>
  );
}
