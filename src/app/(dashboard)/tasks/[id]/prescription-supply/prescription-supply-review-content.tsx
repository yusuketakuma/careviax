'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { z } from 'zod';

import { PageScaffold } from '@/components/layout/page-scaffold';
import { PageSection } from '@/components/layout/page-section';
import { WorkflowPageHeader } from '@/components/features/workflow/workflow-page-header';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { PatientPinnedHeader } from '@/components/ui/patient-pinned-header';
import { SegmentError, SegmentLoading } from '@/components/ui/segment-state';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { buildOrgHeaders, buildOrgJsonHeaders } from '@/lib/api/org-headers';
import { readApiJson } from '@/lib/api/client-json';
import { useOrgId } from '@/lib/hooks/use-org-id';
import {
  prescriptionSupplyReviewEnvelopeSchema,
  type PrescriptionSupplyReviewDetail,
} from '@/lib/tasks/prescription-supply-review-contract';
import { formatDateTimeLabel } from '@/lib/ui/date-format';
import { messageFromError } from '@/lib/utils/error-message';

const applyEnvelopeSchema = z
  .object({
    data: z
      .object({
        prescription_line_id: z.string(),
        stock_item_id: z.string(),
        stock_event_id: z.string(),
        snapshot: z.object({ current_quantity: z.number().nullable() }).passthrough(),
        idempotent_replay: z.boolean(),
      })
      .passthrough(),
  })
  .strict();

const UNIT_LABELS: Record<string, string> = {
  tablet: '錠',
  capsule: 'カプセル',
  packet: '包',
  sheet: '枚',
  patch: '貼',
  ml: 'mL',
  g: 'g',
  dose: '回',
  bottle: '本',
  tube: '本',
  other: '個',
};

const REASON_LABELS: Record<string, string> = {
  ambiguous_stock_item: '候補となる残数台帳が複数あります。',
  existing_stock_item_missing: '紐づけ可能な既存の残数台帳がありません。',
  unresolved_drug_identity: '処方薬の薬剤識別情報を解決できません。',
  name_only_identity: '薬剤名だけでは残数台帳へ安全に紐づけられません。',
  package_only_identity: '包装コードに対応する包装マスタを特定できません。',
  ambiguous_package_identity: '包装コードに複数の包装マスタ候補があります。',
  package_metadata_missing: '包装数量または包装単位が不足しています。',
  package_level_unsupported: '販売包装以外の包装コードは自動換算できません。',
  package_quantity_invalid: '包装数量を安全な供給量へ換算できません。',
  unsupported_unit: '処方数量の単位に対応していません。',
  unit_conversion_required: '処方供給と残数台帳の単位が一致しません。',
  quantity_missing: '処方供給量が入力されていません。',
  quantity_non_positive: '処方供給量は0より大きい必要があります。',
  equivalence_review_pending: '薬剤名寄せの確認が完了していません。',
  non_stock_relevant_line: 'この処方行は外用薬・頓服薬の残数管理対象ではありません。',
  existing_stock_item_available: '同一薬剤の既存台帳が見つかりました。',
};

type ManagingParty = 'patient' | 'family' | 'facility' | 'pharmacy';
type ApplyCommand = { stock_item_id: string } | { create_new: true; managing_party: ManagingParty };

function unitLabel(unit: string) {
  return UNIT_LABELS[unit] ?? unit;
}

function reasonLabel(reason: string | null) {
  if (!reason) return null;
  return REASON_LABELS[reason] ?? '安全な自動紐づけ条件を満たしていません。';
}

