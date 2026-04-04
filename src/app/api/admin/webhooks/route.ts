import { NextRequest } from 'next/server';
import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { success, validationError } from '@/lib/api/response';
import { z } from 'zod';
import type { WebhookEventType } from '@/server/services/outbound-webhook';

const SUPPORTED_EVENTS: WebhookEventType[] = [
  'prescription.created',
  'prescription.dispensed',
  'patient.created',
  'billing.exported',
  'qualification.checked',
];

const registerWebhookSchema = z.object({
  url: z.string().url('有効な URL を指定してください'),
  events: z
    .array(z.enum(SUPPORTED_EVENTS as [WebhookEventType, ...WebhookEventType[]]))
    .min(1, 'イベントを1件以上指定してください'),
  secret: z.string().min(16, 'シークレットは16文字以上にしてください').optional(),
});

// In-memory store (production: move to DB table)
type StoredWebhook = {
  id: string;
  orgId: string;
  url: string;
  secret: string;
  events: WebhookEventType[];
  isActive: boolean;
  createdAt: string;
};

const webhookStore = new Map<string, StoredWebhook[]>();

export const GET = withAuth(
  async (req: AuthenticatedRequest) => {
    const registrations = webhookStore.get(req.orgId) ?? [];
    return success({ data: registrations.map(({ secret: _s, ...rest }) => rest) });
  },
  { permission: 'canAdmin', message: 'Webhook 設定の閲覧権限がありません' }
);

export const POST = withAuth(
  async (req: AuthenticatedRequest) => {
    const body = await req.json().catch(() => null);
    if (!body) return validationError('リクエストボディが不正です');

    const parsed = registerWebhookSchema.safeParse(body);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const registration: StoredWebhook = {
      id: crypto.randomUUID(),
      orgId: req.orgId,
      url: parsed.data.url,
      secret: parsed.data.secret ?? crypto.randomUUID().replace(/-/g, ''),
      events: parsed.data.events,
      isActive: true,
      createdAt: new Date().toISOString(),
    };

    const existing = webhookStore.get(req.orgId) ?? [];
    webhookStore.set(req.orgId, [...existing, registration]);

    const { secret: _s, ...response } = registration;
    return success({ data: response }, 201);
  },
  { permission: 'canAdmin', message: 'Webhook 登録権限がありません' }
);
