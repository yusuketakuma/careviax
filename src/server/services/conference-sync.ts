import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import {
  buildConferenceReportDisclosureContent,
  type ConferenceReportType,
} from '@/lib/conferences/conference-report-disclosure';
import { readJsonObject, toPrismaJsonInput } from '@/lib/db/json';
import { logger } from '@/lib/utils/logger';
import { addUtcDays, japanDateKey, utcDateFromLocalKey } from '@/lib/utils/date-boundary';
import { resolveBillingAmountByKey } from './billing-evidence/billing-amount-resolver';
import { billingMonthForJapanTimestamp } from './billing-evidence/core';

type ReportType =
  | 'physician_report'
  | 'care_manager_report'
  | 'facility_handoff'
  | 'nurse_share'
  | 'family_share'
  | 'internal_record';

export type ConferenceSyncTransactionClient = {
  billingCandidate: {
    upsert(args: unknown): Promise<{ id: string }>;
  };
  careCase: {
    findFirst(
      args: unknown,
    ): Promise<{ patient_id: string | null; primary_pharmacist_id: string | null } | null>;
  };
  careReport: {
    findMany?(args: unknown): Promise<Array<{ id: string; report_type: ReportType }>>;
    createMany?(args: unknown): Promise<unknown>;
    findFirst?(args: unknown): Promise<{ id: string } | null>;
    create?(args: unknown): Promise<{ id: string }>;
  };
  consentRecord: {
    findFirst(args: unknown): Promise<{ id: string } | null>;
  };
  managementPlan: {
    findFirst(args: unknown): Promise<{ id: string } | null>;
  };
  medicationIssue: {
    findMany?(args: unknown): Promise<Array<{ title: string }>>;
    createMany?(args: unknown): Promise<unknown>;
    create?(args: unknown): Promise<unknown>;
  };
  task: {
    findMany?(args: unknown): Promise<Array<{ dedupe_key: string | null }>>;
    createMany?(args: unknown): Promise<unknown>;
    upsert?(args: unknown): Promise<unknown>;
  };
  visitScheduleProposal: {
    findFirst(args: unknown): Promise<{ id: string } | null>;
    create(args: unknown): Promise<{ id: string }>;
  };
};

type TransactionClient = ConferenceSyncTransactionClient;

function stableHashId(prefix: string, parts: Array<string | null | undefined>) {
  const hash = createHash('sha256')
    .update(parts.map((part) => part ?? '').join('\u001f'))
    .digest('hex')
    .slice(0, 32);
  return `${prefix}_${hash}`;
}

function conferenceReportDraftId(orgId: string, noteId: string, reportType: string) {
  return stableHashId('crpt', [orgId, noteId, reportType]);
}

type ActionItem = {
  title?: string;
  assignee?: string;
  converted_task_id?: string;
  converted_at?: string;
};

type StructuredSection = {
  key: string;
  label: string;
  body?: string;
};

type Participant = {
  name?: string;
  role?: string;
  attended?: boolean;
  is_report_recipient?: boolean;
  organization_name?: string;
  email?: string;
  fax?: string;
};

type NoteInput = {
  id: string;
  case_id: string | null;
  patient_id?: string | null;
  note_type: string;
  title: string;
  content?: string;
  /** ISO 8601 string or Date — when the conference was held */
  conference_date?: Date | string;
  /** [{name, role}] participant list */
  participants?: unknown;
  structured_content: unknown;
  metadata: unknown;
  action_items: unknown;
};

const CONFERENCE_OPERATION_REPORT_TYPES = new Set<ReportType>([
  'physician_report',
  'care_manager_report',
  'facility_handoff',
  'nurse_share',
  'family_share',
  'internal_record',
]);

/**
 * Billing configuration per conference note_type.
 * billing_code follows the レセ電コード standard:
 *   B011-6: 退院時共同指導料（薬局）
 *   C013:   在宅患者訪問薬剤管理指導料 ターミナルケア加算
 */
