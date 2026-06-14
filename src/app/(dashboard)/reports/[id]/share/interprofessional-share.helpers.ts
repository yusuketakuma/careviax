import type {
  CareManagerReportContent,
  PhysicianReportContent,
} from '@/types/care-report-content';

/**
 * p1_05「他職種向け共有ページ」の表示射影(純関数)。
 * - 共有する相手: 主治医/ケアマネ/訪問看護/施設/家族 の 5 区分
 *   (src/phos/contracts の DOCTOR/CARE_MANAGER/VISITING_NURSE/FACILITY/FAMILY と同一概念)
 * - 相手に見える内容: 報告書 content を 5 セクション
 *   (服薬状況/残薬/薬剤師からのお願い/次回確認すること/添付資料)へ射影
 * - 返信・確認: communication-requests の返信を相手区分で突合し、
 *   「次回タスクにする」(POST /api/tasks)の入力を組み立てる
 */

// ---------------------------------------------------------------------------
// 共有する相手(5 区分)
// ---------------------------------------------------------------------------

export type ShareAudienceKey =
  | 'physician'
  | 'care_manager'
  | 'visiting_nurse'
  | 'facility'
  | 'family';

export type ShareAudience = {
  key: ShareAudienceKey;
  label: string;
  /** CareTeamLink.role(physician/nurse/care_manager/...)との対応 */
  careTeamRoles: readonly string[];
  /** ContactParty.relation(child/facility_staff/...)との対応 */
  contactRelations: readonly string[];
};

export const SHARE_AUDIENCES: readonly ShareAudience[] = [
  {
    key: 'physician',
    label: '主治医',
    careTeamRoles: ['physician'],
    contactRelations: ['physician'],
  },
  {
    key: 'care_manager',
    label: 'ケアマネ',
    careTeamRoles: ['care_manager'],
    contactRelations: ['care_manager'],
  },
  {
    key: 'visiting_nurse',
    label: '訪問看護',
    careTeamRoles: ['nurse', 'visiting_nurse'],
    contactRelations: ['nurse'],
  },
  {
    key: 'facility',
    label: '施設',
    careTeamRoles: ['facility', 'facility_staff'],
    contactRelations: ['facility_staff'],
  },
  {
    key: 'family',
    label: '家族',
    careTeamRoles: ['family'],
    contactRelations: ['spouse', 'child', 'parent', 'sibling'],
  },
] as const;

export function shareAudienceLabel(key: ShareAudienceKey): string {
  return SHARE_AUDIENCES.find((audience) => audience.key === key)?.label ?? key;
}

/** 報告書タイプ → 初期選択する相手(デザインはケアマネ選択中) */
export function defaultAudienceForReportType(reportType: string | null): ShareAudienceKey {
  const table: Record<string, ShareAudienceKey> = {
    physician_report: 'physician',
    care_manager_report: 'care_manager',
    nurse_share: 'visiting_nurse',
    facility_handoff: 'facility',
    family_share: 'family',
  };
  return (reportType && table[reportType]) || 'care_manager';
}

export type CareTeamMemberSummary = {
  role: string;
  name: string;
  organization_name: string | null;
  is_primary: boolean;
};

export type ContactPartySummary = {
  relation: string;
  name: string;
  organization_name: string | null;
  is_primary: boolean;
};

export type ShareAudienceCard = {
  key: ShareAudienceKey;
  label: string;
  /** 例: 「中島 桜(きたきゅうケアプラン)」。該当者なしは null */
  memberLabel: string | null;
};

function pickPrimaryFirst<T extends { is_primary: boolean }>(items: readonly T[]): T | null {
  return items.find((item) => item.is_primary) ?? items[0] ?? null;
}

function formatMemberLabel(member: { name: string; organization_name: string | null }): string {
  return member.organization_name ? `${member.name}(${member.organization_name})` : member.name;
}

/** ケアチーム + 患者連絡先から、相手 5 区分のカード(該当者名つき)を組み立てる */
export function buildShareAudienceCards(
  careTeam: readonly CareTeamMemberSummary[],
  contacts: readonly ContactPartySummary[],
): ShareAudienceCard[] {
  return SHARE_AUDIENCES.map((audience) => {
    const teamMember = pickPrimaryFirst(
      careTeam.filter((member) => audience.careTeamRoles.includes(member.role)),
    );
    const contactMember = pickPrimaryFirst(
      contacts.filter((contact) => audience.contactRelations.includes(contact.relation)),
    );
    const member = teamMember ?? contactMember;
    return {
      key: audience.key,
      label: audience.label,
      memberLabel: member ? formatMemberLabel(member) : null,
    };
  });
}

// ---------------------------------------------------------------------------
// 相手に見える内容(5 セクション)
// ---------------------------------------------------------------------------

export type ShareSectionKey =
  | 'medication_status'
  | 'residual'
  | 'pharmacist_request'
  | 'next_check'
  | 'attachments';

