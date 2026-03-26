import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError, notFound } from '@/lib/api/response';
import { parsePaginationParams } from '@/lib/api/pagination';
import { prisma } from '@/lib/db/client';
import { z } from 'zod';

const createDispenseTaskSchema = z.object({
  cycle_id: z.string().min(1, 'サイクルIDは必須です'),
  priority: z.enum(['emergency', 'urgent', 'normal']).default('normal'),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}/).optional(),
  assigned_to: z.string().optional(),
});

const cycleInclude = {
  cycle: {
    select: {
      id: true,
      patient_id: true,
      overall_status: true,
      case_: {
        select: {
          id: true,
          patient: {
            select: {
              id: true,
              name: true,
              name_kana: true,
            },
          },
        },
      },
    },
  },
} as const;

export const GET = withAuth(async (req: AuthenticatedRequest) => {
  const { searchParams } = new URL(req.url);
  const { cursor, limit } = parsePaginationParams(searchParams);

  const status = searchParams.get('status') ?? undefined;
  const cycle_id = searchParams.get('cycle_id') ?? undefined;
  const assigned_to = searchParams.get('assigned_to') ?? undefined;

  const where = {
    org_id: req.orgId,
    ...(status ? { status } : {}),
    ...(cycle_id ? { cycle_id } : {}),
    ...(assigned_to ? { assigned_to } : {}),
  };

  const tasks = await prisma.dispenseTask.findMany({
    where,
    orderBy: [{ created_at: 'asc' }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    include: cycleInclude,
  });

  const hasMore = tasks.length > limit;
  const data = hasMore ? tasks.slice(0, limit) : tasks;
  const nextCursor = hasMore ? data[data.length - 1]?.id : undefined;

  return success({ data, nextCursor, hasMore });
});

export const POST = withAuth(async (req: AuthenticatedRequest) => {
  const body = await req.json().catch(() => null);
  if (!body) return validationError('リクエストボディが不正です');

  const parsed = createDispenseTaskSchema.safeParse(body);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const { cycle_id, priority, due_date, assigned_to } = parsed.data;

  // Verify cycle exists and belongs to org
  const cycle = await prisma.medicationCycle.findFirst({
    where: { id: cycle_id, org_id: req.orgId },
    select: { id: true, overall_status: true },
  });
  if (!cycle) return notFound('サイクルが見つかりません');

  const created = await withOrgContext(req.orgId, async (tx) => {
    const task = await tx.dispenseTask.create({
      data: {
        org_id: req.orgId,
        cycle_id,
        priority,
        due_date: due_date ? new Date(due_date) : undefined,
        assigned_to: assigned_to ?? null,
        status: 'pending',
      },
      include: cycleInclude,
    });

    // Update cycle status to 'dispensing' if currently ready_to_dispense or dispensing
    if (
      cycle.overall_status === 'ready_to_dispense' ||
      cycle.overall_status === 'dispensing'
    ) {
      await tx.medicationCycle.update({
        where: { id: cycle_id },
        data: { overall_status: 'dispensing' },
      });
    }

    return task;
  });

  return success(created, 201);
});
