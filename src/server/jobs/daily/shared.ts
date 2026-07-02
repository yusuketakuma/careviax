import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/client';

export const DOSAGE_SUPPORT_KEYWORDS = [
  '飲みにく',
  '飲めない',
  'むせ',
  '嚥下',
  '粉砕',
  '一包化',
  '剤形',
  '貼付',
  '服用しづら',
] as const;

export type JobExecutionContext = {
  orgId?: string;
};

export type DailyOperationResult = {
  processedCount: number;
  errors?: string[];
};

export const SAFE_DAILY_OPERATION_ERROR_MESSAGE = '日次ジョブの一部処理に失敗しました';

export function getSafeDailyOperationErrorMessage() {
  return SAFE_DAILY_OPERATION_ERROR_MESSAGE;
}

export async function createManyNotifications(data: Prisma.NotificationCreateManyInput[]) {
  if (data.length === 0) return { count: 0 };

  return prisma.notification.createMany({
    data,
    skipDuplicates: true,
  });
}

export async function findAdminUserIdsByOrg(orgIds: Iterable<string>) {
  const uniqueOrgIds = [...new Set([...orgIds].filter(Boolean))];
  if (uniqueOrgIds.length === 0) return new Map<string, string[]>();

  const memberships = await prisma.membership.findMany({
    where: { org_id: { in: uniqueOrgIds }, role: { in: ['admin', 'owner'] }, is_active: true },
    select: { org_id: true, user_id: true },
  });
  const adminIdsByOrg = new Map<string, string[]>();
  for (const membership of memberships) {
    const list = adminIdsByOrg.get(membership.org_id) ?? [];
    list.push(membership.user_id);
    adminIdsByOrg.set(membership.org_id, list);
  }

  return adminIdsByOrg;
}

export function orgPatientKey(orgId: string, patientId: string) {
  return JSON.stringify([orgId, patientId]);
}

export async function findPrimaryPharmacistIdsForActiveCases(args: {
  caseIds?: Iterable<string | null | undefined>;
  orgPatientPairs?: Iterable<{ orgId: string; patientId: string }>;
}) {
  const caseIds = [...new Set([...(args.caseIds ?? [])].filter((id): id is string => Boolean(id)))];
  const orgPatientPairs = [
    ...new Map(
      [...(args.orgPatientPairs ?? [])]
        .filter((pair) => pair.orgId && pair.patientId)
        .map((pair) => [orgPatientKey(pair.orgId, pair.patientId), pair]),
    ).values(),
  ];

  if (caseIds.length === 0 && orgPatientPairs.length === 0) {
    return {
      byCaseId: new Map<string, string | null>(),
      byOrgPatient: new Map<string, string | null>(),
    };
  }

  const patientIdsByOrg = new Map<string, string[]>();
  for (const pair of orgPatientPairs) {
    const patientIds = patientIdsByOrg.get(pair.orgId) ?? [];
    patientIds.push(pair.patientId);
    patientIdsByOrg.set(pair.orgId, patientIds);
  }
  const cases = await prisma.careCase.findMany({
    where: {
      status: { notIn: ['discharged', 'terminated'] },
      OR: [
        ...(caseIds.length > 0 ? [{ id: { in: caseIds } }] : []),
        ...[...patientIdsByOrg.entries()].map(([orgId, patientIds]) => ({
          org_id: orgId,
          patient_id: { in: patientIds },
        })),
      ],
    },
    select: {
      id: true,
      org_id: true,
      patient_id: true,
      primary_pharmacist_id: true,
    },
  });

  const byCaseId = new Map<string, string | null>();
  const byOrgPatient = new Map<string, string | null>();
  for (const careCase of cases) {
    byCaseId.set(careCase.id, careCase.primary_pharmacist_id);
    const key = orgPatientKey(careCase.org_id, careCase.patient_id);
    if (!byOrgPatient.has(key)) {
      byOrgPatient.set(key, careCase.primary_pharmacist_id);
    }
  }

  return { byCaseId, byOrgPatient };
}

export type DailyOperationTask = () => Promise<DailyOperationResult>;

export const DEFAULT_DAILY_OPERATION_CONCURRENCY = 4;
export const MAX_DAILY_OPERATION_CONCURRENCY = 8;

export function resolveDailyOperationConcurrency(value: string | undefined) {
  const parsed = Number(value ?? DEFAULT_DAILY_OPERATION_CONCURRENCY);
  if (!Number.isFinite(parsed)) return DEFAULT_DAILY_OPERATION_CONCURRENCY;
  const normalized = Math.trunc(parsed);
  if (!Number.isSafeInteger(normalized) || normalized <= 0) {
    return DEFAULT_DAILY_OPERATION_CONCURRENCY;
  }
  return Math.min(normalized, MAX_DAILY_OPERATION_CONCURRENCY);
}

export async function runDailyOperationTasks(
  tasks: readonly DailyOperationTask[],
  concurrency = DEFAULT_DAILY_OPERATION_CONCURRENCY,
): Promise<PromiseSettledResult<DailyOperationResult>[]> {
  if (tasks.length === 0) return [];

  const workerCount = Math.min(
    tasks.length,
    Math.max(1, Math.trunc(concurrency) || DEFAULT_DAILY_OPERATION_CONCURRENCY),
  );
  const settled = new Array<PromiseSettledResult<DailyOperationResult>>(tasks.length);
  let nextIndex = 0;

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < tasks.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        const task = tasks[currentIndex]!;
        try {
          settled[currentIndex] = { status: 'fulfilled', value: await task() };
        } catch (reason) {
          settled[currentIndex] = { status: 'rejected', reason };
        }
      }
    }),
  );

  return settled;
}