const CONFERENCE_BILLING_CONFIG = {
  pre_discharge: {
    billing_code: 'B011-6',
    billing_name: '退院時共同指導料（薬局）',
    // points は billing-rules/revisions(ssot_key)の amount を SSOT として解決する。
    // ここの値はレジストリ未収載時のフォールバックのみ。
    ssot_key: 'medical.discharge_joint_guidance',
    points: 600,
    ssot_ref: '調剤報酬点数表 B011-6 退院時共同指導料',
  },
  service_manager: {
    billing_code: 'MED_INFO_PROVISION_2_HA',
    billing_name: '服薬情報等提供料2 ハ',
    ssot_key: 'medical.information_provision.2_care_manager',
    points: 20,
    ssot_ref: '調剤報酬点数表 区分15の5 服薬情報等提供料2 ハ',
  },
  death_conference: {
    billing_code: 'C013',
    billing_name: 'ターミナルケア管理料（在宅ターミナルケア加算）',
    ssot_key: 'medical.addition.terminal_care',
    points: 2500,
    ssot_ref: '調剤報酬点数表 C013 在宅患者訪問薬剤管理指導料 ターミナルケア加算',
  },
} as const;

type SupportedBillingNoteType = keyof typeof CONFERENCE_BILLING_CONFIG;

/** Maps note_type → CareReport report_type(s) per SSOT section 7-1 */
const REPORT_TYPE_MAP: Record<string, string[]> = {
  pre_discharge: ['physician_report'],
  service_manager: ['care_manager_report'],
  death_conference: ['internal_record'],
  care_team: ['internal_record'],
  emergency: ['physician_report', 'internal_record'],
  regular: ['internal_record'],
};

function resolveOperationReportTypes(metadata: unknown): ReportType[] | undefined {
  const value = readJsonObject(metadata);
  const operation =
    value?.conference_operation &&
    typeof value.conference_operation === 'object' &&
    !Array.isArray(value.conference_operation)
      ? (value.conference_operation as Record<string, unknown>)
      : null;
  const reportType = typeof operation?.report_type === 'string' ? operation.report_type : null;
  if (!reportType || !CONFERENCE_OPERATION_REPORT_TYPES.has(reportType as ReportType)) {
    return undefined;
  }
  return [reportType as ReportType];
}

/** Human-readable Japanese label per note_type */
const NOTE_TYPE_LABEL: Record<string, string> = {
  pre_discharge: '退院前カンファレンス',
  service_manager: 'サービス担当者会議',
  death_conference: 'デスカンファレンス',
  care_team: '薬剤師間カンファレンス',
  emergency: '緊急カンファレンス',
  regular: '定例会議',
};

/** Parse participants from note.participants field (JSON array [{name, role}]). */
function parseParticipants(raw: unknown): Participant[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is Participant => typeof item === 'object' && item !== null);
}

export interface ConferenceSyncResult {
  tasks_created: number;
  billing_candidate_id?: string;
  visit_proposal_id?: string;
  medication_issues_created: number;
  report_draft_ids?: string[];
}

function parseStructuredSections(structuredContent: unknown): StructuredSection[] {
  const content = readJsonObject(structuredContent);
  const raw = content?.sections;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((section): StructuredSection[] => {
    const record = readJsonObject(section);
    if (!record) return [];
    const key = record.key;
    const label = record.label;
    if (typeof key !== 'string' || typeof label !== 'string') return [];
    return [
      {
        key,
        label,
        body: typeof record.body === 'string' ? record.body : undefined,
      },
    ];
  });
}

function findSection(sections: StructuredSection[], key: string): StructuredSection | undefined {
  return sections.find((section) => section.key === key);
}

function findSectionBody(sections: StructuredSection[], keys: string[]) {
  for (const key of keys) {
    const body = findSection(sections, key)?.body?.trim();
    if (body) return body;
  }
  return null;
}

