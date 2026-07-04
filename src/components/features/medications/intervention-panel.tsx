'use client';

import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { ja } from 'date-fns/locale';
import { Plus, ChevronDown, ChevronUp } from 'lucide-react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { SkeletonRows } from '@/components/ui/loading';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { FormErrorSummary } from '@/components/ui/form-error-summary';
import { LoadingButton } from '@/components/ui/loading-button';
import { collectFormErrorSummaryItems } from '@/lib/forms/errors';
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

// 介入種別の識別色(カテゴリ区別であり status ではない)。--intervention-* トークン。
// 小バッジ限定: border + 最小 fill(/10) + text(§L311-317)。other は中立(neutral)。
const INTERVENTION_TYPE_COLORS: Record<InterventionType, string> = {
  dose_adjustment:
    'border-intervention-dose-adjustment/30 bg-intervention-dose-adjustment/10 text-intervention-dose-adjustment',
  drug_change:
    'border-intervention-drug-change/30 bg-intervention-drug-change/10 text-intervention-drug-change',
  side_effect_management:
    'border-intervention-side-effect-management/30 bg-intervention-side-effect-management/10 text-intervention-side-effect-management',
  adherence_support:
    'border-intervention-adherence-support/30 bg-intervention-adherence-support/10 text-intervention-adherence-support',
  prescriber_consultation:
    'border-intervention-prescriber-consultation/30 bg-intervention-prescriber-consultation/10 text-intervention-prescriber-consultation',
  patient_education:
    'border-intervention-patient-education/30 bg-intervention-patient-education/10 text-intervention-patient-education',
  other: 'border-border bg-muted text-muted-foreground',
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
                {saveError && <p className="text-xs text-destructive">{saveError}</p>}
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

// datetime-local はローカル壁時計を期待するため、UTC ISO ではなく getTimezoneOffset 補正値を使う
function toLocalDateTimeInputValue(value: Date) {
  const offsetMs = value.getTimezoneOffset() * 60_000;
  return new Date(value.getTime() - offsetMs).toISOString().slice(0, 16);
}

const interventionTypeValues = Object.keys(INTERVENTION_TYPE_LABELS) as [
  InterventionType,
  ...InterventionType[],
];

const newInterventionSchema = z.object({
  type: z.enum(interventionTypeValues, { error: '介入種別を選択してください' }),
  // 元実装は raw 値をそのまま送信し API 側 createInterventionSchema も z.string().min(1)(trim なし)。
  // RHF 移行で挙動を変えないため trim は行わない。
  description: z.string().min(1, '介入内容を入力してください'),
  performedAt: z.string().min(1, '実施日時を入力してください'),
});

type NewInterventionFormValues = z.infer<typeof newInterventionSchema>;

function NewInterventionForm({ patientId, issueId, onCreated }: NewInterventionFormProps) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  // API/ネットワーク由来のエラー(サーバー応答文言)。zod のフィールド検証エラーとは別枠で表示する。
  const [apiError, setApiError] = useState<string | null>(null);
  const errorSummaryId = 'new-intervention-error-summary';

  const form = useForm<NewInterventionFormValues>({
    resolver: zodResolver(newInterventionSchema),
    defaultValues: {
      type: 'other',
      description: '',
      performedAt: toLocalDateTimeInputValue(new Date()),
    },
  });
  const {
    register,
    handleSubmit,
    control,
    reset,
    getValues,
    formState: { errors },
  } = form;

  const errorSummaryItems = collectFormErrorSummaryItems(errors, {
    type: '介入種別',
    description: '介入内容',
    performedAt: '実施日時',
  });

  // referral-form と同じく、無効送信時はエラーサマリへフォーカスを移す(WCAG AA)。
  function focusErrorSummary() {
    if (typeof document === 'undefined') return;
    document.getElementById(errorSummaryId)?.focus();
  }

  async function onSubmit(data: NewInterventionFormValues) {
    setApiError(null);
    setSaving(true);
    try {
      const res = await fetch('/api/interventions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patient_id: patientId,
          issue_id: issueId,
          type: data.type,
          description: data.description,
          performed_at: new Date(data.performedAt).toISOString(),
        }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setApiError(json.message ?? '作成に失敗しました');
        return;
      }
      const json = await res.json();
      onCreated(json.data);
      setOpen(false);
      // performedAt は元実装同様リセットしない(直近入力値を保持)。
      reset({ type: 'other', description: '', performedAt: getValues('performedAt') });
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        className="h-7 gap-1 text-xs"
        onClick={() => setOpen(true)}
      >
        <Plus className="size-3" />
        介入記録
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>介入記録の追加</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={handleSubmit(onSubmit, focusErrorSummary)}
            noValidate
            className="space-y-4 pt-2"
          >
            <FormErrorSummary id={errorSummaryId} items={errorSummaryItems} />

            <div className="space-y-1.5">
              <Label htmlFor="intervention-type">介入種別</Label>
              <Controller
                control={control}
                name="type"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="intervention-type" aria-invalid={!!errors.type}>
                      <SelectValue>
                        {INTERVENTION_TYPE_LABELS[field.value] ?? field.value}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(INTERVENTION_TYPE_LABELS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="intervention-performed-at">実施日時</Label>
              <Input
                id="intervention-performed-at"
                type="datetime-local"
                aria-invalid={!!errors.performedAt}
                {...register('performedAt')}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="intervention-description">介入内容</Label>
              <Textarea
                id="intervention-description"
                placeholder="実施した介入の内容を記録..."
                rows={3}
                aria-invalid={!!errors.description}
                {...register('description')}
              />
            </div>

            {apiError && <p className="text-xs text-destructive">{apiError}</p>}

            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                キャンセル
              </Button>
              <LoadingButton type="submit" loading={saving} loadingLabel="保存中...">
                追加
              </LoadingButton>
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
    return () => {
      cancelled = true;
    };
  }, [patientId, issueId, initialInterventions.length]);

  function handleCreated(intervention: Intervention) {
    setInterventions((prev) => [intervention, ...prev]);
  }

  function handleOutcomeUpdate(id: string, outcome: string) {
    setInterventions((prev) => prev.map((i) => (i.id === id ? { ...i, outcome } : i)));
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
        <NewInterventionForm patientId={patientId} issueId={issueId} onCreated={handleCreated} />
      </div>

      {loading ? (
        <div role="status" aria-label="介入記録を読み込み中" aria-live="polite">
          <SkeletonRows rows={2} cols={2} status={false} />
        </div>
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
