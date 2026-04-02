import {
  parsePatientMcsViewData,
  type PatientMcsApiLink,
  type PatientMcsApiSummary,
  type PatientMcsApiMessage,
  type PatientMcsViewLink,
  type PatientMcsViewSummary,
} from './dto';
import { describePatientMcsStatus } from './status';

export type PatientMcsCardViewData = {
  link: PatientMcsViewLink | null;
  summary: PatientMcsViewSummary | null;
  isRestricted: boolean;
  isError?: boolean;
};

export function parsePatientMcsCardViewData(payload: {
  data: {
    patient: { id: string; name: string };
    link: PatientMcsApiLink | null;
    summary: PatientMcsApiSummary | null;
    messages: PatientMcsApiMessage[];
  };
}): PatientMcsCardViewData {
  const parsed = parsePatientMcsViewData(payload);
  return {
    link: parsed.link,
    summary: parsed.summary,
    isRestricted: false,
  };
}

export function restrictedPatientMcsCardViewData(): PatientMcsCardViewData {
  return {
    link: null,
    summary: null,
    isRestricted: true,
    isError: false,
  };
}

export function canOpenPatientMcsPage(viewData: PatientMcsCardViewData | undefined) {
  if (!viewData) return false;
  return !viewData.isRestricted && !viewData.isError;
}

export function describePatientMcsCardStatus(params: {
  link: PatientMcsViewLink | null;
  isRestricted: boolean;
  isError: boolean;
}) {
  if (params.isRestricted) {
    return {
      label: '閲覧制限',
      variant: 'outline' as const,
      description: 'このロールでは MCS 本文を表示しません。',
    };
  }

  if (params.isError) {
    return {
      label: '取得エラー',
      variant: 'destructive' as const,
      description:
        'MCS 状態の取得に失敗しました。患者詳細の再読み込みか MCS 連携画面で再同期してください。',
    };
  }

  return describePatientMcsStatus(
    params.link
      ? {
          sourceUrl: params.link.sourceUrl,
          projectUrl: params.link.projectUrl,
          lastSyncStatus: params.link.lastSyncStatus,
          lastSyncedAt: params.link.lastSyncedAt,
          lastSyncError: params.link.lastSyncError,
        }
      : null
  );
}