function parseSectionLines(body?: string | null) {
  if (!body?.trim()) return [];
  return body
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function buildReportContentExtras(
  noteType: string,
  reportType:
    | 'physician_report'
    | 'care_manager_report'
    | 'facility_handoff'
    | 'nurse_share'
    | 'family_share'
    | 'internal_record',
  sections: StructuredSection[],
) {
  switch (noteType) {
    case 'pre_discharge':
      if (reportType !== 'physician_report') return {};
      return {
        discharge_background: findSectionBody(sections, ['discharge_background']),
        medication_summary: findSectionBody(sections, [
          'medication_changes_on_discharge',
          'medication_summary',
        ]),
        risks: findSectionBody(sections, ['risk_assessment']),
        next_visit_plan: findSectionBody(sections, ['next_visit_plan']),
        consent_status: findSectionBody(sections, ['consent_status']),
      };
    case 'service_manager':
      if (reportType !== 'care_manager_report') return {};
      return {
        care_plan_update: findSectionBody(sections, ['care_plan_update', 'care_plan_changes']),
        coordination: findSectionBody(sections, ['coordination_items', 'agreed_actions']),
        service_adjustments: findSectionBody(sections, [
          'service_adjustments',
          'visit_schedule_adjustment',
        ]),
      };
    case 'death_conference':
      if (reportType !== 'internal_record') return {};
      return {
        terminal_summary: findSectionBody(sections, ['terminal_process', 'timeline_summary']),
      };
    case 'care_team':
      if (reportType !== 'internal_record') return {};
      return {
        discussion_summary: findSectionBody(sections, ['discussion_summary', 'case_review']),
        medication_issues: parseSectionLines(findSectionBody(sections, ['medication_issues'])),
      };
    case 'emergency':
      if (!['physician_report', 'internal_record'].includes(reportType)) return {};
      return {
        incident_report: {
          summary: findSectionBody(sections, ['incident_summary', 'emergency_context']),
          ...(reportType === 'internal_record'
            ? { root_cause: findSectionBody(sections, ['root_cause']) }
            : {}),
          immediate_actions: parseSectionLines(
            findSectionBody(sections, ['immediate_actions', 'urgent_actions']),
          ),
          ...(reportType === 'internal_record'
            ? {
                risk_mitigation: parseSectionLines(findSectionBody(sections, ['risk_mitigation'])),
              }
            : {}),
        },
      };
    default:
      return {};
  }
}

function parseDateFromSectionBody(body?: string) {
  if (!body?.trim()) return null;

  const normalized = body.trim();
  const exactDateMatch = normalized.match(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  if (exactDateMatch) {
    const [, year, month, day] = exactDateMatch;
    const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), 12, 0, 0, 0));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function taskPriorityForActionItem(noteType: string) {
  return noteType === 'emergency' ? 'high' : 'normal';
}

export class ConferenceSyncService {
  /**
   * Executes all sync side-effects when a ConferenceNote is created.
   * Must be called inside an already-open withOrgContext transaction.
   */
  static async syncOnCreate(
    tx: TransactionClient,
    orgId: string,
    userId: string,
    note: NoteInput,
  ): Promise<ConferenceSyncResult> {
    return this.syncOnSave(tx, orgId, userId, note);
  }

  static async syncOnUpdate(
    tx: TransactionClient,
    orgId: string,
    userId: string,
    note: NoteInput,
  ): Promise<ConferenceSyncResult> {
    return this.syncOnSave(tx, orgId, userId, note);
  }

  private static async syncOnSave(
    tx: TransactionClient,
    orgId: string,
    userId: string,
    note: NoteInput,
  ): Promise<ConferenceSyncResult> {
    const result: ConferenceSyncResult = {
      tasks_created: 0,
      medication_issues_created: 0,
    };

    // Pre-fetch careCase once so sub-methods don't each query independently.
    let patientId: string | null = note.patient_id ?? null;
    let primaryPharmacistId: string | null = null;
    if (note.case_id) {
      const careCase = await tx.careCase.findFirst({
        where: { id: note.case_id, org_id: orgId },
        select: { patient_id: true, primary_pharmacist_id: true },
      });
      patientId = note.patient_id ?? careCase?.patient_id ?? null;
      primaryPharmacistId = careCase?.primary_pharmacist_id ?? null;
    }

    // 1. Batch-convert action_items to Tasks
    result.tasks_created = await this.convertActionItemsBatch(tx, orgId, note);

    // 2. Register billing candidate for pre_discharge / death_conference
    if (
      note.note_type === 'pre_discharge' ||
      note.note_type === 'service_manager' ||
      note.note_type === 'death_conference'
    ) {
      const candidate = await this.registerBillingCandidate(tx, orgId, note, patientId);
      if (candidate) result.billing_candidate_id = candidate.id;
    }

    // 3. Create visit schedule proposal for pre_discharge (if next_visit_plan section exists)
    if (note.note_type === 'pre_discharge') {
      const proposal = await this.proposeVisitSchedule(tx, orgId, note, primaryPharmacistId);
      if (proposal) result.visit_proposal_id = proposal.id;
    }

    // 4. Create medication issues for care_team (if medication_issues section exists)
    if (note.note_type === 'care_team') {
      result.medication_issues_created = await this.createMedicationIssues(
        tx,
        orgId,
        userId,
        note,
        patientId,
      );
    }

    // 5. Generate CareReport draft(s) based on note_type
    const reportDraftIds = await this.generateReportDraft(tx, orgId, userId, note, patientId, {
      reportTypes: resolveOperationReportTypes(note.metadata),
    });
    if (process.env.DEBUG_SYNC === '1') {
      logger.info('[conference-sync] generated report drafts', {
        noteId: note.id,
        draftCount: reportDraftIds.length,
        draftIds: reportDraftIds,
      });
    }
    if (reportDraftIds.length > 0) {
      result.report_draft_ids = reportDraftIds;
    }

    return result;
  }

  /**
   * Converts all action_items in the note to Task records (batch insert, skip existing).
   * Returns the total count of tasks (existing + newly created).
   */
  private static async convertActionItemsBatch(
    tx: TransactionClient,
    orgId: string,
    note: NoteInput,
  ): Promise<number> {
    const actionItems = Array.isArray(note.action_items) ? (note.action_items as ActionItem[]) : [];

    if (actionItems.length === 0) return 0;

    // Build all dedupe keys upfront (only for items with a title)
    type IndexedItem = { item: ActionItem; index: number; dedupeKey: string };
    const validItems: IndexedItem[] = [];
    for (let index = 0; index < actionItems.length; index++) {
      const item = actionItems[index];
      if (!item?.title) continue;
      validItems.push({
        item,
        index,
        dedupeKey: `conference-action-item:${note.id}:${index}`,
      });
    }
    if (validItems.length === 0) return 0;

    const taskClient = tx.task as {
      findMany?: (args: unknown) => Promise<Array<{ dedupe_key: string | null }>>;
      createMany?: (args: unknown) => Promise<unknown>;
      upsert?: (args: unknown) => Promise<unknown>;
    };

    if (typeof taskClient.findMany === 'function' && typeof taskClient.createMany === 'function') {
      const existingTasks = await taskClient.findMany({
        where: {
          related_entity_id: note.id,
          related_entity_type: 'conference_note',
          org_id: orgId,
        },
        select: { dedupe_key: true },
      });
      const existingDedupeKeys = new Set(existingTasks.map((t) => t.dedupe_key).filter(Boolean));

      const newItems = validItems.filter(({ dedupeKey }) => !existingDedupeKeys.has(dedupeKey));

      if (newItems.length > 0) {
        await taskClient.createMany({
          data: newItems.map(({ item, index, dedupeKey }) => ({
            org_id: orgId,
            task_type: 'conference_action_item',
            title: item.title!,
            description: `${note.title} のアクションアイテム`,
            priority: taskPriorityForActionItem(note.note_type),
            dedupe_key: dedupeKey,
            related_entity_type: 'conference_note',
            related_entity_id: note.id,
            metadata: {
              note_id: note.id,
              note_title: note.title,
              note_type: note.note_type,
              case_id: note.case_id,
              action_item_index: index,
              assignee_label: item.assignee ?? null,
              conference_metadata: note.metadata ?? null,
            },
          })),
          skipDuplicates: true,
        });
      }

      return existingTasks.length + newItems.length;
    }

    if (typeof taskClient.upsert !== 'function') return 0;

    for (const { item, index, dedupeKey } of validItems) {
      await taskClient.upsert({
        where: {
          org_id_dedupe_key: {
            org_id: orgId,
            dedupe_key: dedupeKey,
          },
        },
        update: {},
        create: {
          org_id: orgId,
          task_type: 'conference_action_item',
          title: item.title!,
          description: `${note.title} のアクションアイテム`,
          priority: taskPriorityForActionItem(note.note_type),
          dedupe_key: dedupeKey,
          related_entity_type: 'conference_note',
          related_entity_id: note.id,
          metadata: {
            note_id: note.id,
            note_title: note.title,
            note_type: note.note_type,
            case_id: note.case_id,
            action_item_index: index,
            assignee_label: item.assignee ?? null,
            conference_metadata: note.metadata ?? null,
          },
        },
      });
    }

    return validItems.length;
  }

  /**
   * Registers a BillingCandidate for conference types that trigger billing.
   *
   * Enhancements over the baseline CWI-01B implementation:
   * - Uses proper レセ電コード (B011-6 / C013) instead of internal codes
   * - Enriches source_snapshot with conference date, participants, and note title
   * - For pre_discharge: checks ConsentRecord + ManagementPlan existence to
   *   set preliminary claimable_hint so reviewers know what is still missing
   * - For death_conference: captures billing_confirmation section body as
   *   terminal care evidence detail in calculation_breakdown
   */
  private static async registerBillingCandidate(
    tx: TransactionClient,
    orgId: string,
    note: NoteInput,
    patientId: string | null,
  ): Promise<{ id: string } | null> {
    if (!note.case_id || !patientId) return null;

    const noteType = note.note_type as SupportedBillingNoteType;
    const billingConfig = CONFERENCE_BILLING_CONFIG[noteType];
    if (!billingConfig) return null;

    // Billing month is anchored to the conference_date if available,
    // otherwise falls back to the current month.
    const referenceDate = note.conference_date ? new Date(note.conference_date) : new Date();
    const billingMonth = billingMonthForJapanTimestamp(referenceDate);
    const points =
      resolveBillingAmountByKey(billingMonth).get(billingConfig.ssot_key) ?? billingConfig.points;

    const participants = parseParticipants(note.participants);
    const sections = parseStructuredSections(note.structured_content);

    // --- type-specific evidence enrichment ---
    const evidenceDetails = await this.buildBillingEvidenceDetails(
      tx,
      orgId,
      patientId,
      note.case_id,
      noteType,
      note.participants,
      sections,
      referenceDate,
    );

    const dedupeKey = [
      'conference-billing',
      orgId,
      patientId,
      billingConfig.billing_code,
      billingMonth.toISOString().slice(0, 10),
      note.id,
    ].join(':');

    // source_snapshot captures all conference context for audit purposes
    const sourceSnapshot: Prisma.InputJsonValue = {
      source_type: 'conference_note',
      conference_note_id: note.id,
      note_type: note.note_type,
      note_title: note.title,
      case_id: note.case_id,
      conference_date: referenceDate.toISOString(),
      participants: participants.map((p) => ({
        name: p.name ?? null,
        role: p.role ?? null,
      })),
      ssot_ref: billingConfig.ssot_ref,
    };

    // calculation_breakdown captures evidence completeness state for reviewers
    const calculationBreakdown: Prisma.InputJsonValue = {
      billing_code: billingConfig.billing_code,
      billing_name: billingConfig.billing_name,
      points,
      payer_basis: 'medical',
      claimable_hint: evidenceDetails.claimableHint,
      missing_conditions: evidenceDetails.missingConditions,
      evidence_notes: evidenceDetails.evidenceNotes,
      generated_at: new Date().toISOString(),
    };

    const candidate = await tx.billingCandidate.upsert({
      where: {
        org_id_dedupe_key: {
          org_id: orgId,
          dedupe_key: dedupeKey,
        },
      },
      create: {
        org_id: orgId,
        patient_id: patientId,
        dedupe_key: dedupeKey,
        billing_month: billingMonth,
        billing_code: billingConfig.billing_code,
        billing_name: billingConfig.billing_name,
        points,
        quantity: 1,
        status: 'candidate',
        source_snapshot: sourceSnapshot,
        calculation_breakdown: calculationBreakdown,
      },
      update: {
        patient_id: patientId,
        billing_month: billingMonth,
        billing_code: billingConfig.billing_code,
        billing_name: billingConfig.billing_name,
        points,
        quantity: 1,
        source_snapshot: sourceSnapshot,
        calculation_breakdown: calculationBreakdown,
      },
      select: { id: true },
    });

    return candidate;
  }

  /**
   * Builds evidence-completeness metadata for the BillingCandidate.calculation_breakdown.
   *
   * For pre_discharge (B011-6):
   *   - Checks ConsentRecord and ManagementPlan existence to determine claimable_hint
   * For death_conference (C013):
   *   - Reads billing_confirmation section body as terminal care evidence detail
   */
  private static async buildBillingEvidenceDetails(
    tx: TransactionClient,
    orgId: string,
    patientId: string,
    caseId: string,
    noteType: SupportedBillingNoteType,
    participants: unknown,
    sections: StructuredSection[],
    referenceDate: Date,
  ): Promise<{
    claimableHint: boolean;
    missingConditions: string[];
    evidenceNotes: string[];
  }> {
    const missing: string[] = [];
    const notes: string[] = [];

    if (noteType === 'pre_discharge') {
      // Check active consent record and approved management plan in parallel
      const [consent, plan] = await Promise.all([
        tx.consentRecord.findFirst({
          where: {
            org_id: orgId,
            patient_id: patientId,
            consent_type: 'visit_medication_management',
            is_active: true,
            revoked_date: null,
            OR: [{ expiry_date: null }, { expiry_date: { gte: referenceDate } }],
          },
          select: { id: true },
        }),
        tx.managementPlan.findFirst({
          where: {
            org_id: orgId,
            case_id: caseId,
            status: 'approved',
            approved_at: { not: null },
            OR: [{ next_review_date: null }, { next_review_date: { gte: referenceDate } }],
          },
          select: { id: true },
        }),
      ]);

      if (!consent) {
        missing.push('在宅療養管理同意記録（ConsentRecord）が未取得です');
      }
      if (!plan) {
        missing.push('服薬管理計画書（ManagementPlan）が承認されていません');
      }

      // consent_status section can provide additional context
      const consentSection = findSection(sections, 'consent_status');
      if (consentSection?.body?.trim()) {
        notes.push(`同意取得状況メモ: ${consentSection.body.trim()}`);
      }

      return {
        claimableHint: missing.length === 0,
        missingConditions: missing,
        evidenceNotes: notes,
      };
    }

    if (noteType === 'service_manager') {
      const careManagerAttended = parseParticipants(participants).some((participant) => {
        const normalizedRole = participant.role?.toLowerCase() ?? '';
        return (
          participant.attended !== false &&
          (normalizedRole.includes('care_manager') ||
            normalizedRole.includes('ケアマネ') ||
            normalizedRole.includes('介護支援専門員'))
        );
      });

      if (!careManagerAttended) {
        missing.push('参加者に出席済みのケアマネジャーが含まれていません');
      }

      const serviceAdjustment = findSection(sections, 'service_adjustments');
      if (serviceAdjustment?.body?.trim()) {
        notes.push(`サービス調整メモ: ${serviceAdjustment.body.trim()}`);
      }

      return {
        claimableHint: missing.length === 0,
        missingConditions: missing,
        evidenceNotes: notes,
      };
    }

    if (noteType === 'death_conference') {
      // Read billing_confirmation section as terminal care evidence
      const billingSection = findSection(sections, 'billing_confirmation');
      if (billingSection?.body?.trim()) {
        notes.push(`請求根拠確認メモ: ${billingSection.body.trim()}`);
      } else {
        missing.push(
          'billing_confirmation セクション（ターミナルケア管理料の算定根拠）が未記入です',
        );
      }

      // Also capture terminal_process section as supporting evidence
      const terminalSection = findSection(sections, 'terminal_process');
      if (terminalSection?.body?.trim()) {
        notes.push(`ターミナル経過メモ: ${terminalSection.body.trim()}`);
      }

      return {
        claimableHint: missing.length === 0,
        missingConditions: missing,
        evidenceNotes: notes,
      };
    }

    // Should not be reached for supported note types
    return { claimableHint: false, missingConditions: [], evidenceNotes: [] };
  }

  /**
   * Creates a VisitScheduleProposal if structured_content has a next_visit_plan section.
   * Requires case_id and a proposed_pharmacist_id embedded in the section body or metadata.
   */
  private static async proposeVisitSchedule(
    tx: TransactionClient,
    orgId: string,
    note: NoteInput,
    primaryPharmacistId: string | null,
  ): Promise<{ id: string } | null> {
    if (!note.case_id || !primaryPharmacistId) return null;

    const sections = parseStructuredSections(note.structured_content);
    const visitPlanSection = findSection(sections, 'next_visit_plan');
    const targetDischargeDate = parseDateFromSectionBody(
      findSection(sections, 'target_discharge_date')?.body,
    );
    if (!visitPlanSection?.body && !targetDischargeDate) return null;

    // Prefer a discharge-anchored first-visit proposal when the note records
    // an explicit discharge date. Otherwise, keep the previous short-horizon default.
    // 起点は退院日(あれば)/現在日時のいずれも JST 民間日で読み、+3/+7 日を @db.Date sentinel
    // (UTC 深夜)で保存する。getUTCDate / setDate ベースだと UTC prod の JST 早朝で 1 日ずれる。
    const baseDateKey = targetDischargeDate
      ? japanDateKey(targetDischargeDate)
      : japanDateKey(new Date());
    const proposedDateOnly = addUtcDays(
      utcDateFromLocalKey(baseDateKey),
      targetDischargeDate ? 3 : 7,
    );

    const dedupeKey = `conference-visit-proposal:${note.id}`;

    // Check if a proposal with this dedupe-equivalent already exists to avoid duplicates.
    // VisitScheduleProposal has no dedupe_key field, so we check by proposal_reason pattern.
    const existing = await tx.visitScheduleProposal.findFirst({
      where: {
        org_id: orgId,
        case_id: note.case_id,
        proposal_reason: dedupeKey,
      },
      select: { id: true },
    });
    if (existing) return existing;

    const proposal = await tx.visitScheduleProposal.create({
      data: {
        org_id: orgId,
        case_id: note.case_id,
        visit_type: 'regular',
        priority: 'normal',
        proposal_status: 'proposed',
        patient_contact_status: 'pending',
        proposed_date: proposedDateOnly,
        proposed_pharmacist_id: primaryPharmacistId,
        assignment_mode: 'primary',
        proposal_reason: dedupeKey,
        escalation_reason: null,
      },
      select: { id: true },
    });

    return proposal;
  }

  /**
   * Creates MedicationIssue records from the medication_issues section body.
   * Expects a newline-separated list of issue titles in the section body.
   */
  private static async createMedicationIssues(
    tx: TransactionClient,
    orgId: string,
    userId: string,
    note: NoteInput,
    patientId: string | null,
  ): Promise<number> {
    if (!note.case_id || !patientId) return 0;

    const sections = parseStructuredSections(note.structured_content);
    const issueSection = findSection(sections, 'medication_issues');
    if (!issueSection?.body?.trim()) return 0;

    // Parse issue titles: one per non-empty line
    const issueTitles = issueSection.body
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    if (issueTitles.length === 0) return 0;

    const now = new Date();
    const description = `カンファレンス「${note.title}」(${note.id})で確認された薬学的課題`;

    const medicationIssueClient = tx.medicationIssue as {
      findMany?: (args: unknown) => Promise<Array<{ title: string }>>;
      createMany?: (args: unknown) => Promise<unknown>;
      create?: (args: unknown) => Promise<unknown>;
    };

    const existingIssues =
      typeof medicationIssueClient.findMany === 'function'
        ? await medicationIssueClient.findMany({
            where: {
              org_id: orgId,
              patient_id: patientId,
              case_id: note.case_id,
              title: {
                in: issueTitles,
              },
              description,
            },
            select: { title: true },
          })
        : [];
    const existingTitleSet = new Set(existingIssues.map((issue) => issue.title));
    const newIssueTitles = issueTitles.filter((title) => !existingTitleSet.has(title));

    if (newIssueTitles.length === 0) {
      return existingTitleSet.size;
    }

    if (typeof medicationIssueClient.createMany === 'function') {
      await medicationIssueClient.createMany({
        data: newIssueTitles.map((title) => ({
          org_id: orgId,
          patient_id: patientId,
          case_id: note.case_id!,
          title,
          description,
          status: 'open',
          priority: 'medium',
          category: 'other',
          identified_by: userId,
          identified_at: now,
        })),
      });
    } else if (typeof medicationIssueClient.create === 'function') {
      for (const title of newIssueTitles) {
        await medicationIssueClient.create({
          data: {
            org_id: orgId,
            patient_id: patientId,
            case_id: note.case_id!,
            title,
            description,
            status: 'open',
            priority: 'medium',
            category: 'other',
            identified_by: userId,
            identified_at: now,
          },
        });
      }
    }

    return existingTitleSet.size + newIssueTitles.length;
  }

  /**
   * Generates one or more CareReport draft records from a ConferenceNote.
   * Maps note_type to report_type(s) according to the SSOT wiring spec.
   * Returns the IDs of all created drafts.
   */
  static async generateReportDraft(
    tx: TransactionClient,
    orgId: string,
    userId: string,
    note: NoteInput,
    patientId: string | null,
    options?: {
      reportTypes?: Array<
        | 'physician_report'
        | 'care_manager_report'
        | 'facility_handoff'
        | 'nurse_share'
        | 'family_share'
        | 'internal_record'
      >;
      includeStructuredContent?: boolean;
    },
  ): Promise<string[]> {
    const reportTypes = options?.reportTypes ?? REPORT_TYPE_MAP[note.note_type];
    if (process.env.DEBUG_SYNC === '1') {
      logger.info('[conference-sync.generate]', {
        noteType: note.note_type,
        reportTypes,
        patientId,
        hasFindMany: typeof (tx.careReport as { findMany?: unknown }).findMany === 'function',
        hasCreateMany: typeof (tx.careReport as { createMany?: unknown }).createMany === 'function',
        hasFindFirst: typeof (tx.careReport as { findFirst?: unknown }).findFirst === 'function',
        hasCreate: typeof (tx.careReport as { create?: unknown }).create === 'function',
      });
    }
    if (!reportTypes || reportTypes.length === 0) return [];
    if (!patientId) return [];

    const includeStructuredContent = options?.includeStructuredContent !== false;
    const sections = includeStructuredContent
      ? parseStructuredSections(note.structured_content)
      : [];
    const noteContent = typeof note.content === 'string' ? note.content.trim() : '';

    const label = NOTE_TYPE_LABEL[note.note_type] ?? '会議';

    const careReportClient = tx.careReport as {
      findMany?: (args: unknown) => Promise<Array<{ id: string; report_type: ReportType }>>;
      createMany?: (args: unknown) => Promise<unknown>;
      findFirst?: (args: unknown) => Promise<{ id: string } | null>;
      create?: (args: unknown) => Promise<{ id: string }>;
    };

    if (
      typeof careReportClient.findMany === 'function' &&
      typeof careReportClient.createMany === 'function'
    ) {
      const existingDrafts = await careReportClient.findMany({
        where: {
          org_id: orgId,
          patient_id: patientId,
          status: 'draft',
          content: {
            path: ['conference_note_id'],
            equals: note.id,
          },
        },
        select: { id: true, report_type: true },
      });
      const existingTypeSet = new Set(existingDrafts.map((r) => r.report_type));

      const createdIds: string[] = existingDrafts.map((r) => r.id);
      const newReportTypes = reportTypes.filter((rt) => !existingTypeSet.has(rt as ReportType));

      if (newReportTypes.length > 0) {
        await careReportClient.createMany({
          data: newReportTypes.map((reportType) => ({
            org_id: orgId,
            patient_id: patientId,
            case_id: note.case_id ?? null,
            report_type: reportType as ReportType,
            id: conferenceReportDraftId(orgId, note.id, reportType),
            status: 'draft' as const,
            content: toPrismaJsonInput({
              ...buildConferenceReportDisclosureContent({
                conferenceNoteId: note.id,
                noteType: note.note_type,
                noteTitle: note.title,
                reportType: reportType as ConferenceReportType,
                label,
                sections,
                noteContent,
                includeStructuredContent,
              }),
              ...buildReportContentExtras(note.note_type, reportType as ReportType, sections),
            }),
            created_by: userId,
          })),
          skipDuplicates: true,
        });

        const newDrafts = await careReportClient.findMany({
          where: {
            org_id: orgId,
            patient_id: patientId,
            status: 'draft',
            report_type: { in: newReportTypes as ReportType[] },
            content: {
              path: ['conference_note_id'],
              equals: note.id,
            },
          },
          select: { id: true, report_type: true },
        });
        createdIds.push(...newDrafts.map((r) => r.id));
      }

      return createdIds;
    }

    const createdIds: string[] = [];

    for (const reportType of reportTypes) {
      const existingDraft =
        typeof careReportClient.findFirst === 'function'
          ? await careReportClient.findFirst({
              where: {
                org_id: orgId,
                patient_id: patientId,
                status: 'draft',
                report_type: reportType as ReportType,
                content: {
                  path: ['conference_note_id'],
                  equals: note.id,
                },
              },
              select: { id: true },
            })
          : null;

      if (process.env.DEBUG_SYNC === '1') {
        logger.info('[conference-sync.existingDraft]', {
          reportType,
          existingDraftId: existingDraft?.id ?? null,
        });
      }

      if (existingDraft) {
        createdIds.push(existingDraft.id);
        continue;
      }

      if (typeof careReportClient.create !== 'function') continue;

      const createdDraft = await careReportClient.create({
        data: {
          org_id: orgId,
          patient_id: patientId,
          case_id: note.case_id ?? null,
          report_type: reportType as ReportType,
          id: conferenceReportDraftId(orgId, note.id, reportType),
          status: 'draft' as const,
          content: toPrismaJsonInput({
            ...buildConferenceReportDisclosureContent({
              conferenceNoteId: note.id,
              noteType: note.note_type,
              noteTitle: note.title,
              reportType: reportType as ConferenceReportType,
              label,
              sections,
              noteContent,
              includeStructuredContent,
            }),
            ...buildReportContentExtras(note.note_type, reportType as ReportType, sections),
          }),
          created_by: userId,
        },
      });
      if (process.env.DEBUG_SYNC === '1') {
        logger.info('[conference-sync.createdDraft]', {
          reportType,
          createdDraftId: createdDraft.id,
          patientId,
          // status is the literal we just persisted; the typed client return
          // shape does not surface it, but the value is known at the call site.
          status: 'draft',
        });
      }
      createdIds.push(createdDraft.id);
    }

    return createdIds;
  }
}
