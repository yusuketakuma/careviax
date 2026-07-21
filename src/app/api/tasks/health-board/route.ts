import { type NextRequest } from 'next/server';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { success, validationError } from '@/lib/api/response';
import { withAuthContext, type AuthContext } from '@/lib/auth/context';
import { prisma } from '@/lib/db/client';
import { withOrgContext } from '@/lib/db/rls';
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
  const searchParams = req.nextUrl.searchParams;
  const fieldErrors: Record<string, string[]> = {};
  for (const name of ['scope', 'limit', 'task_type', 'risk_domain'] as const) {
    if (searchParams.getAll(name).length > 1) {
      fieldErrors[name] = [`${name} は1つだけ指定してください`];
    }
  }
  const rawTaskType = searchParams.get('task_type');
  if (rawTaskType != null && rawTaskType !== rawTaskType.trim()) {
    fieldErrors.task_type = ['task_type の前後に空白は指定できません'];
  }
  if (Object.keys(fieldErrors).length > 0) {
    return {
      ok: false as const,
      response: validationError('検索条件が不正です', fieldErrors),
    };
  }

  const parsed = healthBoardQuerySchema.safeParse({
    scope: searchParams.get('scope') ?? undefined,
    limit: searchParams.get('limit') ?? undefined,
    task_type: rawTaskType ?? undefined,
    risk_domain: searchParams.get('risk_domain') ?? undefined,
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

async function authenticatedGET(req: NextRequest, ctx: AuthContext) {
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

export const GET = withAuthContext(authenticatedGET, {
  permission: 'canManageOperationalTasks',
  message: 'タスクヘルスボードの閲覧権限がありません',
});