function ReviewBody({
  detail,
  selectedId,
  onSelect,
}: {
  detail: PrescriptionSupplyReviewDetail;
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const preview = detail.preview;
  const line = preview.line;

  return (
    <div className="space-y-6">
      <PatientPinnedHeader
        name={detail.patient.name}
        kana={detail.patient.name_kana}
        birthDate={detail.patient.birth_date}
        meta={detail.patient.display_id ?? '患者ID未採番'}
      />

      <PageSection
        title="処方供給の根拠"
        description="患者・薬剤・用法・数量を照合してから、反映先の残数台帳を選択してください。"
      >
        <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="text-xs font-medium text-muted-foreground">薬剤</dt>
            <dd className="mt-1 font-medium">{line.drug_name}</dd>
            <dd className="text-xs text-muted-foreground">
              {line.drug_code ?? '薬剤コード未設定'}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-muted-foreground">用法・用量</dt>
            <dd className="mt-1">{line.dose}</dd>
            <dd className="text-xs text-muted-foreground">{line.frequency}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-muted-foreground">投与日数</dt>
            <dd className="mt-1 tabular-nums">{line.days}日</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-muted-foreground">処方供給量</dt>
            <dd className="mt-1 tabular-nums">
              {preview.kind === 'reviewable'
                ? `${preview.normalized_supply.quantity} ${unitLabel(preview.normalized_supply.unit)}`
                : line.quantity == null
                  ? '未入力'
                  : `${line.quantity} ${line.unit ?? ''}`}
            </dd>
          </div>
        </dl>
      </PageSection>

      {preview.kind === 'blocked' ? (
        <Alert variant="destructive" role="alert">
          <AlertTitle>既存台帳へ反映できません</AlertTitle>
          <AlertDescription>
            {reasonLabel(preview.reason_code)}{' '}
            処方情報または薬剤マスタを整備してから再確認してください。
          </AlertDescription>
        </Alert>
      ) : (
        <PageSection
          title="反映先の残数台帳"
          description="同一患者・同一薬剤・同一包装の候補だけを表示しています。確定時にもサーバーで再検証します。"
        >
          {preview.candidates.length === 0 ? (
            <Alert role="status">
              <AlertTitle>選択できる既存台帳がありません</AlertTitle>
              <AlertDescription>
                薬剤名寄せまたは残数台帳を整備した後、このタスクを再読み込みしてください。
              </AlertDescription>
            </Alert>
          ) : (
            <fieldset className="space-y-3">
              <legend className="sr-only">処方供給の反映先</legend>
              {preview.candidates.map((candidate) => {
                const disabled = !candidate.applicable;
                return (
                  <label
                    key={candidate.id}
                    className="flex min-h-11 cursor-pointer items-start gap-3 rounded-md border border-border/70 p-4 has-[:checked]:border-primary has-[:checked]:ring-2 has-[:checked]:ring-primary/20 has-[:disabled]:cursor-not-allowed has-[:disabled]:bg-muted/40"
                  >
                    <input
                      type="radio"
                      name="stock-item"
                      value={candidate.id}
                      checked={selectedId === candidate.id}
                      disabled={disabled}
                      onChange={() => onSelect(candidate.id)}
                      aria-label={candidate.display_name}
                      className="mt-1 size-4 accent-primary"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{candidate.display_name}</span>
                        {candidate.display_id ? (
                          <Badge variant="outline">{candidate.display_id}</Badge>
                        ) : null}
                        {!candidate.applicable ? <Badge variant="secondary">反映不可</Badge> : null}
                      </span>
                      <span className="mt-1 block text-sm text-muted-foreground">
                        現在残数:{' '}
                        <span className="tabular-nums">
                          {candidate.current_quantity == null
                            ? '未算出'
                            : `${candidate.current_quantity} ${unitLabel(candidate.unit)}`}
                        </span>
                        {' / '}単位: {unitLabel(candidate.unit)}
                      </span>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {candidate.snapshot_calculated_at
                          ? `最終計算: ${formatDateTimeLabel(candidate.snapshot_calculated_at)}`
                          : '残数スナップショットなし'}
                        {!candidate.applicable
                          ? ' / 単位一致または薬剤名寄せ完了を確認してください。'
                          : ''}
                      </span>
                    </span>
                  </label>
                );
              })}
            </fieldset>
          )}
        </PageSection>
      )}
    </div>
  );
}

export function PrescriptionSupplyReviewContent({ taskId }: { taskId: string }) {
  const orgId = useOrgId();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [managingParty, setManagingParty] = useState<ManagingParty | ''>('');
  const apiPath = `/api/tasks/${encodeURIComponent(taskId)}/prescription-supply/resolve`;
  const query = useQuery({
    queryKey: ['prescription-supply-review', orgId, taskId],
    enabled: Boolean(orgId && taskId),
    queryFn: async () => {
      const response = await fetch(apiPath, {
        method: 'GET',
        headers: buildOrgHeaders(orgId),
        cache: 'no-store',
      });
      const envelope = await readApiJson(response, {
        fallbackMessage: '処方供給の確認情報を取得できませんでした',
        schema: prescriptionSupplyReviewEnvelopeSchema,
      });
      return envelope.data;
    },
  });
  const mutation = useMutation({
    mutationFn: async (command: ApplyCommand) => {
      const response = await fetch(apiPath, {
        method: 'POST',
        headers: buildOrgJsonHeaders(orgId),
        body: JSON.stringify(command),
      });
      return readApiJson(response, {
        fallbackMessage: '処方供給を残数台帳へ反映できませんでした',
        schema: applyEnvelopeSchema,
      });
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['tasks', orgId] }),
        queryClient.invalidateQueries({ queryKey: ['tasks-health-board', orgId] }),
      ]);
      toast.success('処方供給を残数台帳へ反映しました');
      router.push('/tasks?status=pending');
      router.refresh();
    },
  });

  const selectCandidate = (id: string) => {
    setSelectedId(id);
    setConfirmed(false);
    mutation.reset();
  };
  const selectedCandidate =
    query.data?.preview.kind === 'reviewable'
      ? query.data.preview.candidates.find((candidate) => candidate.id === selectedId)
      : undefined;
  const canApply = Boolean(selectedCandidate?.applicable && confirmed && !mutation.isPending);
  const canCreateAndApply = Boolean(
    query.data?.preview.kind === 'reviewable' &&
    query.data.preview.candidates.length === 0 &&
    managingParty &&
    confirmed &&
    !mutation.isPending,
  );

  return (
    <PageScaffold variant="bare">
      <WorkflowPageHeader
        eyebrow="残数台帳"
        title="処方供給の紐づけ確認"
        description="処方供給量を、確認済みの既存残数台帳へ反映"
        action={{ href: '/tasks?status=pending', label: 'タスク一覧へ戻る' }}
      />

      {query.isPending ? (
        <SegmentLoading label="患者・処方・残数台帳を読み込み中" rows={4} cols={3} />
      ) : query.isError || !query.data ? (
        <SegmentError
          title="処方供給の確認情報を表示できません"
          cause={messageFromError(query.error, '確認情報の取得に失敗しました。')}
          nextAction="担当範囲とタスク状態を確認して再読み込みしてください。"
          onRetry={() => void query.refetch()}
        />
      ) : (
        <>
          <ReviewBody detail={query.data} selectedId={selectedId} onSelect={selectCandidate} />

          {mutation.isError ? (
            <Alert variant="destructive" role="alert">
              <AlertTitle>反映できませんでした</AlertTitle>
              <AlertDescription>
                {messageFromError(mutation.error, '候補の状態を再確認してください。')}
              </AlertDescription>
            </Alert>
          ) : null}

          {query.data.preview.kind === 'reviewable' &&
          query.data.preview.candidates.some((candidate) => candidate.applicable) ? (
            <PageSection
              title="反映内容の確定"
              description="選択した台帳へ処方供給イベントを追記し、このタスクを完了します。"
              tone="warning"
            >
              <div className="space-y-4">
                <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-md border border-state-confirm/30 bg-background p-3">
                  <Checkbox
                    checked={confirmed}
                    disabled={!selectedCandidate?.applicable || mutation.isPending}
                    onCheckedChange={(checked) => setConfirmed(checked === true)}
                    aria-describedby="prescription-supply-confirmation-description"
                  />
                  <span id="prescription-supply-confirmation-description" className="text-sm">
                    患者・薬剤・供給量・反映先台帳を照合しました
                  </span>
                </label>

                <AlertDialog>
                  <AlertDialogTrigger
                    render={
                      <Button type="button" size="lg" disabled={!canApply} className="min-h-11" />
                    }
                  >
                    <CheckCircle2 className="size-4" aria-hidden="true" />
                    選択した台帳へ反映
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>処方供給を反映しますか？</AlertDialogTitle>
                      <AlertDialogDescription>
                        {query.data.patient.name} / {query.data.preview.line.drug_name} /{' '}
                        {query.data.preview.normalized_supply.quantity}{' '}
                        {unitLabel(query.data.preview.normalized_supply.unit)} を「
                        {selectedCandidate?.display_name ?? '未選択'}」へ追記します。
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel disabled={mutation.isPending}>
                        キャンセル
                      </AlertDialogCancel>
                      <AlertDialogAction
                        disabled={!canApply}
                        onClick={() => selectedId && mutation.mutate({ stock_item_id: selectedId })}
                      >
                        {mutation.isPending ? '反映中...' : '反映してタスクを完了'}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </PageSection>
          ) : null}

          {query.data.preview.kind === 'reviewable' &&
          query.data.preview.candidates.length === 0 ? (
            <PageSection
              title="新しい残数台帳を作成して反映"
              description="処方の薬剤コード・包装・単位を正本として台帳を作成し、同じ処理内で供給量を反映します。"
              tone="warning"
            >
              <div className="space-y-4">
                <div className="max-w-sm space-y-2">
                  <label
                    htmlFor="prescription-supply-managing-party"
                    className="text-sm font-medium"
                  >
                    主な管理者
                  </label>
                  <Select
                    value={managingParty}
                    onValueChange={(value) => {
                      setManagingParty(value as ManagingParty);
                      setConfirmed(false);
                      mutation.reset();
                    }}
                  >
                    <SelectTrigger
                      id="prescription-supply-managing-party"
                      className="min-h-11 w-full"
                    >
                      <SelectValue placeholder="管理者を選択" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="patient">患者本人</SelectItem>
                      <SelectItem value="family">家族</SelectItem>
                      <SelectItem value="facility">施設</SelectItem>
                      <SelectItem value="pharmacy">薬局</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-md border border-state-confirm/30 bg-background p-3">
                  <Checkbox
                    checked={confirmed}
                    disabled={!managingParty || mutation.isPending}
                    onCheckedChange={(checked) => setConfirmed(checked === true)}
                    aria-describedby="prescription-supply-create-confirmation-description"
                  />
                  <span
                    id="prescription-supply-create-confirmation-description"
                    className="text-sm"
                  >
                    患者・薬剤コード・包装・供給単位・管理者を照合しました
                  </span>
                </label>

                <AlertDialog>
                  <AlertDialogTrigger
                    render={
                      <Button
                        type="button"
                        size="lg"
                        disabled={!canCreateAndApply}
                        className="min-h-11"
                      />
                    }
                  >
                    <CheckCircle2 className="size-4" aria-hidden="true" />
                    台帳を作成して反映
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>新しい残数台帳を作成しますか？</AlertDialogTitle>
                      <AlertDialogDescription>
                        {query.data.patient.name} / {query.data.preview.line.drug_name} /{' '}
                        {query.data.preview.normalized_supply.quantity}{' '}
                        {unitLabel(query.data.preview.normalized_supply.unit)}
                        の台帳を作成し、処方供給を反映します。既存台帳が見つかった場合は作成せず停止します。
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel disabled={mutation.isPending}>
                        キャンセル
                      </AlertDialogCancel>
                      <AlertDialogAction
                        disabled={!canCreateAndApply}
                        onClick={() =>
                          managingParty &&
                          mutation.mutate({ create_new: true, managing_party: managingParty })
                        }
                      >
                        {mutation.isPending ? '作成・反映中...' : '作成してタスクを完了'}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </PageSection>
          ) : null}
        </>
      )}
    </PageScaffold>
  );
}
