import { NextRequest } from 'next/server';
import { requireAuthContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { prisma } from '@/lib/db/client';
import { success, validationError, notFound } from '@/lib/api/response';
import {
  pharmacySiteInsuranceConfigCreateSchema,
  rangesOverlap,
} from '@/lib/validations/pharmacy-site-insurance-config';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuthContext(req, {
    permission: 'canAdmin',
    message: '保険設定の閲覧権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;

  const { id } = await params;
  const site = await prisma.pharmacySite.findFirst({
    where: { id, org_id: ctx.orgId },
    select: { id: true },
  });
  if (!site) return notFound('薬局情報が見つかりません');

  const configs = await prisma.pharmacySiteInsuranceConfig.findMany({
    where: { site_id: id, org_id: ctx.orgId },
    orderBy: [{ insurance_type: 'asc' }, { effective_from: 'desc' }],
  });

  return success({ data: configs });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuthContext(req, {
    permission: 'canAdmin',
    message: '保険設定の作成権限がありません',
  });
  if ('response' in authResult) return authResult.response;
  const ctx = authResult.ctx;

  const body = await req.json().catch(() => null);
  if (!body) return validationError('リクエストボディが不正です');

  const parsed = pharmacySiteInsuranceConfigCreateSchema.safeParse(body);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const { id } = await params;
  const site = await prisma.pharmacySite.findFirst({
    where: { id, org_id: ctx.orgId },
    select: { id: true },
  });
  if (!site) return notFound('薬局情報が見つかりません');

  const existing = await prisma.pharmacySiteInsuranceConfig.findFirst({
    where: {
      org_id: ctx.orgId,
      site_id: id,
      insurance_type: parsed.data.insurance_type,
      revision_code: parsed.data.revision_code,
    },
    select: { id: true },
  });
  if (existing) {
    return validationError('同じ保険種別・改定年度の設定が既に存在します');
  }

  const nextStart = new Date(parsed.data.effective_from);
  const nextEnd = parsed.data.effective_to ? new Date(parsed.data.effective_to) : null;
  const overlappingConfigs = await prisma.pharmacySiteInsuranceConfig.findMany({
    where: {
      org_id: ctx.orgId,
      site_id: id,
      insurance_type: parsed.data.insurance_type,
    },
  });
  if (
    overlappingConfigs.some((config) =>
      rangesOverlap({
        nextStart,
        nextEnd,
        currentStart: config.effective_from,
        currentEnd: config.effective_to,
      })
    )
  ) {
    return validationError('同一保険種別で適用期間が重複する設定は登録できません');
  }

  const config = await withOrgContext(ctx.orgId, async (tx) => {
    const created = await tx.pharmacySiteInsuranceConfig.create({
      data: {
        org_id: ctx.orgId,
        site_id: id,
        insurance_type: parsed.data.insurance_type,
        revision_code: parsed.data.revision_code,
        revision_label: parsed.data.revision_label ?? null,
        effective_from: nextStart,
        effective_to: nextEnd,
        config: parsed.data.config,
      },
    });

    await tx.auditLog.create({
      data: {
        org_id: ctx.orgId,
        actor_id: ctx.userId,
        action: 'insurance_config_created',
        target_type: 'PharmacySiteInsuranceConfig',
        target_id: created.id,
        changes: {
          insurance_type: parsed.data.insurance_type,
          revision_code: parsed.data.revision_code,
        },
        ip_address: ctx.ipAddress,
        user_agent: ctx.userAgent,
      },
    });

    return created;
  });

  return success({ data: config }, 201);
}
