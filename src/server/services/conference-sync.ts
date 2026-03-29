import { Prisma } from '@prisma/client';

type TransactionClient = Prisma.TransactionClient;

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
};

type NoteInput = {
  id: string;
  case_id: string | null;
  note_type: string;
  title: string;
  /** ISO 8601 string or Date — when the conference was held */
  conference_date?: Date | string;
  /** [{name, role}] participant list */
  participants?: unknown;
  structured_content: unknown;
  metadata: unknown;
  action_items: unknown;
};

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
    points: 600,
    ssot_ref: '調剤報酬点数表 B011-6 退院時共同指導料',
  },
  death_conference: {
    billing_code: 'C013',
    billing_name: 'ターミナルケア管理料（在宅ターミナルケア加算）',
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
  return raw.filter(
    (item): item is Participant =>
      typeof item === 'object' && item !== null
  );
}

export interface ConferenceSyncResult {
  tasks_created: number;
  billing_candidate_id?: string;
  visit_proposal_id?: string;
  medication_issues_created: number;
  report_draft_ids?: string[];
}

function parseStructuredSections(structuredContent: unknown): StructuredSection[] {
  if (
    typeof structuredContent !== 'object' ||
    structuredContent === null ||
    !('sections' in structuredContent)
  ) {
    return [];
  }
  const raw = (structuredContent as Record<string, unknown>).sections;
  if (!Array.isArray(raw)) return [];
  return raw as StructuredSection[];
}

