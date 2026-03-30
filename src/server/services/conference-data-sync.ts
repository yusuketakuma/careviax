import { Prisma } from '@prisma/client';
import {
  ConferenceSyncService,
  type ConferenceSyncResult,
} from '@/server/services/conference-sync';
import {
  upsertOperationalTask,
  resolveOperationalTasks,
} from '@/server/services/operational-tasks';

type TransactionClient = Prisma.TransactionClient;

type PersistedConferenceNote = {
  id: string;
  case_id: string | null;
  patient_id: string | null;
  facility_id: string | null;
  note_type: string;
  title: string;
  content: string;
  structured_content: Prisma.JsonValue | null;
  metadata: Prisma.JsonValue | null;
  billing_eligible: boolean;
  billing_code: string | null;
  follow_up_date: Date | null;
  follow_up_completed: boolean;
  generated_report_id: string | null;
  participants: Prisma.JsonValue;
  conference_date: Date;
  action_items: Prisma.JsonValue | null;
};

type StructuredSection = {
  key: string;
  label: string;
  body?: string;
};

type CareCaseSummary = {
  id: string;
  patient_id: string;
  primary_pharmacist_id: string | null;
};

type ConferenceDerivedSyncResult = {
  tasksCreated: number;
  medicationIssuesCreated: number;
  visitProposalId?: string | null;
};

function parseStructuredSections(structuredContent: Prisma.JsonValue | null): StructuredSection[] {
  if (
    typeof structuredContent !== 'object' ||
    structuredContent === null ||
    !('sections' in structuredContent)
  ) {
    return [];
  }

  const rawSections = (structuredContent as { sections?: unknown }).sections;
  if (!Array.isArray(rawSections)) return [];
  return rawSections.filter(
    (section): section is StructuredSection =>
      typeof section === 'object' && section !== null && 'key' in section && 'label' in section
  );
}

function findSection(sections: StructuredSection[], key: string) {
  return sections.find((section) => section.key === key);
}

function parseSectionLines(body?: string) {
  if (!body?.trim()) return [];

  return body
    .split('\n')
    .map((line) => line.replace(/^[\s\-*・]+/, '').trim())
    .filter((line) => line.length > 0);
}

