import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuthContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { prisma } from '@/lib/db/client';
import { Prisma } from '@prisma/client';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { conflict, forbidden, notFound, success, validationError } from '@/lib/api/response';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { toSavedViewRecord } from '@/lib/views/saved-filter-views';

/**
 * 名前付き保存ビュー (SavedView) の更新/削除 API。— W-CB-SAVED-VIEWS-MODEL (p1_01)
 *
 * PATCH  : 名前変更 / filters・sort の更新 / 共有 (is_shared) の切替 / 並び順の更新。
 * DELETE : 保存ビューの削除。
 * いずれも「所有者本人」のみ可。org 共有された他メンバーのビューは読み取り専用。
 * 書き込みは withOrgContext(RLS)内で createAuditLogEntry を発行する。
 */

const opaqueObjectSchema = z.record(z.string(), z.unknown());

const updateSavedViewSchema = z
  .object({
    name: z.string().trim().min(1, '名前を入力してください').max(100).optional(),
    filters: opaqueObjectSchema.optional(),
    sort: opaqueObjectSchema.nullish(),
    is_shared: z.boolean().optional(),
    sort_order: z.number().int().min(0).max(9999).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: '更新する項目がありません',
  });

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuthContext(req);
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;

  const payload = await readJsonObjectRequestBody(req);
  if (!payload) return validationError('リクエストボディが不正です');

  const parsed = updateSavedViewSchema.safeParse(payload);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const { id } = await params;
  const viewId = normalizeRequiredRouteParam(id);
  if (!viewId) return validationError('保存ビューIDが不正です');

  const existing = await prisma.savedView.findFirst({
    where: { id: viewId, org_id: ctx.orgId },
    select: { id: true, user_id: true, scope: true, name: true },
  });
  if (!existing) return notFound('保存ビューが見つかりません');
  if (existing.user_id !== ctx.userId) {
    return forbidden('この保存ビューを編集する権限がありません');
  }

  // 改名時は一意制約 [org_id, user_id, scope, name] の事前チェック
  if (parsed.data.name && parsed.data.name !== existing.name) {
    const duplicate = await prisma.savedView.findFirst({
      where: {
        org_id: ctx.orgId,
        user_id: ctx.userId,
        scope: existing.scope,
        name: parsed.data.name,
        id: { not: viewId },
      },
      select: { id: true },
    });
    if (duplicate) {
      return conflict('同じ名前の保存ビューが既に存在します');
    }
  }

  const data: Prisma.SavedViewUpdateInput = {};
  if (parsed.data.name !== undefined) data.name = parsed.data.name;
  if (parsed.data.filters !== undefined) {
    data.filters = parsed.data.filters as Prisma.InputJsonValue;
  }
  if (parsed.data.sort !== undefined) {
    data.sort =
      parsed.data.sort === null
        ? Prisma.JsonNull
        : (parsed.data.sort as Prisma.InputJsonValue);
  }
  if (parsed.data.is_shared !== undefined) data.is_shared = parsed.data.is_shared;
  if (parsed.data.sort_order !== undefined) data.sort_order = parsed.data.sort_order;

  const updated = await withOrgContext(ctx.orgId, async (tx) => {
    const view = await tx.savedView.update({
      where: { id: viewId },
      data,
    });

    await createAuditLogEntry(tx, ctx, {
      action: 'saved_view_updated',
      targetType: 'SavedView',
      targetId: viewId,
      changes: {
        ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
        ...(parsed.data.is_shared !== undefined ? { is_shared: parsed.data.is_shared } : {}),
        ...(parsed.data.sort_order !== undefined ? { sort_order: parsed.data.sort_order } : {}),
        ...(parsed.data.filters !== undefined ? { filters_updated: true } : {}),
        ...(parsed.data.sort !== undefined ? { sort_updated: true } : {}),
      },
    });

    return view;
  });

  return success({ data: toSavedViewRecord(updated, ctx.userId) });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authResult = await requireAuthContext(req);
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;

  const { id } = await params;
  const viewId = normalizeRequiredRouteParam(id);
  if (!viewId) return validationError('保存ビューIDが不正です');

  const existing = await prisma.savedView.findFirst({
    where: { id: viewId, org_id: ctx.orgId },
    select: { id: true, user_id: true, name: true, scope: true },
  });
  if (!existing) return notFound('保存ビューが見つかりません');
  if (existing.user_id !== ctx.userId) {
    return forbidden('この保存ビューを削除する権限がありません');
  }

  await withOrgContext(ctx.orgId, async (tx) => {
    await tx.savedView.delete({ where: { id: viewId } });

    await createAuditLogEntry(tx, ctx, {
      action: 'saved_view_deleted',
      targetType: 'SavedView',
      targetId: viewId,
      changes: { name: existing.name, scope: existing.scope },
    });
  });

  return success({ ok: true });
}
