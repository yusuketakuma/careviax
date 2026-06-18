import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { NextRequest } from 'next/server';
import { success, notFound, validationError, error } from '@/lib/api/response';
import { parseOptionalIdempotencyKey } from '@/lib/api/idempotency-key';
import { checkAuthRateLimit } from '@/lib/api/rate-limit';
import { getClientIp } from '@/lib/api/request-ip';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { withOrgContext } from '@/lib/db/rls';
import { validateExternalAccessGrant } from '@/server/services/external-access';
import { z } from 'zod';
import {
  createExternalAccessOtpRateLimitIdentifier,
  EXTERNAL_ACCESS_OTP_RATE_LIMIT_PATH,
} from '../../shared';

// OTP is intentionally accepted only via the `x-otp` header to keep the secret
// out of POST body request logs (Sentry breadcrumbs, WAF, Next.js logger).
const SELF_REPORT_EVENT_SUBJECT = '外部共有ポータルから自己申告を受信';

const createSelfReportSchema = z.object({
  reported_by_name: z.string().trim().min(1, '報告者氏名は必須です'),
  relation: z.string().trim().max(100).optional(),
  category: z.string().trim().min(1, 'カテゴリは必須です').max(100),
  subject: z.string().trim().min(1, '件名は必須です').max(200),
  content: z.string().trim().min(1, '内容は必須です').max(4000),
  requested_callback: z.boolean().default(false),
  preferred_contact_time: z.string().trim().max(200).optional(),
});

function containsBodyOtp(payload: Record<string, unknown>) {
  return Object.prototype.hasOwnProperty.call(payload, 'otp');
}

function readOptionalText(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function hashJson(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function buildSelfReportIdempotencyKeyHash(args: { grantId: string; idempotencyKey: string }) {
  return `patient-self-report:v1:${hashJson({
    purpose: 'external_self_report_idempotency_key',
    external_access_grant_id: args.grantId,
    idempotency_key: args.idempotencyKey,
  })}`;
}

function buildSelfReportRequestFingerprint(args: {
  grantId: string;
  patientId: string;
  data: z.infer<typeof createSelfReportSchema>;
}) {
  return `patient-self-report-request:v1:${hashJson({
    action: 'patient_self_report.create',
    external_access_grant_id: args.grantId,
    patient_id: args.patientId,
    reported_by_name: args.data.reported_by_name,
    relation: readOptionalText(args.data.relation),
    category: args.data.category,
    subject: args.data.subject,
    content: args.data.content,
    requested_callback: args.data.requested_callback,
    preferred_contact_time: readOptionalText(args.data.preferred_contact_time),
  })}`;
}

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

function isMatchingSelfReportReplay(
  report: { request_fingerprint: string | null },
  requestFingerprint: string,
) {
  return report.request_fingerprint === requestFingerprint;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token: rawToken } = await params;
  const token = normalizeRequiredRouteParam(rawToken);
  if (!token) return validationError('共有リンクトークンが不正です');

  const ip = getClientIp(req) ?? 'unknown';
  const rateLimit = await checkAuthRateLimit(
    createExternalAccessOtpRateLimitIdentifier(token, ip),
    EXTERNAL_ACCESS_OTP_RATE_LIMIT_PATH,
  );
  if (!rateLimit.allowed) {
    return error(
      'RATE_LIMIT_EXCEEDED',
      'リクエストが多すぎます。しばらく待ってから再試行してください。',
      429,
    );
  }

  const payload = await readJsonObjectRequestBody(req);

  if (!payload) {
    return validationError('リクエストボディが不正です');
  }

  if (containsBodyOtp(payload)) {
    return validationError('OTPはリクエストボディではなくヘッダーで送信してください');
  }

  const parsed = createSelfReportSchema.safeParse(payload);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const parsedIdempotencyKey = parseOptionalIdempotencyKey(req.headers.get('idempotency-key'));
  if (!parsedIdempotencyKey.ok) {
    return validationError(parsedIdempotencyKey.message);
  }

  const otp = req.headers.get('x-otp') ?? undefined;
  const validation = await validateExternalAccessGrant(token, otp);

  if (!validation.ok) {
    if (validation.kind === 'validation') {
      return validationError(validation.message);
    }

    return notFound(validation.message);
  }

  const idempotencyKeyHash = parsedIdempotencyKey.key
    ? buildSelfReportIdempotencyKeyHash({
        grantId: validation.grant.id,
        idempotencyKey: parsedIdempotencyKey.key,
      })
    : null;
  const requestFingerprint = parsedIdempotencyKey.key
    ? buildSelfReportRequestFingerprint({
        grantId: validation.grant.id,
        patientId: validation.grant.patient_id,
        data: parsed.data,
      })
    : null;

  const result = await withOrgContext(validation.grant.org_id, async (tx) => {
    const findExistingReport = () =>
      idempotencyKeyHash && requestFingerprint
        ? tx.patientSelfReport.findFirst({
            where: {
              org_id: validation.grant.org_id,
              external_access_grant_id: validation.grant.id,
              idempotency_key_hash: idempotencyKeyHash,
            },
            select: {
              id: true,
              request_fingerprint: true,
            },
          })
        : Promise.resolve(null);

    const existing = await findExistingReport();
    if (existing) {
      return isMatchingSelfReportReplay(existing, requestFingerprint ?? '')
        ? { kind: 'replayed' as const }
        : { kind: 'idempotency_conflict' as const };
    }

    const createData = {
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
      idempotency_key_hash: idempotencyKeyHash,
      request_fingerprint: requestFingerprint,
    };

    try {
      await tx.patientSelfReport.create({
        data: createData,
        select: {
          id: true,
          request_fingerprint: true,
        },
      });
    } catch (createError) {
      if (!idempotencyKeyHash || !requestFingerprint || !isUniqueConstraintError(createError)) {
        throw createError;
      }
      const raced = await findExistingReport();
      if (raced && isMatchingSelfReportReplay(raced, requestFingerprint ?? '')) {
        return { kind: 'replayed' as const };
      }
      return { kind: 'idempotency_conflict' as const };
    }

    await tx.communicationEvent.create({
      data: {
        org_id: validation.grant.org_id,
        patient_id: validation.grant.patient_id,
        event_type: 'patient_self_report',
        channel: 'phone',
        direction: 'inbound',
        counterpart_name: null,
        counterpart_contact: null,
        subject: SELF_REPORT_EVENT_SUBJECT,
        content: null,
      },
    });

    return { kind: 'created' as const };
  });

  if (result.kind === 'idempotency_conflict') {
    return error('IDEMPOTENCY_CONFLICT', 'Idempotency-Keyが別の自己申告で使用されています', 409, {
      reason: 'key_reused_with_different_request',
    });
  }

  return success(
    {
      data: {
        accepted: true,
        replayed: result.kind === 'replayed',
      },
    },
    result.kind === 'created' ? 201 : 200,
  );
}
