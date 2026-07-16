import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { readJsonObject } from '@/lib/db/json';
import { withOrgContext } from '@/lib/db/rls';
import { addUtcDays, japanDateKey, utcDateFromLocalKey } from '@/lib/utils/date-boundary';
import { upsertOperationalTask } from '@/server/services/operational-tasks';

export { formatDateKey } from '@/lib/date-key';

export type GeneratedTaskSpec = {
  orgId: string;
  taskType: string;
  dedupeKey: string;
  title: string;
  description: string;
  priority: 'urgent' | 'high' | 'normal' | 'low';
  assignedTo?: string | null;
  dueDate?: Date | null;
  slaDueAt?: Date | null;
  relatedEntityType?: string | null;
  relatedEntityId?: string | null;
  metadata?: Prisma.InputJsonValue | null;
};

/** Returns the UTC-midnight sentinel for the Japan business date containing `value`. */
export function startOfDay(value = new Date()) {
  return utcDateFromLocalKey(japanDateKey(value));
}

/** Preserves the legacy runtime-local midnight used only by explicitly local SLA timestamps. */
export function startOfRuntimeDay(value = new Date()) {
  const next = new Date(value);
  next.setHours(0, 0, 0, 0);
  return next;
}

export function addJapanCalendarDays(value: Date, days: number) {
  return addUtcDays(startOfDay(value), days);
}

