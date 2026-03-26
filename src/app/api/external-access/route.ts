import { NextRequest } from 'next/server';
import { createHash, randomInt } from 'crypto';
import { withAuthContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import { z } from 'zod';

const createGrantSchema = z.object({
  patient_id: z.string().min(1),
  granted_to_name: z.string().min(1, '共有先氏名は必須です'),
  granted_to_contact: z.string().optional(),
  scope: z.record(z.boolean()),
  expires_hours: z.number().int().min(1).max(720).default(72),
});

export const GET = withAuthContext(
  async (_req: NextRequest, ctx) => {
    const grants = await prisma.externalAccessGrant.findMany({
      where: {
        org_id: ctx.orgId,
        revoked_at: null,
      },
      orderBy: { created_at: 'desc' },
      select: {
        id: true,
        org_id: true,
        patient_id: true,
        granted_to_name: true,
        granted_to_contact: true,
        scope: true,
        expires_at: true,
        accessed_at: true,
        created_at: true,
      },
    });

    return success({ data: grants });
  },
  {
    permission: 'canReport',
    message: '外部共有の閲覧権限がありません',
  }
);

export const POST = withAuthContext(
  async (req: NextRequest, ctx) => {
    const body = await req.json().catch(() => null);
    if (!body) return validationError('リクエストボディが不正です');

    const parsed = createGrantSchema.safeParse(body);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const { patient_id, granted_to_name, granted_to_contact, scope, expires_hours } =
      parsed.data;

    // Generate raw token and OTP — only hashes are persisted
    const rawToken = crypto.randomUUID();
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');

    const rawOtp = randomInt(100000, 999999).toString();
    const otpHash = createHash('sha256').update(rawOtp).digest('hex');

    const expiresAt = new Date(Date.now() + expires_hours * 60 * 60 * 1000);

    const grant = await withOrgContext(ctx.orgId, async (tx) => {
      return tx.externalAccessGrant.create({
        data: {
          org_id: ctx.orgId,
          patient_id,
          token_hash: tokenHash,
          otp_hash: otpHash,
          granted_to_name,
          granted_to_contact: granted_to_contact ?? null,
          scope,
          expires_at: expiresAt,
        },
        select: {
          id: true,
          patient_id: true,
          granted_to_name: true,
          granted_to_contact: true,
          scope: true,
          expires_at: true,
          created_at: true,
        },
      });
    });

    return success(
      {
        data: {
          ...grant,
          token: rawToken,
          otp: rawOtp,
        },
      },
      201
    );
  },
  {
    permission: 'canReport',
    message: '外部共有の作成権限がありません',
  }
);
