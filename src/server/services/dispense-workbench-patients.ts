import { createHmac, timingSafeEqual } from 'node:crypto';
import type { MedicationCycleStatus, Prisma, PrismaClient } from '@prisma/client';
import { formatUtcDateKey } from '@/lib/date-key';
import {
  classifySetBatchPhase,
  deriveListBadge,
  PHASE_CYCLE_STATUSES,
  REPRESENTATIVE_DISPENSE_TASK_STATUSES,
  selectRepresentativeDispenseTask,
  type DispenseWorkbenchPatientRow,
  type DispenseWorkbenchPatientsCountBasis,
  type DispenseWorkbenchPatientsResponse,
  type DispenseWorkbenchPhase,
  type SetBatchPhaseCounts,
} from '@/lib/dispensing/dispense-workbench-shared';
import {
  buildMedicationCycleAssignmentWhere,
  buildSetPlanAssignmentWhere,
  type PrescriptionAccessContext,
} from '@/server/services/prescription-access';
import { japanDateKey } from '@/lib/utils/date-boundary';

/**
 * 調剤ワークベンチ左ペインの患者中心リスト(計画 §11-2 共通行 / §11-3-1)。
 *
 * `/api/dispense-queue` が DispenseTask(pending/in_progress) 中心なのに対し、本サービスは
 * MedicationCycle を起点に intake_received〜reported 全域を対象とし、患者ごとに「最新サイクル」を
 * 1件選ぶ。状態バッジ3値は overall_status(16値)を `deriveListBadge` で畳み込む。
 *
 * 服用開始日 = CareCase.start_date を優先し、無ければ当該サイクルの最古の処方行 start_date。
 * 登録日 = Patient.created_at。要配慮個人情報は氏名・カナのみに最小化する。
 */

export type DispenseWorkbenchPatientsSort = 'start_date' | 'registered_date' | 'name_kana';

export type DispenseWorkbenchPatientsFilters = {
  sort?: DispenseWorkbenchPatientsSort;
  order?: 'asc' | 'desc';
  includeSetPlan?: boolean;
  /** 工程フィルタ。指定時は「患者ごとの最新サイクルを分類した後」に適用する。 */
  phase?: DispenseWorkbenchPhase;
  q?: string;
  limit?: number;
  cursor?: string;
  cursorSecret: string;
  now?: Date;
};

export const DEFAULT_DISPENSE_WORKBENCH_PATIENT_LIMIT = 50;
export const MAX_DISPENSE_WORKBENCH_PATIENT_LIMIT = 100;

const DISPENSE_WORKBENCH_CURSOR_TTL_MS = 10 * 60 * 1000;
const DISPENSE_WORKBENCH_CURSOR_RESOURCE = 'dispense-workbench-patients';

const DISPENSE_WORKBENCH_COUNT_BASIS: DispenseWorkbenchPatientsCountBasis = {
  rows: 'authorized_latest_cycle_per_patient',
  total_count: 'authorized_phase_search_exact',
  phase_counts: 'authorized_phase_search_exact',
  set_split: 'latest_set_plan_set_batch_exact',
};

type DispenseWorkbenchCursorPayload = {
  v: 1;
  resource: typeof DISPENSE_WORKBENCH_CURSOR_RESOURCE;
  limit: number;
  fh: string;
  sh: string;
  marker: string;
  iat_ms: number;
};

type CursorFailureReason = 'malformed' | 'mismatch' | 'expired' | 'stale';

export class DispenseWorkbenchPatientsCursorError extends Error {
  constructor(readonly reason: CursorFailureReason) {
    super(`Invalid dispense workbench patients cursor: ${reason}`);
    this.name = 'DispenseWorkbenchPatientsCursorError';
  }
}

type CycleCandidate = {
  id: string;
  patient_id: string;
  overall_status: MedicationCycleStatus | string;
  created_at: Date;
  case_: {
    start_date: Date | null;
    patient: {
      id: string;
      name: string;
      name_kana: string;
      created_at: Date;
    };
  };
  prescription_intakes: Array<{
    lines: Array<{
      start_date: Date | null;
    }>;
  }>;
};

