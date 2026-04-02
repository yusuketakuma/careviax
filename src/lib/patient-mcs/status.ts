type PatientMcsStatusInput = {
  sourceUrl: string | null;
  projectUrl: string | null;
  lastSyncStatus: string | null;
  lastSyncedAt: string | null;
  lastSyncError: string | null;
};

type PatientMcsSyncSummaryInput = {
  isFallback: boolean;
  otherProfessionalMessageCount: number;
};

export function describePatientMcsStatus(link: PatientMcsStatusInput | null) {
  if (!link?.sourceUrl && !link?.projectUrl) {
    return {
      label: '未接続',
      variant: 'outline' as const,
      description: 'MCS の患者 URL または医療・介護側タイムライン URL を入力して同期します。',
    };
  }

  if (link.lastSyncStatus === 'failed') {
    return {
      label: '同期エラー',
      variant: 'destructive' as const,
      description: link.lastSyncError ?? '前回同期でエラーが発生しました。',
    };
  }

  if (link.lastSyncedAt) {
    return {
      label: '同期済み',
      variant: 'secondary' as const,
      description: '連携先 URL は登録済みで、取り込み済みメッセージを参照できます。',
    };
  }

  return {
    label: '接続準備完了',
    variant: 'outline' as const,
    description: '連携先 URL は登録済みです。手動同期でメッセージを取り込みます。',
  };
}

export function describePatientMcsSyncResult(params: {
  importedCount: number;
  projectTitle: string | null;
  summary: PatientMcsSyncSummaryInput | null;
}) {
  const label = params.projectTitle ? `「${params.projectTitle}」` : 'MCS 連携';

  if (!params.summary) {
    return params.importedCount > 0
      ? `${label}から ${params.importedCount} 件同期しました`
      : `${label}を同期しました`;
  }

  if (params.summary.otherProfessionalMessageCount === 0) {
    return `${label}を同期しました。他職種投稿は未検出のため要約はルール生成です。`;
  }

  if (params.summary.isFallback) {
    return `${label}から ${params.importedCount} 件同期しました。要約はルール生成です。`;
  }

  return `${label}から ${params.importedCount} 件同期しました。AI要約を更新しました。`;
}
