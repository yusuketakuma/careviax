import { z } from 'zod';
import { withAuthContext } from '@/lib/auth/context';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { parseBoundedInteger } from '@/lib/api/pagination';
import { withOrgContext } from '@/lib/db/rls';
import { isPrismaUniqueConstraintError } from '@/lib/db/prisma-errors';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { conflict, success, validationError } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import type { Prisma } from '@prisma/client';
import {
  SAVED_VIEW_SCOPES,
  isSavedViewScope,
  toSavedViewRecord,
} from '@/lib/views/saved-filter-views';

/**
 * 名前付き保存ビュー (SavedView) の一覧/作成 API。— W-CB-SAVED-VIEWS-MODEL (p1_01)
 *
 * GET  : 現在ユーザー自身のビュー + 同一 org で共有(is_shared)されたビューを
 *        scope で絞り込んで返す。
 * POST : 新規ビューを作成する(所有者 = 現在ユーザー)。
 * いずれも認証必須・org/user スコープ。書き込みは withOrgContext(RLS)内で
 * createAuditLogEntry を発行する(audit-by-default)。
 */

/** filters/sort は画面側が解釈する不透明な JSON。plain object のみ許容する。 */
const opaqueObjectSchema = z.record(z.string(), z.unknown());

const DEFAULT_SAVED_VIEW_LIMIT = 100;
const MAX_SAVED_VIEW_LIMIT = 200;

const createSavedViewSchema = z.object({
  name: z.string().trim().min(1, '名前を入力してください').max(100),
  scope: z.enum(SAVED_VIEW_SCOPES),
  filters: opaqueObjectSchema.default({}),
  sort: opaqueObjectSchema.nullish(),
  is_shared: z.boolean().default(false),
  sort_order: z.number().int().min(0).max(9999).optional(),
});

export const GET = withAuthContext(async (req, ctx) => {
  const { searchParams } = new URL(req.url);
  const scopeParam = searchParams.get('scope');
  if (scopeParam && !isSavedViewScope(scopeParam)) {
    return validationError('scope が不正です');
  }
  const limit = parseBoundedInteger(
    searchParams.get('limit'),
    DEFAULT_SAVED_VIEW_LIMIT,
    1,
    MAX_SAVED_VIEW_LIMIT,
  );

  const views = await prisma.savedView.findMany({
    where: {
      org_id: ctx.orgId,
      ...(scopeParam ? { scope: scopeParam } : {}),
      // 自分のビュー、または org 内で共有されたビュー
      OR: [{ user_id: ctx.userId }, { is_shared: true }],
    },
    orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }],
    take: limit,
  });

  return success({ data: views.map((view) => toSavedViewRecord(view, ctx.userId)) });
});

export const POST = withAuthContext(async (req, ctx) => {
  const payload = await readJsonObjectRequestBody(req);
  if (!payload) return validationError('リクエストボディが不正です');

  const parsed = createSavedViewSchema.safeParse(payload);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const { name, scope, filters, sort, is_shared, sort_order } = parsed.data;

  // 一意制約 [org_id, user_id, scope, name] の事前チェック(同名ビューは作れない)
  const duplicate = await prisma.savedView.findFirst({
    where: { org_id: ctx.orgId, user_id: ctx.userId, scope, name },
    select: { id: true },
  });
  if (duplicate) {
    return conflict('同じ名前の保存ビューが既に存在します');
  }

  const resolvedSortOrder =
    sort_order ??
    (await prisma.savedView.count({
      where: { org_id: ctx.orgId, user_id: ctx.userId, scope },
    }));

  let created: Awaited<ReturnType<typeof prisma.savedView.create>>;
  try {
    created = await withOrgContext(ctx.orgId, async (tx) => {
      const view = await tx.savedView.create({
        data: {
          org_id: ctx.orgId,
          user_id: ctx.userId,
          name,
          scope,
          filters: filters as Prisma.InputJsonValue,
          sort: (sort ?? undefined) as Prisma.InputJsonValue | undefined,
          is_shared,
          sort_order: resolvedSortOrder,
        },
      });

      await createAuditLogEntry(tx, ctx, {
        action: 'saved_view_created',
        targetType: 'SavedView',
        targetId: view.id,
        changes: { name, scope, is_shared },
      });

      return view;
    });
  } catch (error) {
    if (isPrismaUniqueConstraintError(error)) {
      return conflict('同じ名前の保存ビューが既に存在します');
    }
    throw error;
  }

  return success({ data: toSavedViewRecord(created, ctx.userId) }, 201);
});
