'use client';

import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';
import { Plus, ChevronDown, ChevronUp } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

type InterventionType =
  | 'dose_adjustment'
  | 'drug_change'
  | 'side_effect_management'
  | 'adherence_support'
  | 'prescriber_consultation'
  | 'patient_education'
  | 'other';

const INTERVENTION_TYPE_LABELS: Record<InterventionType, string> = {
  dose_adjustment: '用量調整',
  drug_change: '薬剤変更',
  side_effect_management: '副作用対応',
  adherence_support: '服薬支援',
  prescriber_consultation: '処方医相談',
  patient_education: '患者指導',
  other: 'その他',
};

const INTERVENTION_TYPE_COLORS: Record<InterventionType, string> = {
  dose_adjustment: 'border-blue-200 bg-blue-50 text-blue-700',
  drug_change: 'border-purple-200 bg-purple-50 text-purple-700',
  side_effect_management: 'border-red-200 bg-red-50 text-red-700',
  adherence_support: 'border-green-200 bg-green-50 text-green-700',
  prescriber_consultation: 'border-orange-200 bg-orange-50 text-orange-700',
  patient_education: 'border-teal-200 bg-teal-50 text-teal-700',
  other: 'border-slate-200 bg-slate-50 text-slate-600',
};

export type Intervention = {
  id: string;
  patient_id: string;
  issue_id: string | null;
  type: InterventionType;
  description: string;
  outcome: string | null;
  performed_by: string;
  performed_at: string;
  created_at: string;
};

type InterventionRowProps = {
  intervention: Intervention;
  onOutcomeUpdate?: (id: string, outcome: string) => void;
};

function InterventionRow({ intervention, onOutcomeUpdate }: InterventionRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [outcomeText, setOutcomeText] = useState(intervention.outcome ?? '');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const typeLabel = INTERVENTION_TYPE_LABELS[intervention.type] ?? intervention.type;
  const typeColor = INTERVENTION_TYPE_COLORS[intervention.type] ?? INTERVENTION_TYPE_COLORS.other;

  async function saveOutcome() {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/interventions/${intervention.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outcome: outcomeText }),
      });
      if (res.ok) {
        onOutcomeUpdate?.(intervention.id, outcomeText);
        setEditing(false);
      } else {
        setSaveError('保存に失敗しました');
      }
    } catch {
      setSaveError('ネットワークエラーが発生しました');
    } finally {
      setSaving(false);
    }
  }

  return (
    <li className="rounded-md border bg-card p-3 text-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className={cn('text-[11px] font-medium py-0', typeColor)}>
            {typeLabel}
          </Badge>
          <span className="text-xs text-muted-foreground">
            {format(new Date(intervention.performed_at), 'yyyy/MM/dd HH:mm', { locale: ja })}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="shrink-0 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-expanded={expanded}
        >
          {expanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
        </button>
      </div>

      <p className="mt-1.5 text-sm">{intervention.description}</p>

      {expanded && (
        <div className="mt-2 space-y-2 border-t pt-2">
          <div>
            <p className="text-xs font-medium text-muted-foreground">介入結果</p>
            {editing ? (
              <div className="mt-1 space-y-2">
                <Textarea
                  value={outcomeText}
                  onChange={(e) => setOutcomeText(e.target.value)}
                  rows={2}
                  className="text-sm"
                  placeholder="介入の結果・効果を記録..."
                />
                {saveError && (
                  <p className="text-xs text-destructive">{saveError}</p>
                )}
                <div className="flex gap-2">
                  <Button size="sm" onClick={saveOutcome} disabled={saving}>
                    {saving ? '保存中...' : '保存'}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                    キャンセル
                  </Button>
                </div>
              </div>
            ) : (
              <div className="mt-1 flex items-start gap-2">
                <p className="flex-1 text-sm text-muted-foreground">
                  {intervention.outcome ?? '未記録'}
                </p>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-auto py-0 text-xs"
                  onClick={() => setEditing(true)}
                >
                  記録
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

type NewInterventionFormProps = {
  patientId: string;
  issueId?: string;
  onCreated: (intervention: Intervention) => void;
};

function NewInterventionForm({ patientId, issueId, onCreated }: NewInterventionFormProps) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<InterventionType>('other');
  const [description, setDescription] = useState('');
  const [performedAt, setPerformedAt] = useState(
    new Date().toISOString().slice(0, 16)
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const res = await fetch('/api/interventions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patient_id: patientId,
          issue_id: issueId,
          type,
          description,
          performed_at: new Date(performedAt).toISOString(),
        }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setError(json.message ?? '作成に失敗しました');
        return;
      }
      const json = await res.json();
      onCreated(json.data);
      setOpen(false);
      setDescription('');
      setType('other');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => setOpen(true)}>
        <Plus className="size-3" />
        介入記録
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>介入記録の追加</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <Label>介入種別</Label>
            <Select value={type} onValueChange={(v) => setType(v as InterventionType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(INTERVENTION_TYPE_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>実施日時</Label>
            <Input
              type="datetime-local"
              value={performedAt}
              onChange={(e) => setPerformedAt(e.target.value)}
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label>介入内容</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="実施した介入の内容を記録..."
              rows={3}
              required
            />
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              キャンセル
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? '保存中...' : '追加'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
    </>
  );
}

type InterventionPanelProps = {
  patientId: string;
  issueId?: string;
  initialInterventions?: Intervention[];
};

export function InterventionPanel({
  patientId,
  issueId,
  initialInterventions = [],
}: InterventionPanelProps) {
  const [interventions, setInterventions] = useState<Intervention[]>(initialInterventions);
  const [loading, setLoading] = useState(initialInterventions.length === 0);
  const [fetchError, setFetchError] = useState(false);

  useEffect(() => {
    if (initialInterventions.length > 0) return;
    let cancelled = false;
    async function load() {
      try {
        const params = new URLSearchParams({ patient_id: patientId });
        if (issueId) params.set('issue_id', issueId);
        const res = await fetch(`/api/interventions?${params.toString()}`);
        if (cancelled) return;
        if (res.ok) {
          const json = await res.json();
          setInterventions(json.data ?? []);
        } else {
          setFetchError(true);
        }
      } catch {
        if (!cancelled) setFetchError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [patientId, issueId, initialInterventions.length]);

  function handleCreated(intervention: Intervention) {
    setInterventions((prev) => [intervention, ...prev]);
  }

  function handleOutcomeUpdate(id: string, outcome: string) {
    setInterventions((prev) =>
      prev.map((i) => (i.id === id ? { ...i, outcome } : i))
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">
          介入記録
          {interventions.length > 0 && (
            <span className="ml-1.5 text-xs font-normal text-muted-foreground">
              ({interventions.length}件)
            </span>
          )}
        </h3>
        <NewInterventionForm
          patientId={patientId}
          issueId={issueId}
          onCreated={handleCreated}
        />
      </div>

      {loading ? (
        <p className="text-xs text-muted-foreground">読み込み中...</p>
      ) : fetchError ? (
        <p className="text-xs text-destructive">介入記録の読み込みに失敗しました。</p>
      ) : interventions.length === 0 ? (
        <p className="text-xs text-muted-foreground">介入記録はありません。</p>
      ) : (
        <ul className="space-y-2">
          {interventions.map((intervention) => (
            <InterventionRow
              key={intervention.id}
              intervention={intervention}
              onOutcomeUpdate={handleOutcomeUpdate}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
