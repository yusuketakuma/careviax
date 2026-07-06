import { RISK_DOMAIN_ORDER, type RiskDomain, type RiskFinding } from '@/lib/risk/risk-finding';
import { RISK_TASK_REGISTRY, getRiskTaskRegistryEntry } from '@/lib/tasks/task-registry';
import { readJsonObject } from '@/lib/db/json';
import type { MemberRole, Prisma } from '@prisma/client';
import {
  riskFindingToOperationalTaskInput,
  shouldCreateOperationalTaskForRisk,
  upsertOperationalTaskForRisk,
} from './risk-task-bridge';
import { getCaseRiskCockpit, type CaseRiskCockpitDb } from '@/server/services/case-risk-cockpit';

type RiskTaskSyncTx = Parameters<typeof upsertOperationalTaskForRisk>[0];
type RiskTaskCloseTx = RiskTaskSyncTx & {
  task: RiskTaskSyncTx['task'] & {
    findMany(args: unknown): Promise<OpenRiskTaskRow[]>;
  };
  residence?: {
    findFirst(args: unknown): Promise<ResidenceResolveRow | null>;
  };
  patientMcsLink?: {
    findFirst(args: unknown): Promise<PatientMcsLinkResolveRow | null>;
  };
};

type OpenRiskTaskRow = {
  id: string;
  display_id: string | null;
  task_type: string;
  dedupe_key: string | null;
  related_entity_type: string | null;
  related_entity_id: string | null;
  metadata: Prisma.JsonValue | null;
};

type ResidenceResolveRow = {
  lat: number | null;
  lng: number | null;
  geocode_status: string | null;
  geocode_accuracy: string | null;
};

type PatientMcsLinkResolveRow = {
  last_sync_status: string | null;
};

const MANAGED_RISK_TASK_TYPES = Object.values(RISK_TASK_REGISTRY).map((entry) => entry.task_type);
const RISK_TASK_METADATA_SCOPE = { path: ['source'], equals: 'risk_finding' } as const;
const COORDINATE_SAME_VALUE_TOLERANCE = 0.000001;

function caseRiskTaskOwnershipWhere(args: { orgId: string; caseId: string }) {
  return {
    org_id: args.orgId,
    status: { in: ['pending', 'in_progress'] },
    task_type: { in: MANAGED_RISK_TASK_TYPES },
    dedupe_key: { startsWith: 'risk:' },
    AND: [
      {
        metadata: {
          path: ['case_id'],
          equals: args.caseId,
        },
      },
      {
        metadata: RISK_TASK_METADATA_SCOPE,
      },
    ],
  };
}

export type RiskTaskSyncTaskRef = {
  id: string;
  display_id: string | null;
};

export type RiskFindingTaskSyncResult = {
  taskable_finding_count: number;
  skipped_finding_count: number;
  upserted_task_count: number;
  upserted_tasks: RiskTaskSyncTaskRef[];
  resolved_stale_task_count: number;
  resolved_stale_tasks: RiskTaskSyncTaskRef[];
};

export type CaseRiskTaskSyncResult = RiskFindingTaskSyncResult & {
  generated_at: string;
  case_id: string;
  patient_id: string;
  overall_status: string;
};

type SyncCaseRiskTaskArgs = {
  orgId: string;
  caseId: string;
  userId: string;
  role: MemberRole;
  now?: Date;
};

function toTaskRef(value: unknown): RiskTaskSyncTaskRef | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as { id?: unknown; display_id?: unknown };
  if (typeof row.id !== 'string') return null;
  return {
    id: row.id,
    display_id: typeof row.display_id === 'string' ? row.display_id : null,
  };
}

export function flattenCaseRiskFindings(
  sections: Array<{ findings: RiskFinding[] }>,
): RiskFinding[] {
  return sections.flatMap((section) => section.findings);
}