export type ShareSection = {
  key: ShareSectionKey;
  title: string;
  body: string;
  /** 未記載フォールバック文のとき true(UI で淡色表示) */
  isEmpty: boolean;
};

export const SHARE_SECTION_EMPTY_BODY = '未記載のため、この相手には共有されません。';

function isStringRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function joinNonEmpty(parts: Array<string | null | undefined>, separator = ' / '): string | null {
  const filled = parts
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part));
  return filled.length > 0 ? filled.join(separator) : null;
}

function isPhysicianContent(value: unknown): value is PhysicianReportContent {
  return isStringRecord(value) && isStringRecord(value.medication_management);
}

function isCareManagerContent(value: unknown): value is CareManagerReportContent {
  return isStringRecord(value) && isStringRecord(value.medication_management_summary);
}

/** 報告書 content から共有に使う事実(宛先非依存)を抽出する */
export type ShareReportFacts = {
  medicationStatus: string | null;
  selfManagement: string | null;
  calendarUsed: boolean | null;
  residual: string | null;
  /** 医師向けの依頼文(physician_communication) */
  physicianRequest: string | null;
  /** 介護・看護・家族向けの依頼文(服薬支援のお願い) */
  careRequest: string | null;
  nextCheck: string | null;
  /** 旧形式 content({title, body})の本文 */
  genericBody: string | null;
};

export function extractShareReportFacts(content: unknown): ShareReportFacts {
  const empty: ShareReportFacts = {
    medicationStatus: null,
    selfManagement: null,
    calendarUsed: null,
    residual: null,
    physicianRequest: null,
    careRequest: null,
    nextCheck: null,
    genericBody: null,
  };

  if (isPhysicianContent(content)) {
    const residualList = Array.isArray(content.residual_medications)
      ? content.residual_medications
      : [];
    return {
      ...empty,
      medicationStatus: readString(content.medication_management.compliance_summary),
      selfManagement: readString(content.medication_management.self_management),
      calendarUsed:
        typeof content.medication_management.calendar_used === 'boolean'
          ? content.medication_management.calendar_used
          : null,
      residual: joinNonEmpty(
        residualList.map(
          (item) => `${item.drug_name} 残${item.remaining_qty}(超過${item.excess_days}日)`,
        ),
      ),
      physicianRequest: joinNonEmpty(
        [readString(content.physician_communication), readString(content.prescription_proposals)],
        '\n',
      ),
      nextCheck: readString(content.plan),
    };
  }

  if (isCareManagerContent(content)) {
    const summary = content.medication_management_summary;
    const coordination = isStringRecord(content.care_service_coordination)
      ? content.care_service_coordination
      : null;
    const residualStatus = isStringRecord(content.residual_status) ? content.residual_status : null;
    const nextVisitPlan = isStringRecord(content.next_visit_plan) ? content.next_visit_plan : null;
    const followupItems = Array.isArray(nextVisitPlan?.followup_items)
      ? nextVisitPlan.followup_items.filter((item): item is string => typeof item === 'string')
      : [];
    const reductionProposals = Array.isArray(residualStatus?.reduction_proposals)
      ? residualStatus.reduction_proposals.filter(
          (item): item is string => typeof item === 'string',
        )
      : [];
    return {
      ...empty,
      medicationStatus: readString(summary.compliance_summary),
      selfManagement: readString(summary.self_management),
      calendarUsed: typeof summary.calendar_used === 'boolean' ? summary.calendar_used : null,
      residual: joinNonEmpty([readString(residualStatus?.summary), ...reductionProposals], '\n'),
      careRequest: joinNonEmpty(
        [readString(coordination?.medication_assistance), readString(coordination?.other_items)],
        '\n',
      ),
      nextCheck: joinNonEmpty(followupItems),
    };
  }

  if (isStringRecord(content)) {
    return { ...empty, genericBody: readString(content.body) };
  }

  return empty;
}

/**
 * 選択中の相手に応じた「相手に見える内容」5 セクションを組み立てる。
 * 宛先で変わるのは「薬剤師からのお願い」の出典優先順位
 * (主治医 → physician_communication 優先、それ以外 → 服薬支援のお願い優先)。
 */
