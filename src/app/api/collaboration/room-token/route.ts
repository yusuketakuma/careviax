import { NextRequest, NextResponse } from 'next/server';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { notFound, validationError } from '@/lib/api/response';
import { requireAuthContext } from '@/lib/auth/context';
import { isYjsProviderConfigured } from '@/lib/collaboration/yjs-config';
import {
  buildCollaborationRoomName,
  canAccessCollaborationEntity,
  collaborationEntityRefSchema,
} from '@/server/services/collaboration-access';
import {
  COLLABORATION_ROOM_TOKEN_TTL_SECONDS,
  MissingCollaborationRoomTokenSecretError,
  issueCollaborationRoomToken,
} from '@/server/services/collaboration-room-token';

const ROOM_TOKEN_RESPONSE_HEADERS = {
  'Cache-Control': 'no-store, max-age=0',
  Pragma: 'no-cache',
  Expires: '0',
};
const COLLABORATION_TOKEN_UNAVAILABLE_RETRY_AFTER_SECONDS = 60;

function collaborationTokenUnavailableResponse() {
  return NextResponse.json(
    {
      code: 'COLLABORATION_TOKEN_UNAVAILABLE',
      message: '共同編集トークンを発行できません',
    },
    {
      status: 503,
      headers: {
        ...ROOM_TOKEN_RESPONSE_HEADERS,
        'Retry-After': String(COLLABORATION_TOKEN_UNAVAILABLE_RETRY_AFTER_SECONDS),
      },
    },
  );
}

export async function POST(req: NextRequest) {
  const authResult = await requireAuthContext(req, {
    permission: 'canDispense',
    message: '共同編集の権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;

  const payload = await readJsonObjectRequestBody(req);
  if (!payload) return validationError('リクエストボディが不正です');

  const parsed = collaborationEntityRefSchema.safeParse(payload);
  if (!parsed.success) return validationError('パラメータが不正です', parsed.error.flatten());

  if (!isYjsProviderConfigured()) {
    return collaborationTokenUnavailableResponse();
  }

  const canAccessEntity = await canAccessCollaborationEntity(
    ctx,
    parsed.data.entity_type,
    parsed.data.entity_id,
  );
  if (!canAccessEntity) return notFound('共同編集対象が見つかりません');

  const room = buildCollaborationRoomName({
    orgId: ctx.orgId,
    entityType: parsed.data.entity_type,
    entityId: parsed.data.entity_id,
  });

  try {
    const token = await issueCollaborationRoomToken({
      orgId: ctx.orgId,
      userId: ctx.userId,
      entityType: parsed.data.entity_type,
      entityId: parsed.data.entity_id,
    });

    return NextResponse.json(
      {
        room,
        token,
        expires_at: new Date(
          Date.now() + COLLABORATION_ROOM_TOKEN_TTL_SECONDS * 1000,
        ).toISOString(),
      },
      { status: 200, headers: ROOM_TOKEN_RESPONSE_HEADERS },
    );
  } catch (err) {
    if (err instanceof MissingCollaborationRoomTokenSecretError) {
      return collaborationTokenUnavailableResponse();
    }
    throw err;
  }
}
