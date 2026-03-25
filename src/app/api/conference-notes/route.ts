import { Prisma } from '@prisma/client';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError } from '@/lib/api/response';
import { parsePaginationParams } from '@/lib/api/pagination';
import { z } from 'zod';

const createNoteSchema = z.object({
  case_id: z.string().optional(),
  title: z.string().min(1).max(200),
  content: z.string().min(1),
  participants: z.array(z.object({ name: z.string(), role: z.string() })),
  conference_date: z.string().datetime(),
  action_items: z
    .array(z.object({ title: z.string(), assignee: z.string().optional() }))
    .optional(),
});

export const GET = withAuth(async (req: AuthenticatedRequest) => {
  const { searchParams } = new URL(req.url);
  const { cursor, limit } = parsePaginationParams(searchParams);
  const caseId = searchParams.get('case_id') ?? undefined;

  const where = {
    org_id: req.orgId,
    ...(caseId ? { case_id: caseId } : {}),
  };

  const notes = await withOrgContext(req.orgId, (tx) =>
    tx.conferenceNote.findMany({
      where,
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { conference_date: 'desc' },
    })
  );

  const hasMore = notes.length > limit;
  const data = hasMore ? notes.slice(0, limit) : notes;
  const nextCursor = hasMore ? data[data.length - 1]?.id : undefined;

  return success({ data, hasMore, nextCursor });
});

export const POST = withAuth(async (req: AuthenticatedRequest) => {
  const body = await req.json().catch(() => null);
  if (!body) return validationError('リクエストボディが不正です');

  const parsed = createNoteSchema.safeParse(body);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.issues);
  }

  const { case_id, title, content, participants, conference_date, action_items } = parsed.data;

  const note = await withOrgContext(req.orgId, (tx) =>
    tx.conferenceNote.create({
      data: {
        org_id: req.orgId,
        case_id: case_id ?? null,
        title,
        content,
        participants,
        conference_date: new Date(conference_date),
        action_items: action_items !== undefined ? action_items : Prisma.JsonNull,
      },
    })
  );

  return success({ data: note }, 201);
});
