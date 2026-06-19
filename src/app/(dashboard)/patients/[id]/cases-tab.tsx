'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { ActionRail } from '@/components/ui/action-rail';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { caseStatusTransitions, type CaseStatus } from '@/lib/validations/case';
import { buildIntakeFieldRows, getHomeVisitIntake } from '@/lib/patient/intake-display';
import { getPatientCareQueryKeys, invalidateQueryKeys } from '@/lib/visits/query-invalidations';
import { ClipboardList, Plus } from 'lucide-react';
import {
  CASE_STATUS_LABELS as caseStatusLabel,
  CASE_STATUS_VARIANTS as caseStatusVariant,
} from '@/lib/constants/status-labels';

type CaseRow = {
  id: string;
  status: string;
  primary_pharmacist_id: string | null;
  backup_pharmacist_id: string | null;
  referral_source: string | null;
  referral_date: string | null;
  start_date: string | null;
  end_date: string | null;
  end_reason: string | null;
  notes: string | null;
  required_visit_support: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  care_team_links: Array<{
    id: string;
    role: string;
    name: string;
    organization_name: string | null;
    phone: string | null;
  }>;
};

interface CasesTabProps {
  patient: {
    id: string;
    name: string;
    cases: CaseRow[];
  };
  orgId: string;
}

type CaseEditDraft = {
  primary_pharmacist_id: string;
  backup_pharmacist_id: string;
  referral_source: string;
  referral_date: string;
  start_date: string;
  end_date: string;
  end_reason: string;
  notes: string;
};

function toDateInputValue(value: string | null) {
  return value ? value.slice(0, 10) : '';
}

function buildCaseDraft(careCase: CaseRow): CaseEditDraft {
  return {
    primary_pharmacist_id: careCase.primary_pharmacist_id ?? '__unassigned__',
    backup_pharmacist_id: careCase.backup_pharmacist_id ?? '__unassigned__',
    referral_source: careCase.referral_source ?? '',
    referral_date: toDateInputValue(careCase.referral_date),
    start_date: toDateInputValue(careCase.start_date),
    end_date: toDateInputValue(careCase.end_date),
    end_reason: careCase.end_reason ?? '',
    notes: careCase.notes ?? '',
  };
}

