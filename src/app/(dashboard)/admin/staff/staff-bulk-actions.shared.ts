export type ImportOutcome = 'created' | 'partial_failed' | 'failed';

export type ImportApiResponse = {
  data: ImportResult;
};

export type ImportResult = {
  created_count: number;
  failed_count: number;
  outcome?: ImportOutcome;
  results: Array<{
    row_number?: number;
    email: string;
    name: string;
    status: 'created' | 'failed';
    message: string;
  }>;
};

export type ImportFeedback = {
  tone: 'success' | 'warning' | 'error';
  message: string;
};

export function resolveImportOutcome(
  result: Pick<ImportResult, 'created_count' | 'failed_count' | 'outcome'>,
) {
  if (
    result.outcome === 'created' ||
    result.outcome === 'partial_failed' ||
    result.outcome === 'failed'
  ) {
    return result.outcome;
  }
  if (result.created_count > 0 && result.failed_count > 0) return 'partial_failed';
  if (result.failed_count > 0) return 'failed';
  return 'created';
}

export function getImportFeedback(
  result: Pick<ImportResult, 'created_count' | 'failed_count' | 'outcome'>,
): ImportFeedback {
  const outcome = resolveImportOutcome(result);
  if (outcome === 'failed') {
    return {
      tone: 'error',
      message: `スタッフを取込できませんでした（失敗 ${result.failed_count}件）`,
    };
  }
  if (outcome === 'partial_failed') {
    return {
      tone: 'warning',
      message: `${result.created_count}件を取込しました。${result.failed_count}件は確認が必要です`,
    };
  }
  return {
    tone: 'success',
    message: `${result.created_count}件のスタッフを取込しました`,
  };
}
