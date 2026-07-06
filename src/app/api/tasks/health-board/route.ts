import { unstable_rethrow } from 'next/navigation';
import { type NextRequest } from 'next/server';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { internalError, success, validationError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { requireAuthContext } from '@/lib/auth/context';
import { prisma } from '@/lib/db/client';
import { withOrgContext } from '@/lib/db/rls';
import { logger } from '@/lib/utils/logger';
import { withRoutePerformance } from '@/lib/utils/performance';
import { RISK_DOMAIN_ORDER } from '@/lib/risk/risk-finding';
import { RISK_TASK_REGISTRY } from '@/lib/tasks/task-registry';
import {
  buildDashboardTaskAssignmentWhere,
  resolveDashboardAssignmentScope,
} from '@/server/services/dashboard-assignment-scope';
import {
  buildOperationalTaskHealthBoard,
  normalizeOperationalTaskHealthLimit,
} from '@/server/services/operational-task-health';

const ROUTE = '/api/tasks/health-board';
const RISK_TASK_TYPES = Object.values(RISK_TASK_REGISTRY).map((entry) => entry.task_type);

const healthBoardQuerySchema = z
  .object({
    scope: z.enum(['role_default', 'mine', 'team']).optional(),
    limit: z.coerce.number().int().min(1).max(1000).optional(),
    task_type: z.string().trim().min(1).max(100).optional(),
    risk_domain: z.enum(RISK_DOMAIN_ORDER).optional(),
  })
  .refine((value) => !(value.task_type && value.risk_domain), {
    message: 'task_type と risk_domain は同時に指定できません',
    path: ['task_type'],
  });

function parseQuery(req: NextRequest) {
  const parsed = healthBoardQuerySchema.safeParse({
    scope: req.nextUrl.searchParams.get('scope') ?? undefined,
    limit: req.nextUrl.searchParams.get('limit') ?? undefined,
    task_type: req.nextUrl.searchParams.get('task_type') ?? undefined,
    risk_domain: req.nextUrl.searchParams.get('risk_domain') ?? undefined,
  });
  if (!parsed.success) {
    return {
      ok: false as const,
      response: validationError('検索条件が不正です', parsed.error.flatten().fieldErrors),
    };
  }
  return { ok: true as const, data: parsed.data };
}

function buildRiskMetadataOwnershipWhere(args: {
  caseIds?: string[];
  patientIds?: string[];
}): Prisma.TaskWhereInput | null {
  const ownership: Prisma.TaskWhereInput[] = [
    ...(args.caseIds ?? []).map((caseId) => ({
      metadata: {
        path: ['case_id'],
        equals: caseId,
      },
    })),
    ...(args.patientIds ?? []).map((patientId) => ({
      metadata: {
        path: ['patient_id'],
        equals: patientId,
      },
    })),
  ];
  if (ownership.length === 0) return null;

  return {
    AND: [
      {
        OR: [
          { task_type: { in: RISK_TASK_TYPES } },
          { dedupe_key: { startsWith: 'risk:' } },
          {
            metadata: {
              path: ['source'],
              equals: 'risk_finding',
            },
          },
        ],
      },
      { OR: ownership },
    ],
  };
}

function buildHealthBoardAssignmentWhere(args: {
  caseIds?: string[];
  patientIds?: string[];
  assignedToUserId?: string;
}): Prisma.TaskWhereInput {
  const directWhere = buildDashboardTaskAssignmentWhere(args);
  const riskMetadataWhere = buildRiskMetadataOwnershipWhere(args);
  if (!riskMetadataWhere) return directWhere;
  if (Object.keys(directWhere).length === 0) return directWhere;
  return {
    OR: [directWhere, riskMetadataWhere],
  };
}

function buildTaskFilterWhere(args: {
  taskType?: string;
  riskDomain?: (typeof RISK_DOMAIN_ORDER)[number];
}): Prisma.TaskWhereInput {
  if (args.taskType) return { task_type: args.taskType };
  if (!args.riskDomain) return {};

  return {
    OR: [
      { task_type: RISK_TASK_REGISTRY[args.riskDomain].task_type },
      {
        metadata: {
          path: ['risk_domain'],
          equals: args.riskDomain,
        },
      },
    ],
  };
}

function andTaskWhere(...wheres: Prisma.TaskWhereInput[]): Prisma.TaskWhereInput {
  const active = wheres.filter((where) => Object.keys(where).length > 0);
  if (active.length === 0) return {};
  if (active.length === 1) return active[0] ?? {};
  return { AND: active };
}

async function authenticatedGET(req: NextRequest) {
  const authResult = await requireAuthContext(req, {
    permission: 'canVisit',
    message: 'タスクヘルスボードの閲覧権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const { ctx } = authResult;

  const parsed = parseQuery(req);
  if (!parsed.ok) return parsed.response;

  const scope = parsed.data.scope ?? 'role_default';
  const assignmentScope = await resolveDashboardAssignmentScope({
    db: prisma,
    orgId: ctx.orgId,
    accessContext: ctx,
    scope,
  });
  const assignmentWhere = buildHealthBoardAssignmentWhere(assignmentScope);
  const taskFilterWhere = buildTaskFilterWhere({
    taskType: parsed.data.task_type,
    riskDomain: parsed.data.risk_domain,
  });

  const board = await withOrgContext(
    ctx.orgId,
    (tx) =>
      buildOperationalTaskHealthBoard(tx, {
        orgId: ctx.orgId,
        limit: normalizeOperationalTaskHealthLimit(parsed.data.limit),
        where: andTaskWhere(assignmentWhere, taskFilterWhere),
      }),
    { requestContext: ctx },
  );

  return success({
    data: {
      ...board,
      scope,
    },
  });
}

export async function GET(req: NextRequest) {
  return withRoutePerformance(req, async () => {
    try {
      return withSensitiveNoStore(await authenticatedGET(req));
    } catch (err) {
      unstable_rethrow(err);
      logger.error(
        {
          event: 'tasks_health_board_unhandled_error',
          route: ROUTE,
          method: req.method,
          code: err instanceof Error ? err.name : typeof err,
        },
        err,
      );
      return withSensitiveNoStore(internalError());
    }
  });
}
