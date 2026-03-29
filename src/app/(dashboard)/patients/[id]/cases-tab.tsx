'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { caseStatusTransitions, type CaseStatus } from '@/lib/validations/case';
import {
  buildIntakeFieldRows,
  getHomeVisitIntake,
} from '@/lib/patient/intake-display';
import { ClipboardList, Plus } from 'lucide-react';

const caseStatusLabel: Record<CaseStatus, string> = {
  referral_received: '紹介受領',
  assessment: 'アセスメント',
  active: '稼働中',
  on_hold: '保留',
  discharged: '終了',
  terminated: '解約',
};

const caseStatusVariant: Record<CaseStatus, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  referral_received: 'secondary',
  assessment: 'secondary',
  active: 'default',
  on_hold: 'outline',
  discharged: 'outline',
  terminated: 'destructive',
};

type CaseRow = {
  id: string;
  status: string;
  primary_pharmacist_id: string | null;
  referral_source: string | null;
  referral_date: string | null;
  start_date: string | null;
  end_date: string | null;
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

export function CasesTab({ patient, orgId }: CasesTabProps) {
  const queryClient = useQueryClient();
  const [transition, setTransition] = useState<{
    caseId: string;
    from: CaseStatus;
    to: CaseStatus;
  } | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [assignmentDrafts, setAssignmentDrafts] = useState<Record<string, string>>({});
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
    await queryClient.invalidateQueries({ queryKey: ['patient', patient.id] });
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
    await queryClient.invalidateQueries({ queryKey: ['patient', patient.id] });
    setIsCreating(false);
  }

  async function handleAssignPrimaryPharmacist(caseId: string) {
    const value = assignmentDrafts[caseId];
    const primaryPharmacistId = value === '__unassigned__' ? '' : value;

    setSavingCaseId(caseId);
    const res = await fetch(`/api/cases/${caseId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'x-org-id': orgId,
      },
      body: JSON.stringify({ primary_pharmacist_id: primaryPharmacistId }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast.error(err.message ?? '担当薬剤師の更新に失敗しました');
      setSavingCaseId(null);
      return;
    }

    toast.success('担当薬剤師を更新しました');
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['patient', patient.id] }),
      queryClient.invalidateQueries({ queryKey: ['cases', 'schedule-planner', orgId] }),
    ]);
    setSavingCaseId(null);
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={handleCreateCase} disabled={isCreating}>
          <Plus className="mr-1 size-4" aria-hidden="true" />
          {isCreating ? '作成中...' : 'ケース追加'}
        </Button>
      </div>

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
                  <CardTitle className="text-base">
                    ケース #{c.id.slice(-6).toUpperCase()}
                  </CardTitle>
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

                {c.notes && (
                  <p className="rounded-md bg-muted/40 p-3 text-sm text-foreground">
                    {c.notes}
                  </p>
                )}

                <div className="rounded-md border bg-muted/20 p-3">
                  <p className="text-xs font-medium text-muted-foreground">担当薬剤師</p>
                  {pharmacists.length === 0 ? (
                    <p className="mt-2 text-sm text-muted-foreground">
                      薬剤師が未登録のため割当できません
                    </p>
                  ) : (
                    <>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <Select
                          value={assignmentDrafts[c.id] ?? c.primary_pharmacist_id ?? '__unassigned__'}
                          onValueChange={(value) =>
                            value
                              ? setAssignmentDrafts((current) => ({
                                  ...current,
                                  [c.id]: value,
                                }))
                              : undefined
                          }
                        >
                          <SelectTrigger className="min-w-[220px]">
                            <SelectValue placeholder="担当薬剤師を選択" />
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
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleAssignPrimaryPharmacist(c.id)}
                          disabled={savingCaseId === c.id}
                        >
                          {savingCaseId === c.id ? '保存中...' : '保存'}
                        </Button>
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground">
                        訪問候補生成ではこの薬剤師を優先し、不在時のみ代替薬剤師へエスカレーションします。
                      </p>
                    </>
                  )}
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
                            <span className="text-muted-foreground">/ {link.organization_name}</span>
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
