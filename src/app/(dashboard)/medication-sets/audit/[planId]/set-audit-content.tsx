'use client';

import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import {
  CheckCircle2,
  XCircle,
  ImagePlus,
  Loader2,
  X,
} from 'lucide-react';
import { useOrgId } from '@/lib/hooks/use-org-id';
import { useRealtimeQuery } from '@/lib/hooks/use-realtime-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import {
  ReasonDialog,
  type ReasonSubmission,
} from '@/components/features/workflow/reason-dialog';
import {
  buildSetAuditPaneSubmission,
  buildSetInstructionLines,
  SET_AUDIT_CHECKLIST_ITEMS,
  SET_AUDIT_PHOTO_SLOTS,
  type SetAuditChecklistKey,
  type SetAuditPhotoSlotKey,
} from './set-audit-content.helpers';

// ── Types ──

type SetPlanAuditDetail = {
  id: string;
  set_method: string | null;
  target_period_start: string | null;
  target_period_end: string | null;
  notes: string | null;
  packaging_method_ref: { name: string | null } | null;
  audits: Array<{
    id: string;
    result: string;
    reject_reason: string | null;
    checklist: Record<string, boolean> | null;
    photo_asset_ids: string[] | null;
    audited_at: string;
  }>;
};

type UploadedPhoto = {
  id: string;
  slot: SetAuditPhotoSlotKey;
  fileName: string;
};

// ── Constants ──

const PHOTO_ACCEPT = 'image/jpeg,image/png,image/webp';

const REJECT_REASON_OPTIONS = [
  { code: 'drug_mismatch', label: '薬剤不一致' },
  { code: 'quantity_error', label: '数量誤り' },
  { code: 'timing_error', label: '服用時点誤り' },
  { code: 'discontinued_included', label: '中止薬混入' },
  { code: 'other', label: 'その他' },
] as const;

function formatPeriodDate(value: string | null): string | null {
  if (!value) return null;
  try {
    return format(parseISO(value), 'M/d');
  } catch {
    return value;
  }
}

// ── Photo slot tile (center pane) ──

