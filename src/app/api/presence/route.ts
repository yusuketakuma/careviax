import { NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { prisma } from '@/lib/db/client';
import { notFound, success, validationError } from '@/lib/api/response';
import { getRealtimeAdapter } from '@/server/adapters/realtime';
import { setPresence, getPresence } from '@/server/services/presence-store';
import {
  buildCollaborationRoomName,
  canAccessCollaborationEntity,
  collaborationEntityRefSchema,
} from '@/server/services/collaboration-access';
import { z } from 'zod';

const postBodySchema = z.object({
  entity_type: collaborationEntityRefSchema.shape.entity_type,
  entity_id: z.string().min(1),
  active_field: z.string().max(200).nullable().default(null),
});

export async function POST(req: NextRequest) {
  const authResult = await requireAuthContext(req, {
    permission: 'canDispense',
    message: 'プレゼンス更新の権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;

  const body = await req.json().catch(() => null);
  if (!body) return validationError('リクエストボディが不正です');

  const parsed = postBodySchema.safeParse(body);
  if (!parsed.success) return validationError('パラメータが不正です', parsed.error.flatten());

  const { entity_type, entity_id, active_field } = parsed.data;

  const canAccessEntity = await canAccessCollaborationEntity(ctx, entity_type, entity_id);
  if (!canAccessEntity) return notFound('プレゼンス対象が見つかりません');

  const user = await prisma.user.findUnique({
    where: { id: ctx.userId },
    select: { name: true },
  });
  const displayName = user?.name ?? ctx.userId;

  setPresence(ctx.orgId, entity_type, entity_id, ctx.userId, displayName, active_field);

  const room = buildCollaborationRoomName({
    orgId: ctx.orgId,
    entityType: entity_type,
    entityId: entity_id,
  });
  const channel = `presence:${room}`;
  await getRealtimeAdapter()
    .broadcastStatusUpdate(channel, {
      type: 'presence_update',
      entity_type,
      entity_id,
      user_id: ctx.userId,
      display_name: displayName,
      active_field,
      updated_at: new Date().toISOString(),
    })
    .catch(() => undefined);

  return success({ ok: true });
}

export async function GET(req: NextRequest) {
  const authResult = await requireAuthContext(req, {
    permission: 'canDispense',
    message: 'プレゼンス取得の権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;

  const { searchParams } = new URL(req.url);
  const entity_type = searchParams.get('entity_type');
  const entity_id = searchParams.get('entity_id');

  const parsed = collaborationEntityRefSchema.safeParse({ entity_type, entity_id });
  if (!parsed.success) return validationError('entity_type と entity_id は必須です');

  const canAccessEntity = await canAccessCollaborationEntity(
    ctx,
    parsed.data.entity_type,
    parsed.data.entity_id,
  );
  if (!canAccessEntity) return notFound('プレゼンス対象が見つかりません');

  const entries = getPresence(ctx.orgId, parsed.data.entity_type, parsed.data.entity_id);

  return success(entries);
}