export function CasesTab({ patient, orgId }: CasesTabProps) {
  const queryClient = useQueryClient();
  const [transition, setTransition] = useState<{
    caseId: string;
    from: CaseStatus;
    to: CaseStatus;
  } | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [caseDrafts, setCaseDrafts] = useState<Record<string, CaseEditDraft>>({});
  const [savingCaseId, setSavingCaseId] = useState<string | null>(null);

  const { data: pharmacistsData } = useQuery({
    queryKey: ['pharmacists', orgId, 'case-assignment'],
    queryFn: async () => {
      const res = await fetch('/api/pharmacists', {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('薬剤師一覧の取得に失敗しました');
      return res.json() as Promise<{
        data: Array<{
          id: string;
          name: string;
          site_name: string | null;
        }>;
      }>;
    },
    enabled: !!orgId,
  });

  const pharmacists = pharmacistsData?.data ?? [];

  async function handleTransition() {
    if (!transition) return;
    const res = await fetch(`/api/cases/${transition.caseId}/transition`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'x-org-id': orgId,
      },
      body: JSON.stringify({ from: transition.from, to: transition.to }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast.error(err.message ?? 'ステータス変更に失敗しました');
      return;
    }

    toast.success(`ステータスを「${caseStatusLabel[transition.to]}」に変更しました`);
    await invalidateQueryKeys(
      queryClient,
      getPatientCareQueryKeys({ orgId, patientId: patient.id }),
    );
  }

  async function handleCreateCase() {
    setIsCreating(true);
    const res = await fetch('/api/cases', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-org-id': orgId,
      },
      body: JSON.stringify({ patient_id: patient.id }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast.error(err.message ?? 'ケース作成に失敗しました');
      setIsCreating(false);
      return;
    }

    toast.success('新しいケースを作成しました');
    await invalidateQueryKeys(
      queryClient,
      getPatientCareQueryKeys({ orgId, patientId: patient.id }),
    );
    setIsCreating(false);
  }

  async function handleSaveCase(caseId: string, draft: CaseEditDraft) {
    setSavingCaseId(caseId);
    const res = await fetch(`/api/cases/${caseId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'x-org-id': orgId,
      },
      body: JSON.stringify({
        primary_pharmacist_id:
          draft.primary_pharmacist_id === '__unassigned__' ? '' : draft.primary_pharmacist_id,
        backup_pharmacist_id:
          draft.backup_pharmacist_id === '__unassigned__' ? '' : draft.backup_pharmacist_id,
        referral_source: draft.referral_source,
        referral_date: draft.referral_date,
        start_date: draft.start_date,
        end_date: draft.end_date,
        end_reason: draft.end_reason,
        notes: draft.notes,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast.error(err.message ?? 'ケース情報の更新に失敗しました');
      setSavingCaseId(null);
      return;
    }

    toast.success('ケース情報を更新しました');
    await invalidateQueryKeys(
      queryClient,
      getPatientCareQueryKeys({ orgId, patientId: patient.id }),
    );
    setSavingCaseId(null);
  }

  return (
    <div className="space-y-4">
      <ActionRail>
        <Button size="sm" onClick={handleCreateCase} disabled={isCreating}>
          <Plus className="mr-1 size-4" aria-hidden="true" />
          {isCreating ? '作成中...' : 'ケース追加'}
        </Button>
      </ActionRail>

      {patient.cases.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="ケースがありません"
          description="「ケース追加」ボタンで新しいケースを作成できます"
        />
      ) : (
        patient.cases.map((c) => {
          const status = c.status as CaseStatus;
          const nextStatuses = caseStatusTransitions[status] ?? [];
          const draft = caseDrafts[c.id] ?? buildCaseDraft(c);

          const caseIntake = getHomeVisitIntake(c.required_visit_support);
          const intakeRows = buildIntakeFieldRows(caseIntake, [
            'primary_disease',
            'care_level',
            'adl_level',
            'dementia_level',
            'money_management',
            'narcotics',
            'special_medical_procedures',
            'allergy_history',
            'infection_isolation',
          ]);

          return (
            <Card key={c.id}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <h2 className="font-heading text-base leading-snug font-medium">
                    ケース #{c.id.slice(-6).toUpperCase()}
                  </h2>
                  <Badge variant={caseStatusVariant[status] ?? 'outline'}>
                    {caseStatusLabel[status] ?? status}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <dl className="grid grid-cols-2 gap-3 text-sm md:grid-cols-3">
                  <div>
                    <dt className="text-muted-foreground">紹介元</dt>
                    <dd>{c.referral_source ?? '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">紹介日</dt>
                    <dd>
                      {c.referral_date
                        ? format(parseISO(c.referral_date), 'yyyy/MM/dd', { locale: ja })
                        : '—'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">開始日</dt>
                    <dd>
                      {c.start_date
                        ? format(parseISO(c.start_date), 'yyyy/MM/dd', { locale: ja })
                        : '—'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">終了日</dt>
                    <dd>
                      {c.end_date
                        ? format(parseISO(c.end_date), 'yyyy/MM/dd', { locale: ja })
                        : '—'}
                    </dd>
                  </div>
                </dl>

                {intakeRows.length > 0 && (
                  <div className="rounded-md border border-border/60 bg-muted/10 p-3">
                    <p className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground">
                      受付時インテーク情報
                    </p>
                    <dl className="grid grid-cols-1 gap-1.5 text-sm sm:grid-cols-2">
                      {intakeRows.map((row) => (
                        <div key={row.label} className="flex gap-2">
                          <dt className="shrink-0 text-muted-foreground">{row.label}</dt>
                          <dd className="min-w-0 break-words text-foreground">{row.display}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                )}

                <div className="rounded-md border border-border/70 bg-muted/20 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h3 className="text-sm font-medium text-foreground">ケース情報</h3>
                    <ActionRail>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleSaveCase(c.id, draft)}
                        disabled={savingCaseId === c.id}
                      >
                        {savingCaseId === c.id ? '保存中...' : 'ケース情報を保存'}
                      </Button>
                    </ActionRail>
                  </div>

                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground">紹介元</label>
                      <Input
                        value={draft.referral_source}
                        onChange={(event) =>
                          setCaseDrafts((current) => ({
                            ...current,
                            [c.id]: {
                              ...draft,
                              referral_source: event.target.value,
                            },
                          }))
                        }
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground">紹介日</label>
                      <Input
                        type="date"
                        value={draft.referral_date}
                        onChange={(event) =>
                          setCaseDrafts((current) => ({
                            ...current,
                            [c.id]: {
                              ...draft,
                              referral_date: event.target.value,
                            },
                          }))
                        }
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground">開始日</label>
                      <Input
                        type="date"
                        value={draft.start_date}
                        onChange={(event) =>
                          setCaseDrafts((current) => ({
                            ...current,
                            [c.id]: {
                              ...draft,
                              start_date: event.target.value,
                            },
                          }))
                        }
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground">終了日</label>
                      <Input
                        type="date"
                        value={draft.end_date}
                        onChange={(event) =>
                          setCaseDrafts((current) => ({
                            ...current,
                            [c.id]: {
                              ...draft,
                              end_date: event.target.value,
                            },
                          }))
                        }
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label
                        htmlFor={`case-${c.id}-primary-pharmacist`}
                        className="text-xs font-medium text-muted-foreground"
                      >
                        主担当薬剤師
                      </label>
                      <Select
                        value={draft.primary_pharmacist_id}
                        onValueChange={(value) =>
                          setCaseDrafts((current) => ({
                            ...current,
                            [c.id]: {
                              ...draft,
                              primary_pharmacist_id: value ?? '__unassigned__',
                            },
                          }))
                        }
                      >
                        <SelectTrigger id={`case-${c.id}-primary-pharmacist`}>
                          <SelectValue placeholder="主担当薬剤師を選択" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__unassigned__">未設定</SelectItem>
                          {pharmacists.map((pharmacist) => (
                            <SelectItem key={pharmacist.id} value={pharmacist.id}>
                              {pharmacist.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <label
                        htmlFor={`case-${c.id}-backup-pharmacist`}
                        className="text-xs font-medium text-muted-foreground"
                      >
                        代替薬剤師
                      </label>
                      <Select
                        value={draft.backup_pharmacist_id}
                        onValueChange={(value) =>
                          setCaseDrafts((current) => ({
                            ...current,
                            [c.id]: {
                              ...draft,
                              backup_pharmacist_id: value ?? '__unassigned__',
                            },
                          }))
                        }
                      >
                        <SelectTrigger id={`case-${c.id}-backup-pharmacist`}>
                          <SelectValue placeholder="代替薬剤師を選択" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__unassigned__">未設定</SelectItem>
                          {pharmacists.map((pharmacist) => (
                            <SelectItem key={pharmacist.id} value={pharmacist.id}>
                              {pharmacist.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5 md:col-span-2">
                      <label className="text-xs font-medium text-muted-foreground">終了理由</label>
                      <Input
                        value={draft.end_reason}
                        onChange={(event) =>
                          setCaseDrafts((current) => ({
                            ...current,
                            [c.id]: {
                              ...draft,
                              end_reason: event.target.value,
                            },
                          }))
                        }
                        placeholder="終了・解約理由があれば入力"
                      />
                    </div>
                    <div className="space-y-1.5 md:col-span-2">
                      <label className="text-xs font-medium text-muted-foreground">
                        ケースメモ
                      </label>
                      <Textarea
                        rows={3}
                        value={draft.notes}
                        onChange={(event) =>
                          setCaseDrafts((current) => ({
                            ...current,
                            [c.id]: {
                              ...draft,
                              notes: event.target.value,
                            },
                          }))
                        }
                      />
                    </div>
                  </div>

                  <p className="mt-3 text-xs text-muted-foreground">
                    訪問候補生成では主担当を優先し、不在時は代替薬剤師へエスカレーションします。
                  </p>
                </div>

                {/* ケアチームリンク */}
                {c.care_team_links.length > 0 && (
                  <div>
                    <p className="mb-2 text-xs font-medium text-muted-foreground">ケアチーム</p>
                    <div className="flex flex-wrap gap-2">
                      {c.care_team_links.map((link) => (
                        <span
                          key={link.id}
                          className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/30 px-2 py-0.5 text-xs"
                        >
                          <span className="text-muted-foreground">{link.role}</span>
                          <span>{link.name}</span>
                          {link.organization_name && (
                            <span className="text-muted-foreground">
                              / {link.organization_name}
                            </span>
                          )}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* 状態遷移ボタン */}
                {nextStatuses.length > 0 && (
                  <div className="flex flex-wrap gap-2 border-t border-border pt-3">
                    <span className="self-center text-xs text-muted-foreground">遷移:</span>
                    {nextStatuses.map((nextStatus) => (
                      <Button
                        key={nextStatus}
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setTransition({ caseId: c.id, from: status, to: nextStatus })
                        }
                      >
                        {caseStatusLabel[nextStatus]}へ
                      </Button>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })
      )}

      {/* 状態遷移確認ダイアログ */}
      <ConfirmDialog
        open={transition !== null}
        onOpenChange={(open) => !open && setTransition(null)}
        title="ステータス変更の確認"
        description={
          transition
            ? `ケースのステータスを「${caseStatusLabel[transition.from]}」から「${caseStatusLabel[transition.to]}」に変更します。よろしいですか？`
            : ''
        }
        confirmLabel="変更する"
        onConfirm={handleTransition}
      />
    </div>
  );
}
