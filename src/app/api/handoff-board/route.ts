import { withAuthContext } from '@/lib/auth/context';
import { success, validationError } from '@/lib/api/response';
import { withOrgContext } from '@/lib/db/rls';
import { prisma } from '@/lib/db/client';
import { z } from 'zod';

const dateQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日付はYYYY-MM-DD形式で指定してください').optional(),
});

function toDateOnly(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00.000Z`);
}

function todayDateStr(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export const GET = withAuthContext(
  async (req, ctx) => {
    const { searchParams } = new URL(req.url);
    const parsed = dateQuerySchema.safeParse({
      date: searchParams.get('date') ?? undefined,
    });
    if (!parsed.success) {
      return validationError('日付の形式が不正です', parsed.error.flatten().fieldErrors);
    }

    const dateStr = parsed.data.date ?? todayDateStr();
    const shiftDate = toDateOnly(dateStr);

    const board = await withOrgContext(ctx.orgId, async (tx) => {
      const existing = await tx.handoffBoard.findUnique({
        where: {
          org_id_shift_date: {
            org_id: ctx.orgId,
            shift_date: shiftDate,
          },
        },
        include: {
          items: {
            orderBy: { created_at: 'asc' },
          },
        },
      });

      if (existing) return existing;

      return tx.handoffBoard.create({
        data: {
          org_id: ctx.orgId,
          shift_date: shiftDate,
          created_by: ctx.userId,
        },
        include: {
          items: true,
        },
      });
    });

    const creatorIds = [
      ...new Set(board.items.map((item) => item.created_by)),
    ];
    const creators =
      creatorIds.length === 0
        ? []
        : await prisma.user.findMany({
            where: { id: { in: creatorIds }, org_id: ctx.orgId },
            select: { id: true, name: true },
          });
    const creatorMap = new Map(creators.map((c) => [c.id, c.name]));

    const data = {
      ...board,
      items: board.items.map((item) => ({
        ...item,
        created_by_name: creatorMap.get(item.created_by) ?? '不明',
      })),
    };

    return success({ data });
  },
  {
    permission: 'canDispense',
    message: '申し送りボードの閲覧権限がありません',
  }
);
