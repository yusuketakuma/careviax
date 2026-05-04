import { NextRequest } from 'next/server';
import { success, notFound, validationError, error } from '@/lib/api/response';
import { checkAuthRateLimit } from '@/lib/api/rate-limit';
import { getClientIp } from '@/lib/api/request-ip';
import { withOrgContext } from '@/lib/db/rls';
import { validateExternalAccessGrant } from '@/server/services/external-access';
import { z } from 'zod';
import {
  createExternalAccessOtpRateLimitIdentifier,
  EXTERNAL_ACCESS_OTP_RATE_LIMIT_PATH,
} from '../../shared';

// OTP is intentionally accepted only via the `x-otp` header to keep the secret
// out of POST body request logs (Sentry breadcrumbs, WAF, Next.js logger).
const createSelfReportSchema = z.object({
  reported_by_name: z.string().trim().min(1, '報告者氏名は必須です'),
  relation: z.string().trim().max(100).optional(),
  category: z.string().trim().min(1, 'カテゴリは必須です').max(100),
  subject: z.string().trim().min(1, '件名は必須です').max(200),
  content: z.string().trim().min(1, '内容は必須です').max(4000),
  requested_callback: z.boolean().default(false),
  preferred_contact_time: z.string().trim().max(200).optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const ip = getClientIp(req) ?? 'unknown';
  const rateLimit = await checkAuthRateLimit(
    createExternalAccessOtpRateLimitIdentifier(token, ip),
    EXTERNAL_ACCESS_OTP_RATE_LIMIT_PATH,
  );
  if (!rateLimit.allowed) {
    return error(
      'RATE_LIMIT_EXCEEDED',
      'リクエストが多すぎます。しばらく待ってから再試行してください。',
      429
    );
  }

  const body = await req.json().catch(() => null);

  if (!body) {
    return validationError('リクエストボディが不正です');
  }

  const parsed = createSelfReportSchema.safeParse(body);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const otp = req.headers.get('x-otp') ?? undefined;
  const validation = await validateExternalAccessGrant(token, otp);

  if (!validation.ok) {
    if (validation.kind === 'validation') {
      return validationError(validation.message);
    }

    return notFound(validation.message);
  }

  const created = await withOrgContext(validation.grant.org_id, async (tx) => {
    const report = await tx.patientSelfReport.create({
      data: {
        org_id: validation.grant.org_id,
        patient_id: validation.grant.patient_id,
        external_access_grant_id: validation.grant.id,
        reported_by_name: parsed.data.reported_by_name,
        relation: parsed.data.relation ?? null,
        category: parsed.data.category,
        subject: parsed.data.subject,
        content: parsed.data.content,
        requested_callback: parsed.data.requested_callback,
        preferred_contact_time: parsed.data.preferred_contact_time ?? null,
      },
      select: {
        id: true,
        patient_id: true,
        status: true,
        created_at: true,
      },
    });

    await tx.communicationEvent.create({
      data: {
        org_id: validation.grant.org_id,
        patient_id: validation.grant.patient_id,
        event_type: 'patient_self_report',
        channel: 'phone',
        direction: 'inbound',
        counterpart_name: parsed.data.reported_by_name,
        counterpart_contact: parsed.data.preferred_contact_time ?? null,
        subject: parsed.data.subject,
        content: parsed.data.content,
      },
    });

    return report;
  });

  return success({ data: created }, 201);
}
