'use client';

import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/loading';
import { BlockedReasonsPanel } from '@/components/features/workspace/action-rail';
import { buildOrgHeaders, buildOrgJsonHeaders } from '@/lib/api/org-headers';
import { downscaleImage } from '@/lib/files/downscale-image';
import { useOrgId } from '@/lib/hooks/use-org-id';
import {
  buildAdjustmentConfirmDescription,
  buildResidualAdjustmentPlan,
  formatRemainingLabel,
  pickPhysicianInstructions,
  resolveLatestVisitRecordId,
  type PhysicianInstructionSource,
  type ResidualMedicationRecord,
} from './residual-adjustment.shared';

/**
 * p0_31「残薬調整」: 左=残薬の確認(薬剤カード+残N日)、
 * 中央=調整案テーブル(薬剤/残薬/今回処方/提案)+医師の指示記録、
 * 右=次にやること(残薬写真を追加/調整案を確定)の3カラム。
 * データは /api/residual-medications と /api/inquiry-records(回答済みの残薬調整照会)。
 * 確定は介入記録(dose_adjustment)として /api/interventions へ保存する。
 */

export function ResidualAdjustmentContent({ patientId }: { patientId: string }) {
  const orgId = useOrgId();
  const queryClient = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const residualQuery = useQuery({
    queryKey: ['residual-adjustment', orgId, patientId],
    queryFn: async () => {
      const params = new URLSearchParams({ patient_id: patientId, limit: '100' });
      const res = await fetch(`/api/residual-medications?${params.toString()}`, {
        headers: buildOrgHeaders(orgId),
      });
      if (!res.ok) throw new Error('残薬データの取得に失敗しました');
      return res.json() as Promise<{ data: ResidualMedicationRecord[] }>;
    },
    enabled: !!orgId && !!patientId,
  });

  const instructionQuery = useQuery({
    queryKey: ['residual-adjustment-instructions', orgId, patientId],
    queryFn: async () => {
      const params = new URLSearchParams({ patient_id: patientId, status: 'resolved' });
      const res = await fetch(`/api/inquiry-records?${params.toString()}`, {
        headers: buildOrgHeaders(orgId),
      });
      if (!res.ok) throw new Error('医師の指示記録の取得に失敗しました');
      return res.json() as Promise<{ data: PhysicianInstructionSource[] }>;
    },
    enabled: !!orgId && !!patientId,
  });

  const records = residualQuery.data?.data ?? [];
  const plan = buildResidualAdjustmentPlan(records);
  const instructions = pickPhysicianInstructions(instructionQuery.data?.data ?? []);
  const latestVisitRecordId = resolveLatestVisitRecordId(records);

  const confirmMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/interventions', {
        method: 'POST',
        headers: buildOrgJsonHeaders(orgId),
        body: JSON.stringify({
          patient_id: patientId,
          type: 'dose_adjustment',
          description: buildAdjustmentConfirmDescription(plan.rows),
          performed_at: new Date().toISOString(),
        }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) throw new Error(payload?.message ?? '調整案の確定に失敗しました');
      return payload;
    },
    onSuccess: async () => {
      toast.success('調整案を確定し、介入記録に保存しました');
      await queryClient.invalidateQueries({ queryKey: ['interventions', patientId] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '調整案の確定に失敗しました');
    },
  });

  /** 残薬写真: 既存の訪問写真アップロード動線(presigned-upload → PUT → complete)。 */
  async function uploadResidualPhoto(file: File) {
    if (!latestVisitRecordId) return;
    setUploading(true);
    try {
      // モバイル撮影画像は長辺 1600px / JPEG 品質 0.85 に縮小してから送信する(W2-F1)。
      // fail-open: 変換失敗時は元ファイルのまま送信する。
      const uploadFile = await downscaleImage(file);
      const presignRes = await fetch('/api/files/presigned-upload', {
        method: 'POST',
        headers: buildOrgJsonHeaders(orgId),
        body: JSON.stringify({
          purpose: 'visit-photo',
          file_name: uploadFile.name,
          mime_type: uploadFile.type,
          size_bytes: uploadFile.size,
          visit_record_id: latestVisitRecordId,
        }),
      });
      const presignJson = await presignRes.json().catch(() => null);
      if (!presignRes.ok) {
        throw new Error(presignJson?.message ?? 'アップロードURLの取得に失敗しました');
      }

      const uploadRes = await fetch(presignJson.data.uploadUrl, {
        method: 'PUT',
        headers: presignJson.data.headers,
        body: uploadFile,
      });
      if (!uploadRes.ok) throw new Error('残薬写真のアップロードに失敗しました');

      const completeRes = await fetch('/api/files/complete', {
        method: 'POST',
        headers: buildOrgJsonHeaders(orgId),
        body: JSON.stringify({
          file_id: presignJson.data.id,
          etag: uploadRes.headers.get('etag') ?? undefined,
        }),
      });
      if (!completeRes.ok) throw new Error('残薬写真の登録に失敗しました');

      toast.success('残薬写真を追加しました');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '残薬写真の追加に失敗しました');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  if (!orgId || residualQuery.isLoading || instructionQuery.isLoading) {
    return (
      <div
        className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1.7fr)_minmax(0,1fr)]"
        role="status"
        aria-label="残薬調整を読み込み中"
      >
        {Array.from({ length: 3 }).map((_, index) => (
          <Skeleton key={index} className="h-80 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  if (residualQuery.isError) {
    return (
      <div className="rounded-lg border border-border/70 bg-card p-4">
        <ErrorState
          variant="server"
          title="残薬調整を表示できません"
          description="残薬データの取得に失敗しました。再試行してください。"
          action={{ label: '再試行', onClick: () => void residualQuery.refetch() }}
        />
      </div>
    );
  }

  return (
    <div
      className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1.7fr)_minmax(0,1fr)]"
      data-testid="residual-adjustment-page"
    >
      {/* 可視 h1 は WorkflowPageIntro が供給するため、ここでは見出しを重複させない。 */}
      {/* 左: 残薬の確認 */}
      <section
        aria-labelledby="residual-check-heading"
        className="rounded-lg border border-border/70 bg-card p-4"
      >
        <h2 id="residual-check-heading" className="text-base font-bold text-foreground">
          残薬の確認
        </h2>
        {records.length === 0 ? (
          <p className="mt-3 rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
            残薬の記録はまだありません。訪問記録の残薬入力から登録できます。
          </p>
        ) : (
          <ul className="mt-3 space-y-3" role="list">
            {records.map((record) => (
              <li
                key={record.id}
                data-testid="residual-check-card"
                className="flex items-center justify-between gap-3 rounded-lg border border-border/70 bg-background px-4 py-5"
              >
                <span className="text-[15px] font-bold text-foreground">{record.drug_name}</span>
                <span className="shrink-0 text-[15px] font-semibold text-state-confirm">
                  {formatRemainingLabel(record)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 中央: 調整案 + 医師の指示記録 */}
      <section
        aria-labelledby="adjustment-proposal-heading"
        className="rounded-lg border border-border/70 bg-card p-4"
      >
        <h2 id="adjustment-proposal-heading" className="text-base font-bold text-foreground">
          調整案
        </h2>
        <div className="mt-3 overflow-hidden rounded-lg border border-border/70">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr className="text-left text-muted-foreground">
                <th scope="col" className="px-4 py-2.5 font-medium">
                  薬剤
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  残薬
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  今回処方
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  提案
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60 bg-background">
              {plan.rows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-sm text-muted-foreground">
                    今回処方と突き合わせできる調整対象はありません。
                  </td>
                </tr>
              ) : (
                plan.rows.map((row) => (
                  <tr key={row.id} data-testid="adjustment-proposal-row">
                    <td className="px-4 py-3 font-medium text-foreground">{row.drugName}</td>
                    <td className="px-4 py-3 text-foreground">{row.remainingDays}日</td>
                    <td className="px-4 py-3 text-foreground">{row.prescribedDays}日</td>
                    <td className="px-4 py-3 text-foreground">{row.proposal.label}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <h3 className="mt-6 text-[15px] font-bold text-foreground">医師の指示記録</h3>
        {instructionQuery.isError ? (
          <p className="mt-3 rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
            医師の指示記録を取得できませんでした。
          </p>
        ) : instructions.length === 0 ? (
          <p
            data-testid="physician-instruction-empty"
            className="mt-3 rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground"
          >
            未記録です。疑義照会(残薬調整)の回答が登録されるとここに表示されます。
          </p>
        ) : (
          <div className="mt-3 space-y-3">
            {instructions.map((instruction) => (
              <div
                key={instruction.id}
                data-testid="physician-instruction-card"
                className="rounded-lg border border-border/70 bg-background px-4 py-4 text-sm leading-6 text-foreground"
              >
                {instruction.text}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 右: 次にやること */}
      <aside aria-label="次にやること" className="flex flex-col gap-4">
        <section
          aria-labelledby="residual-next-actions-heading"
          className="flex-1 rounded-lg border border-border/70 bg-card p-4"
        >
          <h2 id="residual-next-actions-heading" className="text-base font-bold text-foreground">
            次にやること
          </h2>
          <div className="mt-3 space-y-2.5">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              aria-hidden="true"
              tabIndex={-1}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void uploadResidualPhoto(file);
              }}
            />
            <Button
              type="button"
              className="min-h-11 w-full"
              disabled={!latestVisitRecordId || uploading}
              onClick={() => fileInputRef.current?.click()}
            >
              {uploading ? 'アップロード中...' : '残薬写真を追加'}
            </Button>
            <Button
              type="button"
              className="min-h-11 w-full"
              disabled={plan.rows.length === 0 || confirmMutation.isPending}
              onClick={() => setConfirmOpen(true)}
            >
              {confirmMutation.isPending ? '確定中...' : '調整案を確定'}
            </Button>
          </div>
        </section>
        {plan.prohibitedDrugNames.length > 0 ? (
          <BlockedReasonsPanel
            reasons={plan.prohibitedDrugNames.map((drugName) => ({
              id: drugName,
              label: `${drugName} は減数禁止(麻薬・抗がん剤)。医師の指示を確認してください。`,
              severity: 'critical' as const,
            }))}
          />
        ) : null}
      </aside>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="調整案を確定しますか?"
        description={`${buildAdjustmentConfirmDescription(plan.rows)} — 確定すると介入記録(用量調整)として保存されます。`}
        confirmLabel="確定する"
        onConfirm={() => confirmMutation.mutate()}
      />
    </div>
  );
}
