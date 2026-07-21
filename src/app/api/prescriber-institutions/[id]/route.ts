import { withAuthContext } from '@/lib/auth/context';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError, notFound } from '@/lib/api/response';
import { updatePrescriberInstitutionSchema } from '@/lib/validations/prescriber-institution';

function toResponse(item: {
  id: string;
  name: string;
  institution_code: string | null;
  address: string | null;
  phone: string | null;
  fax: string | null;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
  _count?: {
    prescription_intakes: number;
  };
  prescription_intakes?: Array<{
    id: string;
    prescribed_date: Date;
    cycle_id: string;
    cycle: {
      patient_id: string;
      case_id: string;
      case_: {
        patient: {
          name: string;
        };
      } | null;
    };
  }>;
}) {
  return {
    ...item,
    prescription_count: item._count?.prescription_intakes ?? 0,
    recent_prescriptions:
      item.prescription_intakes?.map((intake) => ({
        intake_id: intake.id,
        cycle_id: intake.cycle_id,
        patient_id: intake.cycle.patient_id,
        case_id: intake.cycle.case_id,
        patient_name: intake.cycle.case_?.patient.name ?? null,
        prescribed_date: intake.prescribed_date.toISOString(),
      })) ?? [],
    created_at: item.created_at.toISOString(),
    updated_at: item.updated_at.toISOString(),
  };
}

const authenticatedGET = withAuthContext(
  async (_req, ctx, { params }) => {
    const { id: rawId } = await params;
    const id = normalizeRequiredRouteParam(rawId);
    if (!id) return validationError('医療機関IDが不正です');

    const item = await withOrgContext(
      ctx.orgId,
      (tx) =>
        tx.prescriberInstitution.findFirst({
          where: {
            id,
            org_id: ctx.orgId,
          },
          include: {
            _count: {
              select: {
                prescription_intakes: true,
              },
            },
            prescription_intakes: {
              orderBy: [{ prescribed_date: 'desc' }, { created_at: 'desc' }],
              take: 10,
              select: {
                id: true,
                prescribed_date: true,
                cycle_id: true,
                cycle: {
                  select: {
                    patient_id: true,
                    case_id: true,
                    case_: {
                      select: {
                        patient: {
                          select: {
                            name: true,
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        }),
      { requestContext: ctx },
    );

    if (!item) return notFound('医療機関が見つかりません');
    return success({ data: toResponse(item) });
  },
  {
    permission: 'canReport',
    message: '医療機関マスターの閲覧権限がありません',
  },
);

export const GET = authenticatedGET;

export const PATCH = withAuthContext(
  async (req, ctx, { params }) => {
    const { id: rawId } = await params;
    const id = normalizeRequiredRouteParam(rawId);
    if (!id) return validationError('医療機関IDが不正です');

    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = updatePrescriberInstitutionSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const updated = await withOrgContext(
      ctx.orgId,
      async (tx) => {
        const existing = await tx.prescriberInstitution.findFirst({
          where: { id, org_id: ctx.orgId },
          select: { id: true },
        });
        if (!existing) return null;

        return tx.prescriberInstitution.update({
          where: { id },
          data: {
            ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
            ...(parsed.data.institution_code !== undefined
              ? { institution_code: parsed.data.institution_code || null }
              : {}),
            ...(parsed.data.address !== undefined ? { address: parsed.data.address || null } : {}),
            ...(parsed.data.phone !== undefined ? { phone: parsed.data.phone || null } : {}),
            ...(parsed.data.fax !== undefined ? { fax: parsed.data.fax || null } : {}),
            ...(parsed.data.notes !== undefined ? { notes: parsed.data.notes || null } : {}),
          },
        });
      },
      { requestContext: ctx },
    );

    if (!updated) return notFound('医療機関が見つかりません');
    return success({ data: toResponse(updated) });
  },
  {
    permission: 'canAdmin',
    message: '医療機関マスターの更新権限がありません',
  },
);

export const DELETE = withAuthContext(
  async (_req, ctx, { params }) => {
    const { id: rawId } = await params;
    const id = normalizeRequiredRouteParam(rawId);
    if (!id) return validationError('医療機関IDが不正です');

    const deleted = await withOrgContext(
      ctx.orgId,
      async (tx) => {
        const existing = await tx.prescriberInstitution.findFirst({
          where: { id, org_id: ctx.orgId },
          select: { id: true },
        });
        if (!existing) return false;

        await tx.prescriptionIntake.updateMany({
          where: {
            org_id: ctx.orgId,
            prescriber_institution_id: id,
          },
          data: {
            prescriber_institution_id: null,
          },
        });

        await tx.prescriberInstitution.delete({
          where: { id },
        });
        return true;
      },
      { requestContext: ctx },
    );

    if (!deleted) return notFound('医療機関が見つかりません');
    return success({ data: { id } });
  },
  {
    permission: 'canAdmin',
    message: '医療機関マスターの削除権限がありません',
  },
);