export async function syncOperationalTasksForRiskFindings(
  tx: RiskTaskCloseTx,
  args: {
    orgId: string;
    caseId?: string | null;
    findings: RiskFinding[];
    resolveStale?: boolean;
  },
): Promise<RiskFindingTaskSyncResult> {
  const taskableInputs = args.findings
    .filter(shouldCreateOperationalTaskForRisk)
    .map((finding) => ({
      finding,
      taskInput: riskFindingToOperationalTaskInput({ orgId: args.orgId, finding }),
    }))
    .filter(
      (
        entry,
      ): entry is {
        finding: RiskFinding;
        taskInput: NonNullable<ReturnType<typeof riskFindingToOperationalTaskInput>>;
      } => Boolean(entry.taskInput),
    );
  const upsertedTasks: RiskTaskSyncTaskRef[] = [];

  for (const { finding } of taskableInputs) {
    const task = await upsertOperationalTaskForRisk(tx, {
      orgId: args.orgId,
      finding,
    });
    const ref = toTaskRef(task);
    if (ref) upsertedTasks.push(ref);
  }

  const stale = args.resolveStale
    ? await resolveStaleOperationalTasksForCaseRisk(tx, {
        orgId: args.orgId,
        caseId: args.caseId,
        activeDedupeKeys: new Set(
          taskableInputs
            .map(({ taskInput }) => taskInput.dedupeKey)
            .filter((key): key is string => Boolean(key)),
        ),
      })
    : { resolved_stale_task_count: 0, resolved_stale_tasks: [] };

  return {
    taskable_finding_count: taskableInputs.length,
    skipped_finding_count: args.findings.length - taskableInputs.length,
    upserted_task_count: upsertedTasks.length,
    upserted_tasks: upsertedTasks,
    ...stale,
  };
}

export async function syncCaseRiskCockpitOperationalTasks(
  tx: CaseRiskCockpitDb & RiskTaskCloseTx,
  args: SyncCaseRiskTaskArgs,
): Promise<CaseRiskTaskSyncResult | null> {
  const cockpit = await getCaseRiskCockpit(tx, args);
  if (!cockpit) return null;

  const sync = await syncOperationalTasksForRiskFindings(tx, {
    orgId: args.orgId,
    caseId: cockpit.case.id,
    findings: flattenCaseRiskFindings(cockpit.sections),
    resolveStale: true,
  });

  return {
    generated_at: cockpit.generated_at,
    case_id: cockpit.case.id,
    patient_id: cockpit.patient.id,
    overall_status: cockpit.overall.status,
    ...sync,
  };
}

export async function resolveStaleOperationalTasksForCaseRisk(
  tx: RiskTaskCloseTx,
  args: {
    orgId: string;
    caseId?: string | null;
    activeDedupeKeys: ReadonlySet<string>;
  },
) {
  if (!args.caseId) {
    return { resolved_stale_task_count: 0, resolved_stale_tasks: [] as RiskTaskSyncTaskRef[] };
  }

  const openRiskTasks = await tx.task.findMany({
    where: caseRiskTaskOwnershipWhere({ orgId: args.orgId, caseId: args.caseId }),
    orderBy: [{ updated_at: 'desc' }, { id: 'desc' }],
    take: 200,
    select: {
      id: true,
      display_id: true,
      task_type: true,
      dedupe_key: true,
      related_entity_type: true,
      related_entity_id: true,
      metadata: true,
    },
  });

  const staleTasks: OpenRiskTaskRow[] = [];
  for (const task of openRiskTasks) {
    if (
      await canResolveStaleRiskTaskByRegistry(tx, task, args.activeDedupeKeys, {
        orgId: args.orgId,
      })
    ) {
      staleTasks.push(task);
    }
  }
  if (staleTasks.length === 0) {
    return { resolved_stale_task_count: 0, resolved_stale_tasks: [] as RiskTaskSyncTaskRef[] };
  }

  const resolvedTasks: RiskTaskSyncTaskRef[] = [];
  for (const task of staleTasks) {
    if (!task.dedupe_key) continue;
    const result = await tx.task.updateMany({
      where: {
        ...caseRiskTaskOwnershipWhere({ orgId: args.orgId, caseId: args.caseId }),
        id: task.id,
        dedupe_key: task.dedupe_key,
      },
      data: {
        status: 'completed',
        completed_at: new Date(),
      },
    });
    if (
      typeof result === 'object' &&
      result !== null &&
      'count' in result &&
      typeof result.count === 'number' &&
      result.count > 0
    ) {
      resolvedTasks.push({
        id: task.id,
        display_id: task.display_id,
      });
    }
  }

  return {
    resolved_stale_task_count: resolvedTasks.length,
    resolved_stale_tasks: resolvedTasks,
  };
}

