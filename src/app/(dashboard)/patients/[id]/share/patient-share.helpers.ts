import {
  SHARE_SECTION_EMPTY_BODY,
  type ShareAudienceKey,
  type ShareSection,
  type ShareSectionKey,
} from '@/app/(dashboard)/reports/[id]/share/interprofessional-share.helpers';

/**
 * p1_05「他職種向け共有ページ」(患者文脈 /patients/[id]/share)の表示射影(純関数)。
 *
 * 報告書文脈(/reports/[id]/share)は単一の報告書 content を相手別にプレビューするが、
 * 患者文脈では「現在その患者で外部共有できる事実」(服薬・残薬・直近報告・自己申告)を
 * 決定的(deterministic)に組み立て、相手区分ごとに「相手に見える内容」をプレビューする。
 *
 * - 共有する相手 / 返信・確認 / 次回タスクにする は報告書文脈と同じ taxonomy
 *   (SHARE_AUDIENCES / pickLatestAudienceReplyRequest / buildNextCheckTaskInput)を再利用する。
 * - スキーマは追加しない: 既存の患者詳細レスポンス(医薬品・訪問・報告書・自己申告)から射影する。
 */

// ---------------------------------------------------------------------------
// 患者共有スナップショット(患者詳細 API から射影した、宛先非依存の共有事実)
// ---------------------------------------------------------------------------

export type PatientShareMedication = {
  drug_name: string;
  dose: string | null;
  frequency: string | null;
};

export type PatientShareVisit = {
  scheduled_date: string;
  schedule_status: string | null;
};

export type PatientShareCareReport = {
  report_type: string;
  created_at: string;
  status: string;
};

export type PatientShareSelfReport = {
  subject: string;
  category: string | null;
  content: string;
  created_at: string;
};

export type PatientShareSnapshot = {
  medications: PatientShareMedication[];
  visits: PatientShareVisit[];
  careReports: PatientShareCareReport[];
  selfReports: PatientShareSelfReport[];
  /** 添付できる確定済み報告書(PDF 送付対象)があるか */
  hasShareableReport: boolean;
};

function trimOrNull(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function formatShareDate(value: string): string | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).format(date);
}

function joinLines(parts: Array<string | null | undefined>): string | null {
  const filled = parts
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part));
  return filled.length > 0 ? filled.join('\n') : null;
}

// ---------------------------------------------------------------------------
// 残薬の推定(自己申告カテゴリ「残薬」由来)
// ---------------------------------------------------------------------------

const RESIDUAL_SELF_REPORT_KEYWORDS = ['残薬', '飲み残し', '余って'];

function looksLikeResidualSelfReport(report: PatientShareSelfReport): boolean {
  const haystack = `${report.category ?? ''} ${report.subject}`;
  return RESIDUAL_SELF_REPORT_KEYWORDS.some((keyword) => haystack.includes(keyword));
}

// ---------------------------------------------------------------------------
// 相手別「相手に見える内容」5 セクション
// ---------------------------------------------------------------------------

/**
 * 患者スナップショットから、選択中の相手向けの「相手に見える内容」を組み立てる。
 * 宛先で変わるのは「薬剤師からのお願い」の文面(家族向けはやさしい表現)。
 */
export function buildPatientShareSections(
  snapshot: PatientShareSnapshot,
  audience: ShareAudienceKey,
): ShareSection[] {
  const medicationCount = snapshot.medications.length;
  const medicationNames = snapshot.medications
    .slice(0, 4)
    .map((item) => trimOrNull(item.drug_name))
    .filter((name): name is string => Boolean(name));

  const medicationBody = joinLines([
    medicationCount > 0 ? `服薬中 ${medicationCount}剤` : null,
    medicationNames.length > 0 ? `主な処方薬: ${medicationNames.join(' / ')}` : null,
  ]);

  const residualReports = snapshot.selfReports.filter(looksLikeResidualSelfReport);
  const residualBody = joinLines(
    residualReports
      .slice(0, 3)
      .map((report) => `${report.subject}（${formatShareDate(report.created_at) ?? ''}）`),
  );

  const nextVisit = snapshot.visits[0] ?? null;
  const latestReport = snapshot.careReports[0] ?? null;

  const pharmacistRequestBody =
    audience === 'family'
      ? joinLines([
          '服薬状況で気になることがあれば、お気軽に薬局までご連絡ください。',
          nextVisit
            ? `次回訪問予定: ${formatShareDate(nextVisit.scheduled_date) ?? '調整中'}`
            : null,
        ])
      : joinLines([
          '服薬状況・残薬について、気づいた点があれば共有をお願いします。',
          residualReports.length > 0 ? '残薬の調整についてご相談させてください。' : null,
        ]);

  const nextCheckBody = joinLines([
    nextVisit
      ? `次回訪問予定: ${formatShareDate(nextVisit.scheduled_date) ?? '調整中'}`
      : '次回訪問は未確定です。',
    latestReport
      ? `最新の共有報告: ${latestReport.report_type}（${formatShareDate(latestReport.created_at) ?? ''}）`
      : null,
  ]);

  const attachmentsBody = snapshot.hasShareableReport
    ? '訪問報告書PDF（最新の確定版）を共有できます。'
    : null;

  const sections: Array<{ key: ShareSectionKey; title: string; body: string | null }> = [
    { key: 'medication_status', title: '服薬状況', body: medicationBody },
    { key: 'residual', title: '残薬', body: residualBody },
    { key: 'pharmacist_request', title: '薬剤師からのお願い', body: pharmacistRequestBody },
    { key: 'next_check', title: '次回確認すること', body: nextCheckBody },
    { key: 'attachments', title: '添付資料', body: attachmentsBody },
  ];

  return sections.map((section) => ({
    key: section.key,
    title: section.title,
    body:
      section.body ??
      (section.key === 'attachments' ? '添付資料はまだありません。' : SHARE_SECTION_EMPTY_BODY),
    isEmpty: section.body == null,
  }));
}
