import { useState, useEffect, useCallback } from 'react';
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
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { BottomNav } from '@/components/BottomNav';

// ─── Types ────────────────────────────────────────────────────────────────────

type RuleType = 'stop_loss' | 'concentration_alert' | 'rebalance_alert';

interface Rule {
  id: string;
  rule_type: RuleType;
  asset: string;
  threshold_pct: number;
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

function RuleCard({
  rule,
  onToggle,
  onDelete,
}: {
  rule: Rule;
  onToggle: (id: string, active: boolean) => void;
  onDelete: (id: string) => void;
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
          {meta.plain(rule.asset, rule.threshold_pct)}
        </p>
        <p className="text-xs text-muted-foreground/70 mt-0.5">
          {meta.label}
        </p>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-1 shrink-0 ml-1">
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
  const { userId } = useAuth();
  const { toast } = useToast();

  // ── Data state ──────────────────────────────────────────────────────────────
  const [rules, setRules] = useState<Rule[]>([]);
  const [loadingRules, setLoadingRules] = useState(true);

  // ── Add-rule form state ─────────────────────────────────────────────────────
  const [adding, setAdding] = useState(false);
  const [addStep, setAddStep] = useState<AddStep>('type');
  const [selectedType, setSelectedType] = useState<RuleType | null>(null);
  const [asset, setAsset] = useState('');
  const [threshold, setThreshold] = useState(15);
  const [saving, setSaving] = useState(false);

  // ── Fetch rules ─────────────────────────────────────────────────────────────
  const fetchRules = useCallback(async () => {
    if (!userId) return;
    const { data, error } = await supabase
      .from('rules')
      .select('id, rule_type, asset, threshold_pct, active')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

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
    // Optimistic update
    setRules((prev) =>
      prev.map((r) => (r.id === id ? { ...r, active: !currentActive } : r)),
    );
    const { error } = await supabase
      .from('rules')
      .update({ active: !currentActive })
      .eq('id', id);

    if (error) {
      // Roll back
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
      fetchRules(); // re-sync
    }
  };

  // ── Open add form ───────────────────────────────────────────────────────────
  const openAdd = () => {
    setSelectedType(null);
    setAsset('');
    setThreshold(15);
    setAddStep('type');
    setAdding(true);
  };

  const cancelAdd = () => setAdding(false);

  // ── Select rule type → step 2 ───────────────────────────────────────────────
  const pickType = (type: RuleType) => {
    setSelectedType(type);
    setThreshold(RULE_META[type].defaultThreshold);
    setAsset('');
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

    setSaving(true);
    const { data, error } = await supabase
      .from('rules')
      .insert({
        user_id: userId,
        rule_type: selectedType,
        asset: trimmedAsset,
        threshold_pct: threshold,
        active: true,
      })
      .select('id, rule_type, asset, threshold_pct, active')
      .single();

    if (error) {
      toast({ variant: 'destructive', title: 'Failed to save rule', description: error.message });
    } else {
      setRules((prev) => [data as Rule, ...prev]);
      setAdding(false);
      toast({ title: 'Rule saved', description: RULE_META[selectedType].plain(trimmedAsset, threshold) });
    }
    setSaving(false);
  };

  // ── Derived ─────────────────────────────────────────────────────────────────
  const meta = selectedType ? RULE_META[selectedType] : null;

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-[100dvh] flex flex-col bg-background">
      <div className="w-full max-w-[420px] mx-auto px-4 py-10 space-y-6">

        {/* Header */}
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Protection Rules
          </h1>
          <p className="text-sm text-muted-foreground">
            Guardian checks these every minute and acts automatically.
          </p>
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
              <RuleCard
                key={rule.id}
                rule={rule}
                onToggle={handleToggle}
                onDelete={handleDelete}
              />
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

                {/* Threshold slider */}
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

                {/* Preview */}
                {asset.trim() && (
                  <div className="rounded-lg bg-primary/5 border border-primary/20 px-3 py-2">
                    <p className="text-xs text-primary/80 font-medium">
                      {meta.plain(asset.trim().toUpperCase(), threshold)}
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
                    disabled={saving || !asset.trim()}
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