function findSection(sections: StructuredSection[], key: string): StructuredSection | undefined {
  return sections.find((section) => section.key === key);
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
    note: NoteInput
  ): Promise<ConferenceSyncResult> {
    const result: ConferenceSyncResult = {
      tasks_created: 0,
      medication_issues_created: 0,
    };

    // Pre-fetch careCase once so sub-methods don't each query independently.
    let patientId: string | null = null;
    let primaryPharmacistId: string | null = null;
    if (note.case_id) {
      const careCase = await tx.careCase.findFirst({
        where: { id: note.case_id, org_id: orgId },
        select: { patient_id: true, primary_pharmacist_id: true },
      });
      patientId = careCase?.patient_id ?? null;
      primaryPharmacistId = careCase?.primary_pharmacist_id ?? null;
    }

    // 1. Batch-convert action_items to Tasks
    result.tasks_created = await this.convertActionItemsBatch(tx, orgId, note);

    // 2. Register billing candidate for pre_discharge / death_conference
    if (note.note_type === 'pre_discharge' || note.note_type === 'death_conference') {
      const candidate = await this.registerBillingCandidate(tx, orgId, note, patientId, primaryPharmacistId);
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
        patientId
      );
    }

    // 5. Generate CareReport draft(s) based on note_type
    const reportDraftIds = await this.generateReportDraft(tx, orgId, userId, note, patientId);
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
    note: NoteInput
  ): Promise<number> {
    const actionItems = Array.isArray(note.action_items)
      ? (note.action_items as ActionItem[])
      : [];

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

    // One query to find all already-existing tasks for this conference note
    const existingTasks = await tx.task.findMany({
      where: {
        related_entity_id: note.id,
        related_entity_type: 'conference_note',
        org_id: orgId,
      },
      select: { dedupe_key: true },
    });
    const existingDedupeKeys = new Set(
      existingTasks.map((t) => t.dedupe_key).filter(Boolean)
    );

    // Filter to only items that do not yet exist
    const newItems = validItems.filter(
      ({ dedupeKey }) => !existingDedupeKeys.has(dedupeKey)
    );

    if (newItems.length > 0) {
      await tx.task.createMany({
        data: newItems.map(({ item, index, dedupeKey }) => ({
          org_id: orgId,
          task_type: 'conference_action_item',
          title: item.title!,
          description: `${note.title} のアクションアイテム`,
          priority: 'normal',
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

    // Return total count: existing + newly created
    return existingTasks.length + newItems.length;
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
    _primaryPharmacistId: string | null
  ): Promise<{ id: string } | null> {
    if (!note.case_id || !patientId) return null;

    const noteType = note.note_type as SupportedBillingNoteType;
    const billingConfig = CONFERENCE_BILLING_CONFIG[noteType];
    if (!billingConfig) return null;

    // Billing month is anchored to the conference_date if available,
    // otherwise falls back to the current month.
    const referenceDate = note.conference_date
      ? new Date(note.conference_date)
      : new Date();
    const billingMonth = new Date(
      referenceDate.getFullYear(),
      referenceDate.getMonth(),
      1
    );

    const participants = parseParticipants(note.participants);
    const sections = parseStructuredSections(note.structured_content);

    // --- type-specific evidence enrichment ---
    const evidenceDetails = await this.buildBillingEvidenceDetails(
      tx,
      orgId,
      patientId,
      note.case_id,
      noteType,
      sections,
      referenceDate
    );

    const dedupeKey = `conference-billing:${note.id}`;

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
      points: billingConfig.points,
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
        points: billingConfig.points,
        quantity: 1,
        status: 'candidate',
        source_snapshot: sourceSnapshot,
        calculation_breakdown: calculationBreakdown,
      },
      update: {},
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
    sections: StructuredSection[],
    referenceDate: Date
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
            OR: [
              { expiry_date: null },
              { expiry_date: { gte: referenceDate } },
            ],
          },
          select: { id: true },
        }),
        tx.managementPlan.findFirst({
          where: {
            org_id: orgId,
            case_id: caseId,
            status: 'approved',
            approved_at: { not: null },
            OR: [
              { next_review_date: null },
              { next_review_date: { gte: referenceDate } },
            ],
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

    if (noteType === 'death_conference') {
      // Read billing_confirmation section as terminal care evidence
      const billingSection = findSection(sections, 'billing_confirmation');
      if (billingSection?.body?.trim()) {
        notes.push(`請求根拠確認メモ: ${billingSection.body.trim()}`);
      } else {
        missing.push(
          'billing_confirmation セクション（ターミナルケア管理料の算定根拠）が未記入です'
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
    primaryPharmacistId: string | null
  ): Promise<{ id: string } | null> {
    if (!note.case_id || !primaryPharmacistId) return null;

    const sections = parseStructuredSections(note.structured_content);
    const visitPlanSection = findSection(sections, 'next_visit_plan');
    if (!visitPlanSection?.body) return null;

    // Propose visit 7 days from now as a default planning horizon for pre_discharge
    const proposedDate = new Date();
    proposedDate.setDate(proposedDate.getDate() + 7);
    const proposedDateOnly = new Date(
      proposedDate.getFullYear(),
      proposedDate.getMonth(),
      proposedDate.getDate()
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
    patientId: string | null
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

    await tx.medicationIssue.createMany({
      data: issueTitles.map((title) => ({
        org_id: orgId,
        patient_id: patientId,
        case_id: note.case_id!,
        title,
        description: `カンファレンス「${note.title}」で確認された薬学的課題`,
        status: 'open',
        priority: 'medium',
        category: 'other',
        identified_by: userId,
        identified_at: now,
      })),
    });

    return issueTitles.length;
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
    patientId: string | null
  ): Promise<string[]> {
    const reportTypes = REPORT_TYPE_MAP[note.note_type];
    if (!reportTypes || reportTypes.length === 0) return [];
    if (!patientId) return [];

    // Build report content from structured_content sections
    const sections = parseStructuredSections(note.structured_content);
    const sectionText = sections
      .filter((s) => s.body?.trim())
      .map((s) => `### ${s.label}\n${s.body}`)
      .join('\n\n');

    const label = NOTE_TYPE_LABEL[note.note_type] ?? '会議';

    type ReportType =
      | 'physician_report'
      | 'care_manager_report'
      | 'facility_handoff'
      | 'nurse_share'
      | 'family_share'
      | 'internal_record';

    // One query to find all existing drafts for this conference note
    const existingDrafts = await tx.careReport.findMany({
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

    // Filter to only report types that don't already exist
    const newReportTypes = reportTypes.filter(
      (rt) => !existingTypeSet.has(rt as ReportType)
    );

    if (newReportTypes.length > 0) {
      const contentBase = {
        conference_note_id: note.id,
        note_type: note.note_type,
        title: `${label} 報告書ドラフト — ${note.title}`,
        body: sectionText,
        sections: sections
          .filter((s) => s.body?.trim())
          .map((s) => ({ key: s.key, label: s.label, body: s.body ?? '' })),
      };

      await tx.careReport.createMany({
        data: newReportTypes.map((reportType) => ({
          org_id: orgId,
          patient_id: patientId,
          case_id: note.case_id ?? null,
          report_type: reportType as ReportType,
          status: 'draft' as const,
          content: contentBase as Prisma.InputJsonValue,
          created_by: userId,
        })),
      });

      // Fetch the newly created IDs
      const newDrafts = await tx.careReport.findMany({
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
        select: { id: true },
      });
      createdIds.push(...newDrafts.map((r) => r.id));
    }

    return createdIds;
  }
}