export function addJapanCalendarYears(value: Date, years: number) {
  if (!Number.isInteger(years)) {
    throw new RangeError('Calendar years must be an integer');
  }

  const date = startOfDay(value);
  const targetYear = date.getUTCFullYear() + years;
  const monthIndex = date.getUTCMonth();
  const lastDayOfTargetMonth = new Date(Date.UTC(targetYear, monthIndex + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(targetYear, monthIndex, Math.min(date.getUTCDate(), lastDayOfTargetMonth)),
  );
}

export function parseConferenceSections(structuredContent: Prisma.JsonValue | null) {
  const sections = readJsonObject(structuredContent)?.sections;
  if (!Array.isArray(sections)) return [];
  return sections.flatMap((section): Array<{ key: string; body?: string }> => {
    const record = readJsonObject(section);
    if (!record || typeof record.key !== 'string') return [];
    if (record.body !== undefined && typeof record.body !== 'string') return [];
    return [{ key: record.key, body: typeof record.body === 'string' ? record.body : undefined }];
  });
}

export function parseDateFromConferenceText(body?: string) {
  if (!body?.trim()) return null;

  const match = body.match(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  if (match) {
    const [, year, month, day] = match;
    const expectedYear = Number(year);
    const expectedMonthIndex = Number(month) - 1;
    const expectedDay = Number(day);
    const parsed = new Date(Date.UTC(expectedYear, expectedMonthIndex, expectedDay));
    if (
      parsed.getUTCFullYear() !== expectedYear ||
      parsed.getUTCMonth() !== expectedMonthIndex ||
      parsed.getUTCDate() !== expectedDay
    ) {
      return null;
    }
    return parsed;
  }

  const parsed = new Date(body.trim());
  if (Number.isNaN(parsed.getTime())) return null;
  return startOfDay(parsed);
}

export function hasAnyKeyword(
  values: Array<string | null | undefined>,
  keywords: readonly string[],
) {
  const text = values
    .filter((value): value is string => Boolean(value))
    .join(' ')
    .toLowerCase();
  return keywords.some((keyword) => text.includes(keyword.toLowerCase()));
}

export function buildVisitDemandTaskKey(cycleId: string) {
  return `visit-demand:${cycleId}`;
}

export function buildGeocodeTaskKey(patientId: string) {
  return `geocode-review:${patientId}`;
}

export function buildPreparationTaskKey(scheduleId: string) {
  return `visit-preparation:${scheduleId}`;
}

export function buildIntakeLinkageTaskKey(intakeId: string) {
  return `visit-intake-linkage:${intakeId}`;
}

export function buildSelfReportTaskKey(reportId: string) {
  return `patient-self-report:${reportId}`;
}

export function buildCommunityFollowupTaskKey(activityId: string) {
  return `community-activity-followup:${activityId}`;
}

export function buildReportDeliveryTaskKey(reportId: string) {
  return `report-delivery-followup:${reportId}`;
}

export function buildCarryItemReviewTaskKey(scheduleId: string) {
  return `visit-carry-item-review:${scheduleId}`;
}

export function buildEmergencyCoverageGapTaskKey(dateKey: string, siteId: string | null) {
  return `emergency-coverage-gap:${dateKey}:${siteId ?? 'org'}`;
}

export function buildEmergencyContactReviewTaskKey(caseId: string) {
  return `emergency-contact-review:${caseId}`;
}

export function buildPatientFoundationReviewTaskKey(patientId: string) {
  return `patient-foundation-review:${patientId}`;
}

export function buildDosageSupportTaskKey(reportId: string) {
  return `dosage-support:${reportId}`;
}

export function buildInquiryWorkbenchTaskKey(inquiryId: string) {
  return `inquiry-workbench:${inquiryId}`;
}

export function buildFacilityBatchTrackerTaskKey(groupId: string) {
  return `facility-batch-tracker:${groupId}`;
}

export function buildMobileVisitModeTaskKey(scheduleId: string) {
  return `mobile-visit-mode:${scheduleId}`;
}

export function buildVisitRecordRetentionTaskKey(recordId: string) {
  return `visit-record-retention:${recordId}`;
}

export function buildPrescriptionOriginalRetentionTaskKey(intakeId: string) {
  return `prescription-original-retention:${intakeId}`;
}

export function buildFaxOriginalFollowupTaskKey(intakeId: string) {
  return `fax-original-followup:${intakeId}`;
}

export function buildInitialAssessmentTaskKey(scheduleId: string) {
  return `initial-home-visit-assessment:${scheduleId}`;
}

export function buildFacilityStandardExpiryTaskKey(registrationId: string) {
  return `facility-standard-expiry:${registrationId}`;
}

export function buildConsentExpiryTaskKey(consentId: string) {
  return `consent-expiry:${consentId}`;
}

export function buildPublicSubsidyExpiryTaskKey(insuranceId: string) {
  return `public-subsidy-expiry:${insuranceId}`;
}

export function buildPcaPumpRentalOverdueTaskKey(rentalId: string) {
  return `pca-pump-rental-overdue:${rentalId}`;
}

export function buildPcaPumpReturnInspectionPendingTaskKey(rentalId: string) {
  return `pca-pump-return-inspection-pending:${rentalId}`;
}

const GENERATED_TASK_SYNC_CHUNK_SIZE = 100;

function chunkValues<T>(values: T[], size = GENERATED_TASK_SYNC_CHUNK_SIZE) {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

export async function syncGeneratedOperationalTasks(
  taskSpecs: GeneratedTaskSpec[],
  managedTaskTypes: string[],
  options: { scopeOrgIds?: string[] } = {},
) {
  const taskTypes = Array.from(new Set(managedTaskTypes));
  const scopeOrgIds = Array.from(new Set(options.scopeOrgIds?.filter(Boolean) ?? []));
  const listExistingTasks = (orgId?: string) =>
    prisma.task.findMany({
      where: {
        task_type: { in: taskTypes },
        status: { in: ['pending', 'in_progress'] },
        ...(orgId ? { org_id: orgId } : {}),
      },
      select: {
        org_id: true,
        task_type: true,
        dedupe_key: true,
      },
    });
  const existingTasks =
    taskTypes.length === 0
      ? []
      : scopeOrgIds.length > 0
        ? (
            await Promise.all(
              scopeOrgIds.map((orgId) =>
                withOrgContext(orgId, (tx) =>
                  tx.task.findMany({
                    where: {
                      task_type: { in: taskTypes },
                      status: { in: ['pending', 'in_progress'] },
                      org_id: orgId,
                    },
                    select: {
                      org_id: true,
                      task_type: true,
                      dedupe_key: true,
                    },
                  }),
                ),
              ),
            )
          ).flat()
        : await listExistingTasks();

  const specsByOrg = new Map<string, GeneratedTaskSpec[]>();
  const activeByBucket = new Map<string, Set<string>>();

  for (const spec of taskSpecs) {
    const orgSpecs = specsByOrg.get(spec.orgId) ?? [];
    orgSpecs.push(spec);
    specsByOrg.set(spec.orgId, orgSpecs);

    const bucketKey = `${spec.orgId}:${spec.taskType}`;
    const activeKeys = activeByBucket.get(bucketKey) ?? new Set<string>();
    activeKeys.add(spec.dedupeKey);
    activeByBucket.set(bucketKey, activeKeys);
  }

  for (const [orgId, specs] of specsByOrg) {
    for (const chunk of chunkValues(specs)) {
      await withOrgContext(orgId, async (tx) => {
        for (const spec of chunk) {
          await upsertOperationalTask(tx, {
            orgId: spec.orgId,
            taskType: spec.taskType,
            title: spec.title,
            description: spec.description,
            priority: spec.priority,
            assignedTo: spec.assignedTo ?? null,
            dueDate: spec.dueDate ?? null,
            slaDueAt: spec.slaDueAt ?? null,
            relatedEntityType: spec.relatedEntityType ?? null,
            relatedEntityId: spec.relatedEntityId ?? null,
            dedupeKey: spec.dedupeKey,
            metadata: spec.metadata ?? null,
          });
        }
      });
    }
  }

  const staleKeysByOrg = new Map<string, Map<string, string[]>>();
  for (const task of existingTasks) {
    if (!task.dedupe_key) continue;
    const bucketKey = `${task.org_id}:${task.task_type}`;
    const activeKeys = activeByBucket.get(bucketKey);
    if (activeKeys?.has(task.dedupe_key)) continue;

    const orgBuckets = staleKeysByOrg.get(task.org_id) ?? new Map<string, string[]>();
    const staleKeys = orgBuckets.get(task.task_type) ?? [];
    staleKeys.push(task.dedupe_key);
    orgBuckets.set(task.task_type, staleKeys);
    staleKeysByOrg.set(task.org_id, orgBuckets);
  }

  for (const [orgId, bucketMap] of staleKeysByOrg) {
    await withOrgContext(orgId, async (tx) => {
      for (const [taskType, dedupeKeys] of bucketMap) {
        for (const chunk of chunkValues(dedupeKeys)) {
          await tx.task.updateMany({
            where: {
              org_id: orgId,
              task_type: taskType,
              status: { in: ['pending', 'in_progress'] },
              dedupe_key: { in: chunk },
            },
            data: {
              status: 'completed',
              completed_at: new Date(),
            },
          });
        }
      }
    });
  }
}