export async function canResolveStaleRiskTaskByRegistry(
  tx: Pick<RiskTaskCloseTx, 'residence' | 'patientMcsLink'>,
  task: OpenRiskTaskRow,
  activeDedupeKeys: ReadonlySet<string>,
  options: { orgId?: string } = {},
) {
  if (!task.dedupe_key?.startsWith('risk:')) return false;
  if (activeDedupeKeys.has(task.dedupe_key)) return false;

  const metadata = readJsonObject(task.metadata);
  if (!metadata || metadata.source !== 'risk_finding') return false;

  const domain = readRiskDomain(metadata.risk_domain);
  if (!domain) return false;

  const entry = getRiskTaskRegistryEntry(domain);
  if (entry.task_type !== task.task_type) return false;
  if (entry.resolve_condition.strategy !== 'active_finding_absent') return false;

  if (!readNonBlankString(metadata.risk_key)) return false;
  if (!readNonBlankString(metadata.case_id)) return false;

  if (!entry.resolve_condition.requires_related_entity) return true;

  const metadataEntityType = readNonBlankString(metadata.related_entity_type);
  const metadataEntityId = readNonBlankString(metadata.related_entity_id);
  if (!metadataEntityType || !metadataEntityId) return false;
  if (!task.related_entity_type || !task.related_entity_id) return false;
  if (metadataEntityType !== task.related_entity_type) return false;
  if (metadataEntityId !== task.related_entity_id) return false;

  return await canResolveByDomainPredicate(tx, {
    predicate: entry.resolve_condition.predicate,
    task,
    metadata,
    orgId: options.orgId,
  });
}

async function canResolveByDomainPredicate(
  tx: Pick<RiskTaskCloseTx, 'residence' | 'patientMcsLink'>,
  args: {
    predicate: ReturnType<typeof getRiskTaskRegistryEntry>['resolve_condition']['predicate'];
    task: OpenRiskTaskRow;
    metadata: Record<string, unknown>;
    orgId?: string;
  },
) {
  if (!args.predicate) return true;
  if (!args.orgId || !args.task.related_entity_id) return false;

  const patientId = readNonBlankString(args.metadata.patient_id);

  if (args.predicate === 'patient_mcs_sync_success') {
    if (!tx.patientMcsLink || args.task.related_entity_type !== 'patient_mcs_link') return false;
    const link = await tx.patientMcsLink.findFirst({
      where: {
        org_id: args.orgId,
        id: args.task.related_entity_id,
        ...(patientId ? { patient_id: patientId } : {}),
      },
      select: {
        last_sync_status: true,
      },
    });
    return link?.last_sync_status === 'success';
  }

  if (args.predicate === 'residence_geocode_valid') {
    if (!tx.residence || args.task.related_entity_type !== 'residence') return false;
    const residence = await tx.residence.findFirst({
      where: {
        org_id: args.orgId,
        id: args.task.related_entity_id,
        ...(patientId ? { patient_id: patientId } : {}),
      },
      select: {
        lat: true,
        lng: true,
        geocode_status: true,
        geocode_accuracy: true,
      },
    });
    return Boolean(residence && isResidenceGeocodeResolved(residence));
  }

  return false;
}

function isResidenceGeocodeResolved(residence: ResidenceResolveRow) {
  const lat = residence.lat;
  const lng = residence.lng;
  if (lat == null || lng == null) return false;
  if (lat === 0 && lng === 0) return false;
  if (Math.abs(lat - lng) <= COORDINATE_SAME_VALUE_TOLERANCE) return false;
  if (residence.geocode_status === 'failed' || residence.geocode_status === 'review_required') {
    return false;
  }
  if (residence.geocode_accuracy === 'low') return false;
  return true;
}

function readRiskDomain(value: unknown): RiskDomain | null {
  return typeof value === 'string' && RISK_DOMAIN_ORDER.includes(value as RiskDomain)
    ? (value as RiskDomain)
    : null;
}

function readNonBlankString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}
