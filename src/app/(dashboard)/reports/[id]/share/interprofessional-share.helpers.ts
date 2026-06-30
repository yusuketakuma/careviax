import type { CareManagerReportContent, PhysicianReportContent } from '@/types/care-report-content';
import type { AudienceReportContent } from '@/types/care-report-content';
import {
  audienceKeyFromRecipientRole,
  defaultAudienceForReportType,
  SHARE_AUDIENCES,
  shareAudienceLabel,
  type ShareAudience,
  type ShareAudienceKey,
} from '@/lib/communications/share-audience';

export {
  audienceKeyFromRecipientRole,
  defaultAudienceForReportType,
  SHARE_AUDIENCES,
  shareAudienceLabel,
};
export type { ShareAudience, ShareAudienceKey };

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
  recipientName: string | null;
  recipientOrganizationName: string | null;
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
      recipientName: member?.name ?? null,
      recipientOrganizationName: member?.organization_name ?? null,
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
  const filled = parts.map((part) => part?.trim()).filter((part): part is string => Boolean(part));
  return filled.length > 0 ? filled.join(separator) : null;
}

function isPhysicianContent(value: unknown): value is PhysicianReportContent {
  return isStringRecord(value) && isStringRecord(value.medication_management);
}

function isCareManagerContent(value: unknown): value is CareManagerReportContent {
  return isStringRecord(value) && isStringRecord(value.medication_management_summary);
}

function isAudienceContent(value: unknown): value is AudienceReportContent {
  return (
    isStringRecord(value) &&
    (value.report_audience === 'visiting_nurse' ||
      value.report_audience === 'facility' ||
      value.report_audience === 'family') &&
    typeof value.summary === 'string' &&
    typeof value.medication === 'string' &&
    typeof value.residual === 'string' &&
    typeof value.evaluation === 'string' &&
    typeof value.requests === 'string'
  );
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

  if (isAudienceContent(content)) {
    return {
      ...empty,
      medicationStatus: readString(content.medication),
      residual: readString(content.residual),
      careRequest: readString(content.requests),
      nextCheck: readString(content.evaluation),
      genericBody: readString(content.summary),
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

/** 選択中の相手宛てで、作成日時が最も新しい連携依頼を選ぶ */
export function pickLatestAudienceRequest(
  requests: readonly ShareCommunicationRequest[],
  audience: ShareAudienceKey,
): ShareCommunicationRequest | null {
  const candidates = requests
    .filter((request) => audienceKeyFromRecipientRole(request.recipient_role) === audience)
    .sort((a, b) => b.requested_at.localeCompare(a.requested_at));
  return candidates[0] ?? null;
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
// 返信依頼を起票する(POST /api/communication-requests の入力)
// ---------------------------------------------------------------------------

export type ShareCommunicationRequestInput = {
  patient_id: string;
  case_id?: string;
  request_type: string;
  template_key: string;
  recipient_name: string;
  recipient_role: string;
  related_entity_type: 'care_report';
  related_entity_id: string;
  context_snapshot: Record<string, string | string[]>;
  status: 'sent';
  subject: string;
  content: string;
};

const REQUEST_SUBJECT_MAX = 200;
const REQUEST_CONTENT_MAX = 4000;

const COMMUNICATION_RECIPIENT_ROLE_BY_AUDIENCE: Record<ShareAudienceKey, string> = {
  physician: 'physician',
  care_manager: 'care_manager',
  visiting_nurse: 'visiting_nurse',
  facility: 'facility',
  family: 'family',
};

function formatPatientLabel(patientName: string | null): string {
  return patientName ? `${patientName} 様` : '対象患者';
}

function buildShareRequestContent(args: {
  audienceLabel: string;
  sections: readonly ShareSection[];
}): string {
  return truncate(
    [
      `${args.audienceLabel}向けに共有する報告内容です。確認後、必要な返信をPH-OSの連携依頼へ記録してください。`,
      '',
      ...args.sections.map((section) => `【${section.title}】\n${section.body}`),
    ].join('\n'),
    REQUEST_CONTENT_MAX,
  );
}

export function buildShareCommunicationRequestInput(args: {
  audience: ShareAudienceKey;
  patientId: string;
  caseId: string | null | undefined;
  patientName: string | null;
  reportId: string;
  reportType: string;
  recipientName: string;
  recipientOrganizationName: string | null;
  sections: readonly ShareSection[];
}): ShareCommunicationRequestInput {
  const audienceLabel = shareAudienceLabel(args.audience);
  const subject = truncate(
    `返信依頼: ${audienceLabel}向け報告書共有(${formatPatientLabel(args.patientName)})`,
    REQUEST_SUBJECT_MAX,
  );

  return {
    patient_id: args.patientId,
    ...(args.caseId ? { case_id: args.caseId } : {}),
    request_type: 'care_report_reply_request',
    template_key: 'interprofessional_share_reply_request',
    recipient_name: args.recipientName,
    recipient_role: COMMUNICATION_RECIPIENT_ROLE_BY_AUDIENCE[args.audience],
    related_entity_type: 'care_report',
    related_entity_id: args.reportId,
    context_snapshot: {
      source: 'interprofessional_share',
      report_id: args.reportId,
      report_type: args.reportType,
      audience: args.audience,
      ...(args.recipientOrganizationName
        ? { recipient_organization_name: args.recipientOrganizationName }
        : {}),
      section_keys: args.sections.map((section) => section.key),
    },
    status: 'sent',
    subject,
    content: buildShareRequestContent({ audienceLabel, sections: args.sections }),
  };
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
    task_type: 'report_response_followup',
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