function formatDate(value: Date | null | undefined): string | null {
  return value ? formatUtcDateKey(value) : null;
}

function encodeBase64UrlJson(value: unknown) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function signPart(part: string, secret: string) {
  return createHmac('sha256', secret).update(part).digest('base64url');
}

function hmacJson(value: unknown, secret: string) {
  return createHmac('sha256', secret).update(stableStringify(value)).digest('base64url');
}

function safeEqualSignature(left: string, right: string) {
  const leftBuffer = Buffer.from(left, 'base64url');
  const rightBuffer = Buffer.from(right, 'base64url');
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`;
}

function readCursorPayload(value: unknown): DispenseWorkbenchCursorPayload | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (record.v !== 1) return null;
  if (record.resource !== DISPENSE_WORKBENCH_CURSOR_RESOURCE) return null;
  if (!Number.isSafeInteger(record.limit) || (record.limit as number) < 1) return null;
  if (typeof record.fh !== 'string' || record.fh.length === 0) return null;
  if (typeof record.sh !== 'string' || record.sh.length === 0) return null;
  if (typeof record.marker !== 'string' || record.marker.length === 0) return null;
  if (!Number.isSafeInteger(record.iat_ms) || (record.iat_ms as number) < 0) return null;
  return {
    v: 1,
    resource: DISPENSE_WORKBENCH_CURSOR_RESOURCE,
    limit: record.limit as number,
    fh: record.fh,
    sh: record.sh,
    marker: record.marker,
    iat_ms: record.iat_ms as number,
  };
}

function buildFilterHash(args: {
  orgId: string;
  phase: DispenseWorkbenchPhase | undefined;
  q: string | undefined;
  sort: DispenseWorkbenchPatientsSort;
  order: 'asc' | 'desc';
  includeSetPlan: boolean;
  limit: number;
  secret: string;
}) {
  return hmacJson(
    {
      resource: DISPENSE_WORKBENCH_CURSOR_RESOURCE,
      org_id: args.orgId,
      phase: args.phase ?? null,
      q: args.q?.trim() || null,
      sort: args.sort,
      order: args.order,
      include_set_plan: args.includeSetPlan,
      limit: args.limit,
    },
    args.secret,
  );
}

function buildScopeHash(args: {
  orgId: string;
  ctx: PrescriptionAccessContext;
  assignmentWhere: Prisma.MedicationCycleWhereInput | null;
  secret: string;
}) {
  return hmacJson(
    {
      resource: DISPENSE_WORKBENCH_CURSOR_RESOURCE,
      org_id: args.orgId,
      user_id: args.ctx.userId,
      role: args.ctx.role,
      assignment_where: args.assignmentWhere ?? null,
    },
    args.secret,
  );
}

function buildRowMarker(args: {
  row: DispenseWorkbenchPatientRow;
  filterHash: string;
  scopeHash: string;
  secret: string;
}) {
  return hmacJson(
    {
      resource: DISPENSE_WORKBENCH_CURSOR_RESOURCE,
      fh: args.filterHash,
      sh: args.scopeHash,
      patient_id: args.row.patient_id,
      cycle_id: args.row.cycle_id,
    },
    args.secret,
  );
}

function encodeCursor(args: {
  row: DispenseWorkbenchPatientRow;
  limit: number;
  filterHash: string;
  scopeHash: string;
  now: Date;
  secret: string;
}) {
  const payloadPart = encodeBase64UrlJson({
    v: 1,
    resource: DISPENSE_WORKBENCH_CURSOR_RESOURCE,
    limit: args.limit,
    fh: args.filterHash,
    sh: args.scopeHash,
    marker: buildRowMarker(args),
    iat_ms: args.now.getTime(),
  } satisfies DispenseWorkbenchCursorPayload);
  return `${payloadPart}.${signPart(payloadPart, args.secret)}`;
}

function decodeCursor(args: {
  cursor: string | undefined;
  limit: number;
  filterHash: string;
  scopeHash: string;
  now: Date;
  secret: string;
}): { marker: string | null } {
  if (!args.cursor) return { marker: null };
  const [payloadPart, signature, ...extra] = args.cursor.split('.');
  if (!payloadPart || !signature || extra.length > 0) {
    throw new DispenseWorkbenchPatientsCursorError('malformed');
  }
  const expectedSignature = signPart(payloadPart, args.secret);
  if (!safeEqualSignature(signature, expectedSignature)) {
    throw new DispenseWorkbenchPatientsCursorError('malformed');
  }
  let payload: DispenseWorkbenchCursorPayload | null = null;
  try {
    payload = readCursorPayload(JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8')));
  } catch {
    throw new DispenseWorkbenchPatientsCursorError('malformed');
  }
  if (!payload) throw new DispenseWorkbenchPatientsCursorError('malformed');
  if (args.now.getTime() - payload.iat_ms > DISPENSE_WORKBENCH_CURSOR_TTL_MS) {
    throw new DispenseWorkbenchPatientsCursorError('expired');
  }
  if (
    payload.limit !== args.limit ||
    payload.fh !== args.filterHash ||
    payload.sh !== args.scopeHash
  ) {
    throw new DispenseWorkbenchPatientsCursorError('mismatch');
  }
  return { marker: payload.marker };
}

export function dispenseWorkbenchCursorValidationMessage(reason: CursorFailureReason) {
  if (reason === 'expired') return 'cursor の有効期限が切れています。先頭から再取得してください';
  if (reason === 'mismatch') return '検索条件が変わったため先頭から再取得してください';
  if (reason === 'stale') return '一覧が更新されたため先頭から再取得してください';
  return 'cursor が無効です';
}

function normalizeQuery(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function buildSearchWhere(q: string | undefined): Prisma.MedicationCycleWhereInput | null {
  if (!q) return null;
  const contains = { contains: q, mode: 'insensitive' as const };
  return {
    case_: {
      is: {
        patient: {
          is: {
            OR: [{ name: contains }, { name_kana: contains }],
          },
        },
      },
    },
  };
}

function buildMedicationCycleWhere(args: {
  orgId: string;
  assignmentWhere: Prisma.MedicationCycleWhereInput | null;
  q: string | undefined;
}) {
  const andConditions = [args.assignmentWhere, buildSearchWhere(args.q)].filter(
    (condition): condition is Prisma.MedicationCycleWhereInput => Boolean(condition),
  );
  return {
    org_id: args.orgId,
    overall_status: { notIn: ['cancelled'] },
    ...(andConditions.length > 0 ? { AND: andConditions } : {}),
  } satisfies Prisma.MedicationCycleWhereInput;
}

function rowFromCandidate(candidate: CycleCandidate): DispenseWorkbenchPatientRow {
  const patient = candidate.case_.patient;
  const earliestLineStart = candidate.prescription_intakes
    .flatMap((intake) => intake.lines.map((line) => line.start_date))
    .filter((value): value is Date => value != null)
    .sort((left, right) => left.getTime() - right.getTime())[0];
  const startDate = candidate.case_.start_date ?? earliestLineStart ?? null;

  return {
    patient_id: patient.id,
    cycle_id: candidate.id,
    name: patient.name,
    name_kana: patient.name_kana,
    overall_status: candidate.overall_status,
    badge: deriveListBadge(candidate.overall_status),
    start_date: formatDate(startDate),
    registered_date: japanDateKey(patient.created_at),
    latest_set_plan_id: null,
    latest_set_plan_cycle_id: null,
    representative_task_id: null,
    representative_task_status: null,
  };
}

function latestRowsPerPatient(cycles: CycleCandidate[]) {
  const seenPatients = new Set<string>();
  const rows: DispenseWorkbenchPatientRow[] = [];
  for (const cycle of cycles) {
    if (seenPatients.has(cycle.patient_id)) continue;
    seenPatients.add(cycle.patient_id);
    rows.push(rowFromCandidate(cycle));
  }
  return rows;
}

export async function listDispenseWorkbenchPatients(
  prisma: PrismaClient,
  orgId: string,
  ctx: PrescriptionAccessContext,
  filters: DispenseWorkbenchPatientsFilters,
): Promise<DispenseWorkbenchPatientsResponse> {
  const now = filters.now ?? new Date();
  const q = normalizeQuery(filters.q);
  const sort = filters.sort ?? 'name_kana';
  const order = filters.order ?? (sort === 'name_kana' ? 'asc' : 'desc');
  const limit = filters.limit ?? DEFAULT_DISPENSE_WORKBENCH_PATIENT_LIMIT;
  const includeSetPlan = Boolean(filters.includeSetPlan);
  const assignmentWhere = buildMedicationCycleAssignmentWhere(ctx);
  const filterHash = buildFilterHash({
    orgId,
    phase: filters.phase,
    q,
    sort,
    order,
    includeSetPlan,
    limit,
    secret: filters.cursorSecret,
  });
  const scopeHash = buildScopeHash({
    orgId,
    ctx,
    assignmentWhere,
    secret: filters.cursorSecret,
  });
  const decodedCursor = decodeCursor({
    cursor: filters.cursor,
    limit,
    filterHash,
    scopeHash,
    now,
    secret: filters.cursorSecret,
  });

  const cycles = (await prisma.medicationCycle.findMany({
    where: buildMedicationCycleWhere({ orgId, assignmentWhere, q }),
    orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
    select: {
      id: true,
      patient_id: true,
      overall_status: true,
      created_at: true,
      case_: {
        select: {
          start_date: true,
          patient: {
            select: {
              id: true,
              name: true,
              name_kana: true,
              created_at: true,
            },
          },
        },
      },
      prescription_intakes: {
        select: {
          lines: {
            where: { start_date: { not: null } },
            orderBy: { start_date: 'asc' },
            take: 1,
            select: { start_date: true },
          },
        },
      },
    },
  })) as CycleCandidate[];

  const latestRows = latestRowsPerPatient(cycles);
  const setPhaseByPatientId = await classifySetPhaseRows(prisma, orgId, ctx, latestRows);
  const facets = buildFacets(latestRows, setPhaseByPatientId);
  const phaseFilteredRows = latestRows.filter((row) => {
    const phase = derivePhaseForRow(row, setPhaseByPatientId);
    return filters.phase ? phase === filters.phase : true;
  });
  const sortedRows = sortDispenseWorkbenchPatients(phaseFilteredRows, { sort, order });
  const pageStart = locateCursorStart(sortedRows, {
    marker: decodedCursor.marker,
    filterHash,
    scopeHash,
    secret: filters.cursorSecret,
  });
  const pageRows = sortedRows.slice(pageStart, pageStart + limit);
  const nextOffset = pageStart + pageRows.length;
  const hasMore = pageRows.length > 0 && nextOffset < sortedRows.length;

  if (includeSetPlan || filters.phase === 'set' || filters.phase === 'set-audit') {
    await hydrateLatestSetPlans(prisma, orgId, ctx, pageRows);
  }

  if (filters.phase === 'dispense' || filters.phase === 'audit') {
    await hydrateRepresentativeDispenseTasks(
      prisma,
      orgId,
      assignmentWhere,
      pageRows,
      filters.phase,
    );
  }

  return {
    data: pageRows,
    meta: {
      generated_at: now.toISOString(),
      limit,
      returned_count: pageRows.length,
      has_more: hasMore,
      next_cursor: hasMore
        ? encodeCursor({
            row: pageRows[pageRows.length - 1]!,
            limit,
            filterHash,
            scopeHash,
            now,
            secret: filters.cursorSecret,
          })
        : null,
      total_count: sortedRows.length,
      count_basis: DISPENSE_WORKBENCH_COUNT_BASIS,
      filters_applied: {
        phase: filters.phase ?? null,
        q_present: Boolean(q),
        sort,
        order,
        include_set_plan: includeSetPlan,
      },
      facets,
    },
  };
}

function locateCursorStart(
  rows: DispenseWorkbenchPatientRow[],
  args: {
    marker: string | null;
    filterHash: string;
    scopeHash: string;
    secret: string;
  },
) {
  if (!args.marker) return 0;
  const markerIndex = rows.findIndex(
    (row) =>
      buildRowMarker({
        row,
        filterHash: args.filterHash,
        scopeHash: args.scopeHash,
        secret: args.secret,
      }) === args.marker,
  );
  if (markerIndex < 0) throw new DispenseWorkbenchPatientsCursorError('stale');
  return markerIndex + 1;
}

function derivePhaseForRow(
  row: DispenseWorkbenchPatientRow,
  setPhaseByPatientId: Map<string, 'set' | 'set-audit'>,
): DispenseWorkbenchPhase | null {
  const status = row.overall_status;
  if (PHASE_CYCLE_STATUSES.dispense.includes(status as MedicationCycleStatus)) return 'dispense';
  if (PHASE_CYCLE_STATUSES.audit.includes(status as MedicationCycleStatus)) return 'audit';
  return setPhaseByPatientId.get(row.patient_id) ?? null;
}

function buildFacets(
  rows: DispenseWorkbenchPatientRow[],
  setPhaseByPatientId: Map<string, 'set' | 'set-audit'>,
): DispenseWorkbenchPatientsResponse['meta']['facets'] {
  const phase_counts: Record<DispenseWorkbenchPhase, number> = {
    dispense: 0,
    audit: 0,
    set: 0,
    'set-audit': 0,
  };
  let other = 0;
  for (const row of rows) {
    const phase = derivePhaseForRow(row, setPhaseByPatientId);
    if (phase) {
      phase_counts[phase] += 1;
    } else {
      other += 1;
    }
  }
  return {
    total: rows.length,
    phase_counts,
    other,
  };
}

async function hydrateRepresentativeDispenseTasks(
  prisma: PrismaClient,
  orgId: string,
  assignmentWhere: Prisma.MedicationCycleWhereInput | null,
  rows: DispenseWorkbenchPatientRow[],
  phase: 'dispense' | 'audit',
) {
  if (rows.length === 0) return;

  const cycleIds = rows.map((row) => row.cycle_id).filter((id): id is string => Boolean(id));
  if (cycleIds.length === 0) return;

  const tasks = await prisma.dispenseTask.findMany({
    where: {
      org_id: orgId,
      cycle_id: { in: cycleIds },
      status: { in: [...REPRESENTATIVE_DISPENSE_TASK_STATUSES] },
      ...(assignmentWhere ? { cycle: { is: assignmentWhere } } : {}),
    },
    orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
    select: {
      id: true,
      cycle_id: true,
      status: true,
    },
  });

  const tasksByCycle = new Map<string, Array<{ id: string; status: string }>>();

  for (const task of tasks) {
    const cycleTasks = tasksByCycle.get(task.cycle_id) ?? [];
    cycleTasks.push({ id: task.id, status: task.status });
    tasksByCycle.set(task.cycle_id, cycleTasks);
  }

  for (const row of rows) {
    if (!row.cycle_id) continue;
    const task = selectRepresentativeDispenseTask(tasksByCycle.get(row.cycle_id) ?? [], phase);
    row.representative_task_id = task?.id ?? null;
    row.representative_task_status = task?.status ?? null;
  }
}

async function classifySetPhaseRows(
  prisma: PrismaClient,
  orgId: string,
  ctx: PrescriptionAccessContext,
  rows: DispenseWorkbenchPatientRow[],
) {
  const setBaseRows = rows.filter((row) =>
    PHASE_CYCLE_STATUSES.set.includes(row.overall_status as MedicationCycleStatus),
  );
  await hydrateLatestSetPlans(prisma, orgId, ctx, setBaseRows);
  const classification = await classifyRowsBySetBatchPhase(prisma, orgId, setBaseRows);
  const phaseByPatientId = new Map<string, 'set' | 'set-audit'>();
  for (const row of setBaseRows) {
    const rowClass = classification.get(row.patient_id);
    if (rowClass === 'setting') phaseByPatientId.set(row.patient_id, 'set');
    if (rowClass === 'audit-pending') phaseByPatientId.set(row.patient_id, 'set-audit');
  }
  return phaseByPatientId;
}

async function classifyRowsBySetBatchPhase(
  prisma: PrismaClient,
  orgId: string,
  rows: DispenseWorkbenchPatientRow[],
): Promise<Map<string, ReturnType<typeof classifySetBatchPhase>>> {
  const planIds = rows
    .map((row) => row.latest_set_plan_id)
    .filter((id): id is string => id != null);

  const countsByPlan = new Map<string, SetBatchPhaseCounts>();
  if (planIds.length > 0) {
    const batches = await prisma.setBatch.findMany({
      where: { org_id: orgId, plan_id: { in: planIds } },
      select: { plan_id: true, set_state: true, audit_state: true },
    });
    for (const batch of batches) {
      const counts = countsByPlan.get(batch.plan_id) ?? {
        total: 0,
        pending: 0,
        unaudited: 0,
        ng: 0,
      };
      counts.total += 1;
      if (batch.set_state !== 'set' && batch.set_state !== 'hold') counts.pending += 1;
      if (batch.audit_state === 'unaudited') counts.unaudited += 1;
      else if (batch.audit_state === 'ng') counts.ng += 1;
      countsByPlan.set(batch.plan_id, counts);
    }
  }

  const result = new Map<string, ReturnType<typeof classifySetBatchPhase>>();
  for (const row of rows) {
    const counts = (row.latest_set_plan_id
      ? countsByPlan.get(row.latest_set_plan_id)
      : undefined) ?? {
      total: 0,
      pending: 0,
      unaudited: 0,
      ng: 0,
    };
    result.set(row.patient_id, classifySetBatchPhase(counts));
  }
  return result;
}

async function hydrateLatestSetPlans(
  prisma: PrismaClient,
  orgId: string,
  ctx: PrescriptionAccessContext,
  rows: DispenseWorkbenchPatientRow[],
) {
  if (rows.length === 0) return;

  const assignmentWhere = buildSetPlanAssignmentWhere(ctx);
  const patientIds = rows.map((row) => row.patient_id);
  if (patientIds.length === 0) return;
  const latestPlans = await prisma.setPlan.findMany({
    where: {
      org_id: orgId,
      AND: [
        {
          cycle: {
            patient_id: { in: patientIds },
          },
        },
        ...(assignmentWhere ? [assignmentWhere] : []),
      ],
    },
    orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
    select: {
      id: true,
      cycle_id: true,
      cycle: {
        select: {
          patient_id: true,
        },
      },
    } satisfies Prisma.SetPlanSelect,
  });

  const latestPlanByPatient = new Map<string, { id: string; cycle_id: string }>();
  for (const plan of latestPlans) {
    const patientId = plan.cycle.patient_id;
    if (!latestPlanByPatient.has(patientId)) {
      latestPlanByPatient.set(patientId, { id: plan.id, cycle_id: plan.cycle_id });
    }
  }

  for (const row of rows) {
    const plan = latestPlanByPatient.get(row.patient_id);
    row.latest_set_plan_id = plan?.id ?? null;
    row.latest_set_plan_cycle_id = plan?.cycle_id ?? null;
  }
}

function sortDispenseWorkbenchPatients(
  rows: DispenseWorkbenchPatientRow[],
  filters: {
    sort: DispenseWorkbenchPatientsSort;
    order: 'asc' | 'desc';
  },
): DispenseWorkbenchPatientRow[] {
  const sort = filters.sort;
  const order = filters.order;
  const directionFactor = order === 'asc' ? 1 : -1;

  const compareKana = (left: DispenseWorkbenchPatientRow, right: DispenseWorkbenchPatientRow) =>
    left.name_kana.localeCompare(right.name_kana, 'ja');

  const compareNullableDate = (left: string | null, right: string | null): number => {
    if (left === right) return 0;
    if (left == null) return 1;
    if (right == null) return -1;
    return (left < right ? -1 : 1) * directionFactor;
  };

  return [...rows].sort((left, right) => {
    if (sort === 'name_kana') {
      const result = compareKana(left, right);
      return (
        (result !== 0 ? result : left.patient_id.localeCompare(right.patient_id)) * directionFactor
      );
    }

    const key = sort === 'start_date' ? 'start_date' : 'registered_date';
    const primary = compareNullableDate(left[key], right[key]);
    if (primary !== 0) return primary;
    const tieByKana = compareKana(left, right);
    return tieByKana !== 0 ? tieByKana : left.patient_id.localeCompare(right.patient_id);
  });
}