export function buildAudienceShareSections(
  content: unknown,
  audience: ShareAudienceKey,
  options: { hasPdf: boolean },
): ShareSection[] {
  const facts = extractShareReportFacts(content);

  const medicationBody = joinNonEmpty(
    [
      facts.medicationStatus ?? facts.genericBody,
      facts.selfManagement ? `自己管理: ${facts.selfManagement}` : null,
      facts.calendarUsed ? '服薬カレンダー使用中' : null,
    ],
    '\n',
  );
  const requestBody =
    audience === 'physician'
      ? (facts.physicianRequest ?? facts.careRequest)
      : (facts.careRequest ?? facts.physicianRequest);
  const attachmentsBody = options.hasPdf ? '訪問報告書PDF(最新の確定版)' : null;

  const sections: Array<{ key: ShareSectionKey; title: string; body: string | null }> = [
    { key: 'medication_status', title: '服薬状況', body: medicationBody },
    { key: 'residual', title: '残薬', body: facts.residual },
    { key: 'pharmacist_request', title: '薬剤師からのお願い', body: requestBody },
    { key: 'next_check', title: '次回確認すること', body: facts.nextCheck },
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

// ---------------------------------------------------------------------------
// 返信・確認
// ---------------------------------------------------------------------------

export type ShareReplyMeta = {
  id: string;
  responder_name: string;
  responded_at: string;
};

export type ShareCommunicationRequest = {
  id: string;
  recipient_name: string | null;
  recipient_role: string | null;
  status: string;
  subject: string;
  requested_at: string;
  responses: ShareReplyMeta[];
};

/** CommunicationRequest.recipient_role(自由文字列)→ 相手 5 区分 */
export function audienceKeyFromRecipientRole(role: string | null): ShareAudienceKey | null {
  if (!role) return null;
  const normalized = role.trim().toLowerCase();
  const table: Record<string, ShareAudienceKey> = {
    physician: 'physician',
    doctor: 'physician',
    主治医: 'physician',
    医師: 'physician',
    処方元医療機関: 'physician',
    care_manager: 'care_manager',
    ケアマネ: 'care_manager',
    ケアマネジャー: 'care_manager',
    nurse: 'visiting_nurse',
    visiting_nurse: 'visiting_nurse',
    訪問看護: 'visiting_nurse',
    看護師: 'visiting_nurse',
    facility: 'facility',
    facility_staff: 'facility',
    施設: 'facility',
    family: 'family',
    家族: 'family',
    // 後方互換: 旧 visit-schedule-communication 等が永続化した ReportType 由来の
    // suffixed タクソノミー。新規データは正規値(上記)を書き込むが、既存行も宛先列に
    // 突合できるよう正規区分へマップする(意図は template_key/request_type 側が保持)。
    // mcs_collaboration / internal は返信を表示しない区分のため意図的に未登録(=null)。
    family_share: 'family',
    facility_handoff: 'facility',
    nurse_share: 'visiting_nurse',
    care_manager_report: 'care_manager',
  };
  return table[normalized] ?? null;
}

/** 選択中の相手宛てで、返信が付いている最新の連携依頼を選ぶ */
export function pickLatestAudienceReplyRequest(
  requests: readonly ShareCommunicationRequest[],
  audience: ShareAudienceKey,
): ShareCommunicationRequest | null {
  const candidates = requests
    .filter((request) => audienceKeyFromRecipientRole(request.recipient_role) === audience)
    .filter((request) => request.responses.length > 0)
    .sort((a, b) => {
      const aAt = a.responses[0]?.responded_at ?? '';
      const bAt = b.responses[0]?.responded_at ?? '';
      return bAt.localeCompare(aAt);
    });
  return candidates[0] ?? null;
}

// ---------------------------------------------------------------------------
// 次回タスクにする(POST /api/tasks の入力)
// ---------------------------------------------------------------------------

export type NextCheckTaskInput = {
  task_type: string;
  title: string;
  description: string;
  priority: 'urgent' | 'high' | 'normal' | 'low';
  related_entity_type: 'patient';
  related_entity_id: string;
  dedupe_key: string;
  metadata: Record<string, string>;
};

const TASK_TITLE_MAX = 200;
const TASK_DESCRIPTION_MAX = 4000;

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/** 返信本文から次回訪問の確認タスク(運用タスク)を組み立てる */
export function buildNextCheckTaskInput(args: {
  audience: ShareAudienceKey;
  patientId: string;
  patientName: string | null;
  reportId: string;
  requestId: string;
  response: { id: string; responder_name: string; content: string };
}): NextCheckTaskInput {
  const audienceLabel = shareAudienceLabel(args.audience);
  const patientLabel = args.patientName ? `${args.patientName} 様` : '対象患者';
  const description = [
    args.response.content,
    '',
    `出典: ${audienceLabel}(${args.response.responder_name})からの返信`,
  ].join('\n');

  return {
    task_type: 'share_reply_followup',
    title: truncate(`次回訪問で確認: ${audienceLabel}からの返信(${patientLabel})`, TASK_TITLE_MAX),
    description: truncate(description, TASK_DESCRIPTION_MAX),
    priority: 'normal',
    related_entity_type: 'patient',
    related_entity_id: args.patientId,
    // 同じ返信からの二重起票を防ぐ(@@unique([org_id, dedupe_key]))
    dedupe_key: `share-reply-task:${args.response.id}`,
    metadata: {
      source: 'interprofessional_share',
      report_id: args.reportId,
      communication_request_id: args.requestId,
      communication_response_id: args.response.id,
      audience: args.audience,
    },
  };
}
