import { NextRequest } from 'next/server';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { NextResponse } from 'next/server';
import type { WebhookEventType } from '@/server/services/outbound-webhook';

// NOTE: Webhook registration is planned but not yet implemented.
// The persistent store (DB table) and delivery infrastructure are not in place.
// These endpoints return 501 until the feature is fully implemented.

const NOT_IMPLEMENTED_MESSAGE =
  'Webhook 登録機能は現在開発中です。将来のリリースで利用可能になります。';

export const GET = withAuth(
  async (_req: AuthenticatedRequest) => {
    return NextResponse.json({ error: NOT_IMPLEMENTED_MESSAGE }, { status: 501 });
  },
  { permission: 'canAdmin', message: 'Webhook 設定の閲覧権限がありません' }
);

export const POST = withAuth(
  async (_req: AuthenticatedRequest) => {
    return NextResponse.json({ error: NOT_IMPLEMENTED_MESSAGE }, { status: 501 });
  },
  { permission: 'canAdmin', message: 'Webhook 登録権限がありません' }
);

// Re-export supported event types for reference
export type { WebhookEventType };
