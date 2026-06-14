import { z } from 'zod';
import { withAuthContext } from '@/lib/auth/context';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { success, validationError, notFound } from '@/lib/api/response';
import { withOrgContext } from '@/lib/db/rls';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { prisma } from '@/lib/db/client';
import {
  CONTACT_METHOD_OPTIONS,
  listContactProfiles,
  updateContactProfile,
} from '@/lib/contact-profiles';

export const GET = withAuthContext(
  async (req, ctx) => {
    const kind =
      (req.nextUrl.searchParams.get('kind')?.trim() as
        | 'all'
        | 'facility_contact'
        | 'external_professional'
        | 'prescriber_institution'
        | null) ?? 'all';
    const query = req.nextUrl.searchParams.get('q')?.trim() || null;

    const data = await listContactProfiles(prisma, ctx.orgId, {
      kind,
      query,
    });

    return success({
      data: data.map((item) => ({
        ...item,
        last_contacted_at: item.last_contacted_at?.toISOString() ?? null,
      })),
    });
  },
  {
    permission: 'canReport',
    message: '連携先プロファイルの閲覧権限がありません',
  },
);

const nullableTrimmed = z
  .string()
  .trim()
  .max(255, '255文字以内で入力してください')
  .nullable()
  .optional();

const updateContactProfileSchema = z.object({
  kind: z.enum(['facility_contact', 'external_professional', 'prescriber_institution']),
  id: z.string().min(1, '連携先IDは必須です'),
  name: z.string().trim().min(1, '宛先は必須です').max(255, '255文字以内で入力してください').optional(),
  role: nullableTrimmed,
  department: nullableTrimmed,
  phone: nullableTrimmed,
  email: nullableTrimmed,
  fax: nullableTrimmed,
  preferred_contact_method: z.enum(CONTACT_METHOD_OPTIONS).nullable().optional(),
  preferred_contact_time: nullableTrimmed,
});

export const PATCH = withAuthContext(
  async (req, ctx) => {
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = updateContactProfileSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const { kind, id, ...input } = parsed.data;

    const result = await withOrgContext(
      ctx.orgId,
      async (tx) => {
        const updated = await updateContactProfile(tx, ctx.orgId, kind, id, input);
        if (!updated) return null;

        await createAuditLogEntry(tx, ctx, {
          action: 'contact_profile_updated',
          targetType: 'ContactProfile',
          targetId: id,
          changes: {
            kind,
            updated_fields: Object.keys(input),
            preferred_contact_method: input.preferred_contact_method,
          },
        });

        return updated.after;
      },
      { requestContext: ctx },
    );

    if (!result) return notFound('連携先が見つかりません');

    return success({ data: result });
  },
  {
    permission: 'canReport',
    message: '連携先プロファイルの編集権限がありません',
  },
);