function PhotoSlotTile({
  label,
  photos,
  uploading,
  disabled,
  onPick,
  onRemove,
}: {
  label: string;
  photos: UploadedPhoto[];
  uploading: boolean;
  disabled: boolean;
  onPick: (file: File) => void;
  onRemove: (id: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  return (
    <div className="flex min-h-[150px] flex-col rounded-lg border border-border bg-muted/20 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-semibold text-foreground">{label}</span>
        {photos.length > 0 && (
          <span className="text-xs text-muted-foreground">{photos.length}枚</span>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={PHOTO_ACCEPT}
        capture="environment"
        disabled={disabled || uploading}
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onPick(file);
          event.target.value = '';
        }}
      />

      {photos.length > 0 ? (
        <ul className="mb-2 space-y-1">
          {photos.map((photo) => (
            <li
              key={photo.id}
              className="flex items-center justify-between gap-2 rounded-md border border-border bg-card px-2 py-1.5"
            >
              <span className="truncate text-xs text-foreground">{photo.fileName}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-6 shrink-0"
                disabled={disabled}
                onClick={() => onRemove(photo.id)}
                aria-label={`${photo.fileName} を削除`}
              >
                <X className="size-3.5" aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="mt-auto w-full"
        disabled={disabled || uploading}
        onClick={() => inputRef.current?.click()}
      >
        {uploading ? (
          <Loader2 className="mr-1.5 size-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <ImagePlus className="mr-1.5 size-3.5" aria-hidden="true" />
        )}
        写真を追加
      </Button>
    </div>
  );
}

// ── Main ──

export function SetAuditContent({ planId }: { planId: string }) {
  const queryClient = useQueryClient();
  const orgId = useOrgId();

  const [checklist, setChecklist] = useState<Record<SetAuditChecklistKey, boolean>>(
    () =>
      Object.fromEntries(SET_AUDIT_CHECKLIST_ITEMS.map((item) => [item.key, false])) as Record<
        SetAuditChecklistKey,
        boolean
      >,
  );
  const [photos, setPhotos] = useState<UploadedPhoto[]>([]);
  const [uploadingSlot, setUploadingSlot] = useState<SetAuditPhotoSlotKey | null>(null);
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [isSaved, setIsSaved] = useState(false);

  const planQuery = useRealtimeQuery({
    queryKey: ['set-plan-audit', planId],
    queryFn: async () => {
      const res = await fetch(`/api/set-plans/${planId}`, {
        headers: { 'x-org-id': orgId },
      });
      if (!res.ok) throw new Error('セットプランの取得に失敗しました');
      const json = (await res.json()) as { data: SetPlanAuditDetail };
      return json.data;
    },
    enabled: Boolean(planId && orgId),
    invalidateOn: ['cycle_transition', 'workflow_refresh'],
  });

  const auditMutation = useMutation({
    mutationFn: async (payload: {
      result: 'approved' | 'rejected';
      reject_reason?: string;
      checklist: Record<string, boolean>;
      photo_asset_ids: string[];
    }) => {
      const res = await fetch('/api/set-audits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-org-id': orgId },
        body: JSON.stringify({ plan_id: planId, ...payload }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(err.message ?? '鑑査の保存に失敗しました');
      }
      return res.json();
    },
    onSuccess: () => {
      setIsSaved(true);
      queryClient.invalidateQueries({ queryKey: ['set-plan-audit', planId] });
    },
  });

  const plan = planQuery.data ?? null;
  const instructionLines = buildSetInstructionLines(
    plan
      ? {
          set_method: plan.set_method,
          target_period_start: formatPeriodDate(plan.target_period_start),
          target_period_end: formatPeriodDate(plan.target_period_end),
          notes: plan.notes,
          packaging_method_ref: plan.packaging_method_ref,
        }
      : null,
  );

  const isPending = auditMutation.isPending || isSaved;

  // ── Photo upload: presigned-upload(purpose=set-photo) → PUT → complete ──
  async function uploadPhoto(slot: SetAuditPhotoSlotKey, file: File) {
    setUploadingSlot(slot);
    try {
      const presignRes = await fetch('/api/files/presigned-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-org-id': orgId },
        body: JSON.stringify({
          purpose: 'set-photo',
          file_name: file.name,
          mime_type: file.type,
          size_bytes: file.size,
        }),
      });
      const presignJson = await presignRes.json().catch(() => null);
      if (!presignRes.ok) {
        throw new Error(presignJson?.message ?? 'アップロードURLの取得に失敗しました');
      }

      const uploadRes = await fetch(presignJson.data.uploadUrl, {
        method: 'PUT',
        headers: presignJson.data.headers,
        body: file,
      });
      if (!uploadRes.ok) throw new Error('写真のアップロードに失敗しました');

      const completeRes = await fetch('/api/files/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-org-id': orgId },
        body: JSON.stringify({
          file_id: presignJson.data.id,
          etag: uploadRes.headers.get('etag') ?? undefined,
        }),
      });
      if (!completeRes.ok) throw new Error('写真の登録に失敗しました');

      setPhotos((prev) => [
        ...prev,
        { id: presignJson.data.id as string, slot, fileName: file.name },
      ]);
      toast.success('写真を追加しました');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '写真の追加に失敗しました');
    } finally {
      setUploadingSlot(null);
    }
  }

  function handleRemovePhoto(id: string) {
    setPhotos((prev) => prev.filter((photo) => photo.id !== id));
  }

  function toggleChecklist(key: SetAuditChecklistKey) {
    setChecklist((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function handleApprove() {
    const submission = buildSetAuditPaneSubmission({
      decision: 'approved',
      checklist,
      photoAssetIds: photos.map((photo) => photo.id),
    });
    if (submission.kind === 'incomplete') {
      toast.error(submission.message);
      return;
    }
    auditMutation.mutate(submission.payload, {
      onSuccess: () => toast.success('セット鑑査を監査OKで保存しました'),
      onError: (error) => toast.error(error.message),
    });
  }

  function handleRejectConfirm({ label, note }: ReasonSubmission) {
    const rejectReason = note ? `${label}: ${note}` : label;
    const submission = buildSetAuditPaneSubmission({
      decision: 'rejected',
      checklist,
      photoAssetIds: photos.map((photo) => photo.id),
      rejectReason,
    });
    if (submission.kind === 'incomplete') {
      toast.error(submission.message);
      return;
    }
    auditMutation.mutate(submission.payload, {
      onSuccess: () => toast.success('セット鑑査を差し戻しで保存しました'),
      onError: (error) => toast.error(error.message),
    });
    setRejectDialogOpen(false);
  }

  if (!orgId || planQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden="true" />
        <span className="ml-2 text-sm text-muted-foreground">読み込み中...</span>
      </div>
    );
  }

  if (planQuery.isError) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
        セットプランの取得に失敗しました。ページを再読み込みしてください。
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {isSaved && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          セット鑑査結果は保存済みです。この画面からの再送信は無効化しました。
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1.1fr)]">
        {/* LEFT: セット指示 */}
        <Card>
          <CardHeader className="border-b py-3">
            <CardTitle className="text-base font-semibold">セット指示</CardTitle>
          </CardHeader>
          <CardContent className="py-4">
            {instructionLines.length > 0 ? (
              <ul className="space-y-3">
                {instructionLines.map((line, index) => (
                  <li key={index} className="text-sm leading-relaxed text-foreground">
                    ・{line}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">セット指示は登録されていません。</p>
            )}
          </CardContent>
        </Card>

        {/* CENTER: 写真・実物確認 */}
        <Card>
          <CardHeader className="border-b py-3">
            <CardTitle className="text-base font-semibold">写真・実物確認</CardTitle>
          </CardHeader>
          <CardContent className="py-4">
            <div className="grid gap-3 sm:grid-cols-2">
              {SET_AUDIT_PHOTO_SLOTS.map((slot) => (
                <PhotoSlotTile
                  key={slot.key}
                  label={slot.label}
                  photos={photos.filter((photo) => photo.slot === slot.key)}
                  uploading={uploadingSlot === slot.key}
                  disabled={isPending}
                  onPick={(file) => void uploadPhoto(slot.key, file)}
                  onRemove={handleRemovePhoto}
                />
              ))}
            </div>
          </CardContent>
        </Card>

        {/* RIGHT: 監査チェック */}
        <Card>
          <CardHeader className="border-b py-3">
            <CardTitle className="text-base font-semibold">監査チェック</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5 py-4">
            <ul className="space-y-3">
              {SET_AUDIT_CHECKLIST_ITEMS.map((item) => (
                <li key={item.key} className="flex items-center gap-2.5">
                  <Checkbox
                    id={`set-audit-check-${item.key}`}
                    checked={checklist[item.key]}
                    disabled={isPending}
                    onCheckedChange={() => toggleChecklist(item.key)}
                  />
                  <Label
                    htmlFor={`set-audit-check-${item.key}`}
                    className={cn(
                      'text-sm font-normal leading-snug',
                      isPending ? 'text-muted-foreground' : 'cursor-pointer text-foreground',
                    )}
                  >
                    {item.label}
                  </Label>
                </li>
              ))}
            </ul>

            <div className="flex flex-wrap gap-3">
              <Button
                type="button"
                className="flex-1 bg-green-700 text-white hover:bg-green-800"
                disabled={isPending}
                onClick={handleApprove}
              >
                <CheckCircle2 className="mr-1.5 size-4" aria-hidden="true" />
                監査OK
              </Button>
              <Button
                type="button"
                variant="outline"
                className="flex-1 border-red-500 text-red-600 hover:bg-red-50"
                disabled={isPending}
                onClick={() => setRejectDialogOpen(true)}
              >
                <XCircle className="mr-1.5 size-4" aria-hidden="true" />
                差し戻す
              </Button>
            </div>

            <p className="text-xs text-muted-foreground">
              差し戻しの理由は「差し戻す」を押すと記録できます（必要な時だけ）。
            </p>
          </CardContent>
        </Card>
      </div>

      {/* 差し戻し理由 — p0_36 共通理由モーダル */}
      <ReasonDialog
        open={rejectDialogOpen}
        onOpenChange={setRejectDialogOpen}
        title="差し戻し理由を入力"
        options={REJECT_REASON_OPTIONS}
        warning="差戻し後は再計画が必要です。"
        pending={auditMutation.isPending}
        onSubmit={handleRejectConfirm}
      />
    </div>
  );
}
