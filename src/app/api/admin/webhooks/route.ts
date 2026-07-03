import { withAuthContext } from '@/lib/auth/context';
import { parseBoundedInteger } from '@/lib/api/pagination';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { compatibilityError, success, validationCompatibilityError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { withOrgContext } from '@/lib/db/rls';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { z } from 'zod';
import {
  hasWebhookUrlCredentials,
  isAllowedWebhookUrl,
  redactWebhookUrlForDisplay,
  WEBHOOK_EVENT_TYPES,
} from '@/server/services/outbound-webhook';
import { encryptWebhookSecret } from '@/server/services/webhook-secret-encryption';
import { randomBytes } from 'node:crypto';

const createWebhookSchema = z.object({
  url: z.string().url('有効なURLを入力してください'),
  events: z.array(z.enum(WEBHOOK_EVENT_TYPES)).min(1, 'イベントを1件以上選択してください'),
});

const DEFAULT_WEBHOOK_REGISTRATION_LIMIT = 100;
const MAX_WEBHOOK_REGISTRATION_LIMIT = 200;

function generateWebhookSecret(): string {
  return randomBytes(32).toString('hex');
}

function toPublicWebhookRegistration<T extends { url: string }>(registration: T): T {
  return { ...registration, url: redactWebhookUrlForDisplay(registration.url) };
}

export const GET = withAuthContext(
  async (req, ctx) => {
    const { searchParams } = new URL(req.url);
    const limit = parseBoundedInteger(
      searchParams.get('limit'),
      DEFAULT_WEBHOOK_REGISTRATION_LIMIT,
      1,
      MAX_WEBHOOK_REGISTRATION_LIMIT,
    );
    const where = { org_id: ctx.orgId };

    const [totalCount, registrations] = await withOrgContext(ctx.orgId, async (tx) => {
      return Promise.all([
        tx.webhookRegistration.count({ where }),
        tx.webhookRegistration.findMany({
          where,
          orderBy: { created_at: 'desc' },
          take: limit,
          select: {
            id: true,
            url: true,
            events: true,
            is_active: true,
            created_at: true,
            updated_at: true,
            // Exclude secret from list response
          },
        }),
      ]);
    });
    const visibleCount = registrations.length;
    const hiddenCount = Math.max(totalCount - visibleCount, 0);

    return success({
      data: registrations.map(toPublicWebhookRegistration),
      total_count: totalCount,
      visible_count: visibleCount,
      hidden_count: hiddenCount,
      truncated: hiddenCount > 0,
      count_basis: 'webhook_registrations',
      filters_applied: {},
      limit,
      meta: {
        limit,
        has_more: hiddenCount > 0,
      },
    });
  },
  { permission: 'canAdmin', message: 'Webhook 設定の閲覧権限がありません' },
);

export const POST = withAuthContext(
  async (req, ctx) => {
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) {
      return withSensitiveNoStore(validationCompatibilityError('リクエストボディが不正です'));
    }

    const parsed = createWebhookSchema.safeParse(payload);
    if (!parsed.success) {
      return withSensitiveNoStore(
        validationCompatibilityError('入力値が不正です', parsed.error.flatten().fieldErrors),
      );
    }

    const { url, events } = parsed.data;

    if (hasWebhookUrlCredentials(url)) {
      return withSensitiveNoStore(
        validationCompatibilityError('WebhookのURLにユーザー情報は含められません'),
      );
    }

    if (!(await isAllowedWebhookUrl(url))) {
      return withSensitiveNoStore(
        validationCompatibilityError('WebhookのURLはHTTPS公開エンドポイントである必要があります'),
      );
    }

    const secret = generateWebhookSecret();
    let encryptedSecret;
    try {
      encryptedSecret = await encryptWebhookSecret(secret);
    } catch {
      return withSensitiveNoStore(
        compatibilityError(
          'WEBHOOK_SECRET_ENCRYPTION_UNAVAILABLE',
          'Webhook secret 暗号化キーが設定されていません',
          503,
        ),
      );
    }

    const registration = await withOrgContext(ctx.orgId, async (tx) => {
      const created = await tx.webhookRegistration.create({
        data: {
          org_id: ctx.orgId,
          url,
          secret: null,
          ...encryptedSecret,
          events,
        },
        select: {
          id: true,
          url: true,
          events: true,
          is_active: true,
          created_at: true,
        },
      });
      await createAuditLogEntry(tx, ctx, {
        action: 'webhook_registration_created',
        targetType: 'WebhookRegistration',
        targetId: created.id,
        changes: {
          url: redactWebhookUrlForDisplay(url),
          events,
          secret_key_id: encryptedSecret.secret_key_id,
        },
      });
      return {
        ...toPublicWebhookRegistration(created),
        // Return secret once at creation so caller can store it.
        secret,
      };
    });

    return withSensitiveNoStore(success({ data: registration }, 201));
  },
  { permission: 'canAdmin', message: 'Webhook 登録権限がありません' },
);

// Re-export supported event types for reference
export type { WebhookEventType } from '@/server/services/outbound-webhook';
