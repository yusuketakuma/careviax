import { NextRequest } from 'next/server';
import { z } from 'zod';
import { withAuthContext } from '@/lib/auth/context';
import { conflict, notFound, success, validationError } from '@/lib/api/response';
import { parseSearchParams } from '@/lib/api/validation';
import { prisma } from '@/lib/db/client';

const requestQuerySchema = z.object({
  site_id: z.string().trim().min(1).optional(),
  drug_master_id: z.string().trim().min(1).optional(),
  status: z.enum(['pending', 'approved', 'rejected']).default('pending'),
  overdue_days: z.coerce.number().int().min(1).max(90).default(7),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

const requestPayloadSchema = z.object({
  site_id: z.string().trim().min(1, 'site_id は必須です'),
  drug_master_id: z.string().trim().min(1, 'drug_master_id は必須です'),
  action_type: z.enum(['adopt', 'deactivate', 'update_settings']).default('update_settings'),
  requested_payload: z.object({
    is_stocked: z.boolean(),
    reorder_point: z.number().int().min(0).nullable().optional(),
    preferred_generic_id: z.string().trim().nullable().optional(),
    adoption_note: z.string().trim().max(500).nullable().optional(),
  }),
  reason: z.string().trim().max(500).nullable().optional(),
});

export const GET = withAuthContext(
  async (req: NextRequest, authCtx) => {
    const parsed = parseSearchParams(requestQuerySchema, new URL(req.url).searchParams);
    if (!parsed.ok) {
      return validationError('クエリパラメータが不正です', parsed.error.flatten().fieldErrors);
    }

    if (parsed.data.site_id) {
      const site = await prisma.pharmacySite.findFirst({
        where: { id: parsed.data.site_id, org_id: authCtx.orgId },
        select: { id: true },
      });
      if (!site) return notFound('対象の薬局拠点が見つかりません');
    }

    const baseWhere = {
      org_id: authCtx.orgId,
      status: parsed.data.status,
      ...(parsed.data.site_id ? { site_id: parsed.data.site_id } : {}),
      ...(parsed.data.drug_master_id ? { drug_master_id: parsed.data.drug_master_id } : {}),
    };
    const overdueCutoff = new Date();
    overdueCutoff.setDate(overdueCutoff.getDate() - parsed.data.overdue_days);
    const [requests, totalCount, overdueCount, oldestPending] = await Promise.all([
      prisma.formularyChangeRequest.findMany({
        where: baseWhere,
        orderBy: [{ created_at: 'desc' }],
        take: parsed.data.limit,
      }),
      prisma.formularyChangeRequest.count({
        where: baseWhere,
      }),
      parsed.data.status === 'pending'
        ? prisma.formularyChangeRequest.count({
            where: {
              ...baseWhere,
              created_at: { lt: overdueCutoff },
            },
          })
        : Promise.resolve(0),
      parsed.data.status === 'pending'
        ? prisma.formularyChangeRequest.findFirst({
            where: baseWhere,
            orderBy: [{ created_at: 'asc' }],
            select: { created_at: true },
          })
        : Promise.resolve(null),
    ]);

    return success({
      data: requests,
      summary: {
        status: parsed.data.status,
        total_count: totalCount,
        overdue_count: overdueCount,
        overdue_days: parsed.data.overdue_days,
        oldest_pending_created_at: oldestPending?.created_at?.toISOString() ?? null,
        notification_level:
          overdueCount > 0 ? 'overdue' : totalCount > 0 ? 'pending' : 'clear',
      },
    });
  },
  { permission: 'canAdmin' },
);

export const POST = withAuthContext(
  async (req: NextRequest, authCtx) => {
    const body = await req.json().catch(() => null);
    if (!body) return validationError('リクエストボディが不正です');

    const parsed = requestPayloadSchema.safeParse(body);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const { site_id, drug_master_id, requested_payload } = parsed.data;
    const [site, drug, preferredGeneric, currentStock, pendingRequest] = await Promise.all([
      prisma.pharmacySite.findFirst({
        where: { id: site_id, org_id: authCtx.orgId },
        select: { id: true, name: true },
      }),
      prisma.drugMaster.findFirst({
        where: { id: drug_master_id },
        select: { id: true, drug_name: true, generic_name: true },
      }),
      requested_payload.preferred_generic_id
        ? prisma.drugMaster.findFirst({
            where: { id: requested_payload.preferred_generic_id },
            select: { id: true, is_generic: true, generic_name: true },
          })
        : Promise.resolve(null),
      prisma.pharmacyDrugStock.findFirst({
        where: { org_id: authCtx.orgId, site_id, drug_master_id },
        select: {
          id: true,
          is_stocked: true,
          reorder_point: true,
          preferred_generic_id: true,
          adoption_note: true,
        },
      }),
      prisma.formularyChangeRequest.findFirst({
        where: {
          org_id: authCtx.orgId,
          site_id,
          drug_master_id,
          status: 'pending',
        },
        select: { id: true, created_at: true },
      }),
    ]);

    if (!site) return notFound('対象の薬局拠点が見つかりません');
    if (!drug) return notFound('対象の医薬品が見つかりません');
    if (pendingRequest) {
      return conflict('同じ拠点・医薬品の未決裁申請がすでに存在します', {
        request_id: pendingRequest.id,
        created_at: pendingRequest.created_at.toISOString(),
      });
    }
    if (requested_payload.preferred_generic_id && !preferredGeneric) {
      return validationError('採用後発薬が見つかりません', {
        preferred_generic_id: ['存在する後発品を選択してください'],
      });
    }
    if (preferredGeneric && !preferredGeneric.is_generic) {
      return validationError('採用後発薬には後発品のみ指定できます', {
        preferred_generic_id: ['後発品を選択してください'],
      });
    }
    if (
      preferredGeneric &&
      drug.generic_name &&
      preferredGeneric.generic_name &&
      drug.generic_name !== preferredGeneric.generic_name
    ) {
      return validationError('採用後発薬は同一一般名から選択してください', {
        preferred_generic_id: ['同じ一般名の後発品を選択してください'],
      });
    }

    const request = await prisma.$transaction(async (tx) => {
      const created = await tx.formularyChangeRequest.create({
        data: {
          org_id: authCtx.orgId,
          site_id,
          drug_master_id,
          requested_by_id: authCtx.userId,
          action_type: parsed.data.action_type,
          requested_payload,
          ...(currentStock ? { current_snapshot: currentStock } : {}),
          reason: parsed.data.reason ?? null,
        },
      });

      await tx.auditLog.create({
        data: {
          org_id: authCtx.orgId,
          actor_id: authCtx.userId,
          action: 'pharmacy_drug_stock_change_requested',
          target_type: 'FormularyChangeRequest',
          target_id: created.id,
          changes: {
            site_id,
            drug_master_id,
            action_type: parsed.data.action_type,
            requested_payload,
            current_snapshot: currentStock,
          },
          ip_address: authCtx.ipAddress,
          user_agent: authCtx.userAgent,
        },
      });

      return created;
    });

    return success({ site, drug, data: request }, 201);
  },
  { permission: 'canAdmin' },
);