function parseDateFromBody(body?: string) {
  if (!body?.trim()) return null;

  const match = body.match(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  if (match) {
    const [, year, month, day] = match;
    const parsed = new Date(
      Date.UTC(Number(year), Number(month) - 1, Number(day), 12, 0, 0, 0)
    );
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const parsed = new Date(body.trim());
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDateKey(value: Date) {
  const year = value.getUTCFullYear();
  const month = `${value.getUTCMonth() + 1}`.padStart(2, '0');
  const day = `${value.getUTCDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function dayCodeFromDate(value: Date) {
  return ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'][value.getUTCDay()] ?? 'MO';
}

function weekOfMonthFromDate(value: Date) {
  return Math.min(5, Math.max(1, Math.ceil(value.getUTCDate() / 7)));
}

function deriveRecurringVisitRule(
  source: string,
  anchorDate: Date,
  fallbackRule?: string | null
) {
  const unitMatches = Array.from(source.matchAll(/(月|週)\s*(\d+)\s*回/g));
  if (unitMatches.length === 0) return null;

  const [, unit, countRaw] = unitMatches[unitMatches.length - 1] ?? [];
  const count = Number.parseInt(countRaw ?? '', 10);
  if (!Number.isFinite(count) || count <= 0) return null;

  const byDayMatch = fallbackRule?.match(/BYDAY=([A-Z0-9,]+)/);
  const fallbackByDay = byDayMatch?.[1]
    ?.split(',')
    .find((entry) => /(?:SU|MO|TU|WE|TH|FR|SA)$/.test(entry))
    ?.replace(/^[0-9+-]+/, '');
  const byDay = fallbackByDay ?? dayCodeFromDate(anchorDate);

  if (unit === '週') {
    if (count !== 1) return null;
    return `FREQ=WEEKLY;INTERVAL=1;BYDAY=${byDay}`;
  }

  if (count === 4) {
    return `FREQ=WEEKLY;INTERVAL=1;BYDAY=${byDay}`;
  }
  if (count === 2) {
    return `FREQ=WEEKLY;INTERVAL=2;BYDAY=${byDay}`;
  }
  if (count === 1) {
    return `FREQ=MONTHLY;INTERVAL=1;BYDAY=${weekOfMonthFromDate(anchorDate)}${byDay}`;
  }
  if (count === 3) {
    return `FREQ=MONTHLY;INTERVAL=1;BYDAY=1${byDay},3${byDay},5${byDay}`;
  }

  return null;
}

function mergeConferenceSyncMetadata(
  existingMetadata: Prisma.JsonValue | null,
  sync: ConferenceSyncResult
): Prisma.InputJsonValue | undefined {
  const hasSyncSummary =
    Boolean(sync.report_draft_ids?.length) ||
    Boolean(sync.billing_candidate_id) ||
    Boolean(sync.visit_proposal_id) ||
    Boolean(sync.tasks_created) ||
    Boolean(sync.medication_issues_created);

  if (!hasSyncSummary) {
    if (existingMetadata === null) return undefined;
    return existingMetadata as Prisma.InputJsonValue;
  }

  const base =
    existingMetadata && typeof existingMetadata === 'object' && !Array.isArray(existingMetadata)
      ? (existingMetadata as Prisma.InputJsonObject)
      : {};

  return {
    ...base,
    sync_summary: {
      report_draft_ids: sync.report_draft_ids ?? [],
      billing_candidate_id: sync.billing_candidate_id ?? null,
      visit_proposal_id: sync.visit_proposal_id ?? null,
      tasks_created: sync.tasks_created ?? 0,
      medication_issues_created: sync.medication_issues_created ?? 0,
    },
  } satisfies Prisma.InputJsonObject;
}

function metadataChanged(
  currentMetadata: Prisma.JsonValue | null,
  nextMetadata: Prisma.InputJsonValue | undefined
) {
  const currentSerialized = JSON.stringify(currentMetadata ?? null);
  const nextSerialized = JSON.stringify(nextMetadata ?? null);
  return currentSerialized !== nextSerialized;
}

async function loadCareCaseSummary(
  tx: TransactionClient,
  orgId: string,
  caseId: string | null
): Promise<CareCaseSummary | null> {
  if (!caseId) return null;

  return tx.careCase.findFirst({
    where: {
      id: caseId,
      org_id: orgId,
    },
    select: {
      id: true,
      patient_id: true,
      primary_pharmacist_id: true,
    },
  });
}

async function upsertConferenceLineTasks(
  tx: TransactionClient,
  args: {
    orgId: string;
    note: PersistedConferenceNote;
    sectionKey: string;
    taskType: string;
    titlePrefix?: string;
    priority?: 'urgent' | 'high' | 'normal' | 'low';
    assignedTo?: string | null;
    relatedEntityType?: string | null;
    relatedEntityId?: string | null;
    lines: string[];
  }
) {
  let count = 0;

  for (const [index, line] of args.lines.entries()) {
    await upsertOperationalTask(tx, {
      orgId: args.orgId,
      taskType: args.taskType,
      title: args.titlePrefix ? `${args.titlePrefix}: ${line}` : line,
      description: `${args.note.title} の ${args.sectionKey} から生成`,
      priority: args.priority ?? 'normal',
      assignedTo: args.assignedTo ?? null,
      dedupeKey: `conference-section-task:${args.note.id}:${args.sectionKey}:${index}`,
      relatedEntityType: args.relatedEntityType ?? 'conference_note',
      relatedEntityId: args.relatedEntityId ?? args.note.id,
      metadata: {
        note_id: args.note.id,
        case_id: args.note.case_id,
        section_key: args.sectionKey,
        line_index: index,
        line,
      } satisfies Prisma.InputJsonValue,
    });
    count++;
  }

  return count;
}

async function upsertMedicationIssuesFromSection(
  tx: TransactionClient,
  args: {
    orgId: string;
    userId: string;
    note: PersistedConferenceNote;
    patientId: string | null;
    sectionKey: string;
    lines: string[];
  }
) {
  if (!args.note.case_id || !args.patientId || args.lines.length === 0) return 0;

  const description = `カンファレンス「${args.note.title}」(${args.note.id})の ${args.sectionKey}`;
  const existingIssues = await tx.medicationIssue.findMany({
    where: {
      org_id: args.orgId,
      patient_id: args.patientId,
      case_id: args.note.case_id,
      description,
      title: {
        in: args.lines,
      },
    },
    select: {
      title: true,
    },
  });
  const existingTitles = new Set(existingIssues.map((issue) => issue.title));
  const newTitles = args.lines.filter((line) => !existingTitles.has(line));

  if (newTitles.length > 0) {
    await tx.medicationIssue.createMany({
      data: newTitles.map((title) => ({
        org_id: args.orgId,
        patient_id: args.patientId!,
        case_id: args.note.case_id!,
        title,
        description,
        status: 'open',
        priority: 'medium',
        category: 'other',
        identified_by: args.userId,
        identified_at: new Date(),
      })),
    });
  }

  return existingTitles.size + newTitles.length;
}

async function syncPreDischargeUsage(
  tx: TransactionClient,
  orgId: string,
  userId: string,
  note: PersistedConferenceNote,
  careCase: CareCaseSummary | null,
  sections: StructuredSection[]
): Promise<ConferenceDerivedSyncResult> {
  const medicationIssuesCreated = await upsertMedicationIssuesFromSection(tx, {
    orgId,
    userId,
    note,
    patientId: careCase?.patient_id ?? null,
    sectionKey: 'medication_changes_on_discharge',
    lines: parseSectionLines(findSection(sections, 'medication_changes_on_discharge')?.body),
  });

  const dischargeDate =
    parseDateFromBody(findSection(sections, 'target_discharge_date')?.body) ??
    note.conference_date;
  let tasksCreated = 0;

  if (note.case_id) {
    await upsertOperationalTask(tx, {
      orgId,
      taskType: 'management_plan_review',
      title: '退院前会議に伴う管理計画書更新',
      description: '退院前カンファレンスの内容を反映して管理計画書を更新してください。',
      priority: 'high',
      assignedTo: careCase?.primary_pharmacist_id ?? null,
      dueDate: dischargeDate,
      slaDueAt: dischargeDate,
      dedupeKey: `conference-management-plan-review:${note.id}`,
      relatedEntityType: 'conference_note',
      relatedEntityId: note.id,
      metadata: {
        case_id: note.case_id,
        patient_id: careCase?.patient_id ?? null,
        target_discharge_date: formatDateKey(dischargeDate),
      } satisfies Prisma.InputJsonValue,
    });
    tasksCreated++;
  } else {
    await resolveOperationalTasks(tx, {
      orgId,
      dedupeKey: `conference-management-plan-review:${note.id}`,
      status: 'cancelled',
    });
  }

  if (careCase?.patient_id) {
    const primaryResidence = await tx.residence.findFirst({
      where: {
        org_id: orgId,
        patient_id: careCase.patient_id,
        is_primary: true,
      },
      select: {
        facility_id: true,
      },
    });

    if (primaryResidence?.facility_id) {
      const facility = await tx.facility.findFirst({
        where: {
          org_id: orgId,
          id: primaryResidence.facility_id,
        },
        select: {
          acceptance_time_from: true,
          acceptance_time_to: true,
        },
      });

      if (facility?.acceptance_time_from || facility?.acceptance_time_to) {
        await tx.patientSchedulePreference.upsert({
          where: {
            patient_id: careCase.patient_id,
          },
          create: {
            org_id: orgId,
            patient_id: careCase.patient_id,
            facility_time_from: facility.acceptance_time_from,
            facility_time_to: facility.acceptance_time_to,
          },
          update: {
            facility_time_from: facility.acceptance_time_from,
            facility_time_to: facility.acceptance_time_to,
          },
        });
      }
    }
  }

  return {
    tasksCreated,
    medicationIssuesCreated,
  };
}

async function syncServiceManagerUsage(
  tx: TransactionClient,
  orgId: string,
  userId: string,
  note: PersistedConferenceNote,
  careCase: CareCaseSummary | null,
  sections: StructuredSection[]
): Promise<ConferenceDerivedSyncResult> {
  const medicationIssuesCreated = await upsertMedicationIssuesFromSection(tx, {
    orgId,
    userId,
    note,
    patientId: careCase?.patient_id ?? null,
    sectionKey: 'medication_related_items',
    lines: parseSectionLines(findSection(sections, 'medication_related_items')?.body),
  });

  let tasksCreated = 0;
  let visitProposalId: string | null = null;
  tasksCreated += await upsertConferenceLineTasks(tx, {
    orgId,
    note,
    sectionKey: 'agreed_actions',
    taskType: 'conference_action_item',
    titlePrefix: '担当者会議アクション',
    assignedTo: careCase?.primary_pharmacist_id ?? null,
    lines: parseSectionLines(findSection(sections, 'agreed_actions')?.body),
  });

  const serviceAdjustment = findSection(sections, 'service_adjustments')?.body?.trim();
  if (serviceAdjustment) {
    await upsertOperationalTask(tx, {
      orgId,
      taskType: 'conference_schedule_adjustment',
      title: '担当者会議に伴う定期訪問ルール見直し',
      description: serviceAdjustment,
      priority: 'normal',
      assignedTo: careCase?.primary_pharmacist_id ?? null,
      dedupeKey: `conference-service-adjustment:${note.id}`,
      relatedEntityType: 'conference_note',
      relatedEntityId: note.id,
      metadata: {
        case_id: note.case_id,
        patient_id: careCase?.patient_id ?? null,
        recommendation: serviceAdjustment,
      } satisfies Prisma.InputJsonValue,
    });
    tasksCreated++;

    if (note.case_id && careCase?.primary_pharmacist_id) {
      const latestSchedule = await tx.visitSchedule.findFirst({
        where: {
          org_id: orgId,
          case_id: note.case_id,
          schedule_status: {
            notIn: ['cancelled', 'rescheduled'],
          },
        },
        orderBy: [{ scheduled_date: 'desc' }, { created_at: 'desc' }],
        select: {
          id: true,
          cycle_id: true,
          site_id: true,
          visit_type: true,
          priority: true,
          scheduled_date: true,
          time_window_start: true,
          time_window_end: true,
          medication_end_date: true,
          visit_deadline_date: true,
          route_order: true,
          recurrence_rule: true,
        },
      });

      const suggestedRecurrenceRule = deriveRecurringVisitRule(
        serviceAdjustment,
        latestSchedule?.scheduled_date ?? note.conference_date,
        latestSchedule?.recurrence_rule ?? null
      );

      if (suggestedRecurrenceRule) {
        const dedupeKey = `conference-recurrence-proposal:${note.id}`;
        const proposedDate = new Date(note.conference_date);
        proposedDate.setUTCDate(proposedDate.getUTCDate() + 7);
        const proposedDateOnly = new Date(
          Date.UTC(
            proposedDate.getUTCFullYear(),
            proposedDate.getUTCMonth(),
            proposedDate.getUTCDate(),
            12,
            0,
            0,
            0
          )
        );

        const existingProposal = await tx.visitScheduleProposal.findFirst({
          where: {
            org_id: orgId,
            case_id: note.case_id,
            proposal_reason: dedupeKey,
          },
          select: {
            id: true,
          },
        });

        if (existingProposal) {
          const updatedProposal = await tx.visitScheduleProposal.update({
            where: {
              id: existingProposal.id,
            },
            data: {
              proposal_status: 'proposed',
              patient_contact_status: 'pending',
              proposed_date: proposedDateOnly,
              proposed_pharmacist_id: careCase.primary_pharmacist_id,
              time_window_start: latestSchedule?.time_window_start ?? null,
              time_window_end: latestSchedule?.time_window_end ?? null,
              suggested_recurrence_rule: suggestedRecurrenceRule,
              proposal_reason: dedupeKey,
              escalation_reason: serviceAdjustment,
            },
            select: {
              id: true,
            },
          });
          visitProposalId = updatedProposal.id;
        } else {
          const createdProposal = await tx.visitScheduleProposal.create({
            data: {
              org_id: orgId,
              case_id: note.case_id,
              cycle_id: latestSchedule?.cycle_id ?? null,
              site_id: latestSchedule?.site_id ?? null,
              visit_type: latestSchedule?.visit_type ?? 'regular',
              priority: latestSchedule?.priority ?? 'normal',
              proposal_status: 'proposed',
              patient_contact_status: 'pending',
              proposed_date: proposedDateOnly,
              time_window_start: latestSchedule?.time_window_start ?? null,
              time_window_end: latestSchedule?.time_window_end ?? null,
              proposed_pharmacist_id: careCase.primary_pharmacist_id,
              assignment_mode: 'primary',
              route_order: latestSchedule?.route_order ?? null,
              medication_end_date: latestSchedule?.medication_end_date ?? null,
              visit_deadline_date: latestSchedule?.visit_deadline_date ?? null,
              proposal_reason: dedupeKey,
              escalation_reason: serviceAdjustment,
              suggested_recurrence_rule: suggestedRecurrenceRule,
            },
            select: {
              id: true,
            },
          });
          visitProposalId = createdProposal.id;
        }
      }
    }
  } else {
    await resolveOperationalTasks(tx, {
      orgId,
      dedupeKey: `conference-service-adjustment:${note.id}`,
      status: 'cancelled',
    });
  }

  return {
    tasksCreated,
    medicationIssuesCreated,
    visitProposalId,
  };
}

async function syncDeathConferenceUsage(
  tx: TransactionClient,
  orgId: string,
  note: PersistedConferenceNote,
  careCase: CareCaseSummary | null,
  sections: StructuredSection[]
): Promise<ConferenceDerivedSyncResult> {
  let tasksCreated = 0;

  if (note.case_id) {
    await upsertOperationalTask(tx, {
      orgId,
      taskType: 'conference_case_status_review',
      title: 'デスカンファレンスに伴うケース終結確認',
      description: '看取り後のケース終結処理と関連運用の確認を行ってください。',
      priority: 'high',
      assignedTo: careCase?.primary_pharmacist_id ?? null,
      dedupeKey: `conference-case-termination:${note.id}`,
      relatedEntityType: 'case',
      relatedEntityId: note.case_id,
      metadata: {
        conference_note_id: note.id,
        patient_id: careCase?.patient_id ?? null,
      } satisfies Prisma.InputJsonValue,
    });
    tasksCreated++;
  } else {
    await resolveOperationalTasks(tx, {
      orgId,
      dedupeKey: `conference-case-termination:${note.id}`,
      status: 'cancelled',
    });
  }

  tasksCreated += await upsertConferenceLineTasks(tx, {
    orgId,
    note,
    sectionKey: 'improvement_actions',
    taskType: 'conference_quality_improvement',
    titlePrefix: '改善アクション',
    assignedTo: careCase?.primary_pharmacist_id ?? null,
    lines: parseSectionLines(findSection(sections, 'improvement_actions')?.body),
  });

  return {
    tasksCreated,
    medicationIssuesCreated: 0,
  };
}

async function syncConferenceDerivedData(
  tx: TransactionClient,
  orgId: string,
  userId: string,
  note: PersistedConferenceNote
): Promise<ConferenceDerivedSyncResult> {
  const sections = parseStructuredSections(note.structured_content);
  const careCase = await loadCareCaseSummary(tx, orgId, note.case_id);

  switch (note.note_type) {
    case 'pre_discharge':
      return syncPreDischargeUsage(tx, orgId, userId, note, careCase, sections);
    case 'service_manager':
      return syncServiceManagerUsage(tx, orgId, userId, note, careCase, sections);
    case 'death_conference':
      return syncDeathConferenceUsage(tx, orgId, note, careCase, sections);
    default:
      return {
        tasksCreated: 0,
        medicationIssuesCreated: 0,
        visitProposalId: null,
      };
  }
}

export class ConferenceDataSyncService {
  static async syncSavedNote(
    tx: TransactionClient,
    orgId: string,
    userId: string,
    note: PersistedConferenceNote,
    options?: {
      mode?: 'create' | 'update';
    }
  ): Promise<{
    note: PersistedConferenceNote;
    sync: ConferenceSyncResult;
  }> {
    const sync =
      options?.mode === 'update'
        ? await ConferenceSyncService.syncOnUpdate(tx, orgId, userId, note)
        : await ConferenceSyncService.syncOnCreate(tx, orgId, userId, note);
    const derived = await syncConferenceDerivedData(tx, orgId, userId, note);
    sync.tasks_created += derived.tasksCreated;
    sync.medication_issues_created += derived.medicationIssuesCreated;
    if (derived.visitProposalId) {
      sync.visit_proposal_id = derived.visitProposalId;
    }

    const nextMetadata = mergeConferenceSyncMetadata(note.metadata, sync);
    if (!metadataChanged(note.metadata, nextMetadata)) {
      return { note, sync };
    }

    const updated = await tx.conferenceNote.update({
      where: { id: note.id },
      data: {
        metadata: nextMetadata ?? Prisma.JsonNull,
      },
    });

    return {
      note: updated as PersistedConferenceNote,
      sync,
    };
  }
}
