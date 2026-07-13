import { StateBadge } from '@/components/ui/state-badge';
import { Button } from '@/components/ui/button';
import {
  isPatientArchiveWritable,
  type PatientArchiveSummary,
} from '@/lib/patient/archive-summary';

export const PATIENT_WRITE_AVAILABILITY_DESCRIPTION_ID = 'patient-write-availability-description';

export function PatientWriteAvailabilityNotice({
  archive,
  patientName,
  unavailableReason = 'unknown',
  onRetry,
  isRetrying = false,
  isShowingCachedData = false,
  cachedDataUpdatedAt,
}: {
  archive: PatientArchiveSummary | null | undefined;
  patientName?: string | null;
  unavailableReason?: 'unknown' | 'permission_denied';
  onRetry?: () => void;
  isRetrying?: boolean;
  isShowingCachedData?: boolean;
  cachedDataUpdatedAt?: number;
}) {
  if (isPatientArchiveWritable(archive)) return null;

  const isArchived = archive?.archived === true;
  const isPermissionDenied = !isArchived && unavailableReason === 'permission_denied';
  const cachedDataUpdatedLabel =
    cachedDataUpdatedAt && Number.isFinite(cachedDataUpdatedAt)
      ? new Intl.DateTimeFormat('ja-JP', {
          month: 'numeric',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        }).format(new Date(cachedDataUpdatedAt))
      : null;
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="patient-write-availability-notice"
      className="rounded-lg border-l-4 border-border/70 border-l-state-blocked bg-card p-4 text-sm text-state-blocked"
    >
      <div className="flex flex-wrap items-center gap-2">
        <StateBadge role={isArchived ? 'readonly' : 'blocked'} className="font-bold">
          {isArchived ? 'アーカイブ中' : isPermissionDenied ? '状態確認権限なし' : '状態未確認'}
        </StateBadge>
        <p className="font-semibold">
          {isArchived
            ? `${patientName ? `${patientName} 様は` : 'この患者は'}閲覧専用の患者正本です。`
            : isPermissionDenied
              ? '患者の利用状態を確認する権限がありません。'
              : '患者の利用状態を確認できません。'}
        </p>
      </div>
      <p
        id={PATIENT_WRITE_AVAILABILITY_DESCRIPTION_ID}
        className="mt-1 text-xs leading-5 text-state-blocked/90"
      >
        {isArchived
          ? '復元するまで新しい外部共有リンク、返信依頼、次回タスクは作成できません。既存の共有・返信・履歴は閲覧できます。'
          : isPermissionDenied
            ? '患者の利用状態を確認できる権限が付与されるまで、新しい外部共有リンク、返信依頼、次回タスクの作成を停止しています。権限を持つ担当者へ確認してください。'
            : '患者が利用中であることを再取得できるまで、新しい外部共有リンク、返信依頼、次回タスクの作成を停止しています。'}
      </p>
      {!isArchived && !isPermissionDenied && isShowingCachedData ? (
        <p className="mt-1 text-xs leading-5 text-state-blocked/90">
          前回取得データを表示中です。
          {cachedDataUpdatedLabel
            ? ` 最終更新: ${cachedDataUpdatedLabel}`
            : ' 最終更新時刻は確認できません。'}
        </p>
      ) : null}
      {!isArchived && !isPermissionDenied && onRetry ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-3 min-h-11 bg-background"
          disabled={isRetrying}
          onClick={onRetry}
        >
          {isRetrying ? '再取得中...' : '患者状態を再取得'}
        </Button>
      ) : null}
    </div>
  );
}
