import { withAuthContext } from '@/lib/auth/context';
import { hasPermission } from '@/lib/auth/permissions';
import { deriveFacilityLabel } from '@/lib/utils/facility';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError, notFound, forbidden } from '@/lib/api/response';
import { createAuditLogEntry } from '@/lib/audit/audit-entry';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { normalizeRequiredRouteParam } from '@/lib/api/route-params';
import { prisma } from '@/lib/db/client';
import { generateDispensePrefill } from '@/lib/dispensing/prefill-generator';
import { notifyWorkflowMutation } from '@/server/services/workflow-dashboard-cache';
import { buildMedicationCycleAssignmentWhere } from '@/server/services/prescription-access';
import { z } from 'zod';

const updateDispenseTaskSchema = z.object({
  assigned_to: z.string().optional(),
  priority: z.enum(['emergency', 'urgent', 'normal']).optional(),
  due_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}/)
    .nullable()
    .optional(),
  status: z.enum(['pending', 'in_progress', 'completed']).optional(),
});

// Status transition order: pending → in_progress → completed (no reversal)
const STATUS_ORDER: Record<string, number> = {
  pending: 0,
  in_progress: 1,
  completed: 2,
};

function uniqueNonEmpty(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value?.trim()))));
}

async function resolveDispenseSite(orgId: string, userId: string) {
  const membership = await prisma.membership.findFirst({
    where: {
      org_id: orgId,
      user_id: userId,
      is_active: true,
    },
    select: {
      site_id: true,
      user: {
        select: {
          default_site_id: true,
        },
      },
    },
  });

  const siteId = membership?.user.default_site_id ?? membership?.site_id ?? null;
  if (!siteId) return null;

  return prisma.pharmacySite.findFirst({
    where: {
      id: siteId,
      org_id: orgId,
    },
    select: {
      id: true,
      name: true,
    },
  });
}

async function buildLineStockGuidance(input: {
  orgId: string;
  siteId: string | null;
  lines: Array<{
    id: string;
    drug_name: string;
    drug_code: string | null;
    is_generic_name_prescription?: boolean;
  }>;
}) {
  if (!input.siteId || input.lines.length === 0) return [];

  const yjCodes = uniqueNonEmpty(input.lines.map((line) => line.drug_code));
  const masters = yjCodes.length
    ? await prisma.drugMaster.findMany({
        where: {
          yj_code: { in: yjCodes },
        },
        select: {
          id: true,
          drug_name: true,
          yj_code: true,
          generic_name: true,
          is_generic: true,
        },
      })
    : [];

  const masterByYjCode = new Map(masters.map((master) => [master.yj_code, master]));
  const genericNames = uniqueNonEmpty([
    ...masters.map((master) => master.generic_name),
    ...input.lines
      .filter((line) => line.is_generic_name_prescription)
      .map((line) => line.drug_name),
  ]);

  if (masters.length === 0 && genericNames.length === 0) return [];

  const stockEntries = await prisma.pharmacyDrugStock.findMany({
    where: {
      org_id: input.orgId,
      site_id: input.siteId,
      is_stocked: true,
      OR: [
        ...(masters.length > 0
          ? [
              {
                drug_master_id: {
                  in: masters.map((master) => master.id),
                },
              },
            ]
          : []),
        ...(genericNames.length > 0
          ? [
              {
                drug_master: {
                  generic_name: {
                    in: genericNames,
                  },
                },
              },
            ]
          : []),
      ],
    },
    select: {
      drug_master_id: true,
      preferred_generic_id: true,
      drug_master: {
        select: {
          id: true,
          drug_name: true,
          yj_code: true,
          generic_name: true,
          is_generic: true,
        },
      },
      preferred_generic: {
        select: {
          id: true,
          drug_name: true,
          yj_code: true,
        },
      },
    },
  });

  return input.lines.map((line) => {
    const exactMaster = line.drug_code ? (masterByYjCode.get(line.drug_code) ?? null) : null;
    const genericName =
      exactMaster?.generic_name ??
      (line.is_generic_name_prescription ? line.drug_name.trim() : null);
    const exactStock = exactMaster
      ? (stockEntries.find((entry) => entry.drug_master_id === exactMaster.id) ?? null)
      : null;
    const relatedStocks = genericName
      ? stockEntries.filter((entry) => entry.drug_master.generic_name === genericName)
      : exactStock
        ? [exactStock]
        : [];

    const preferredGeneric =
      exactStock?.preferred_generic ??
      relatedStocks.find((entry) => entry.preferred_generic)?.preferred_generic ??
      null;

    const candidateMap = new Map<
      string,
      {
        drug_master_id: string;
        drug_name: string;
        yj_code: string;
        source: 'exact' | 'preferred_generic' | 'alternative';
      }
    >();

    if (exactStock) {
      candidateMap.set(exactStock.drug_master.id, {
        drug_master_id: exactStock.drug_master.id,
        drug_name: exactStock.drug_master.drug_name,
        yj_code: exactStock.drug_master.yj_code,
        source: 'exact',
      });
    }
    if (preferredGeneric) {
      candidateMap.set(preferredGeneric.id, {
        drug_master_id: preferredGeneric.id,
        drug_name: preferredGeneric.drug_name,
        yj_code: preferredGeneric.yj_code,
        source: 'preferred_generic',
      });
    }
    for (const entry of relatedStocks) {
      candidateMap.set(entry.drug_master.id, {
        drug_master_id: entry.drug_master.id,
        drug_name: entry.drug_master.drug_name,
        yj_code: entry.drug_master.yj_code,
        source: entry.preferred_generic_id != null ? 'preferred_generic' : 'alternative',
      });
    }

    const stockedCandidates = Array.from(candidateMap.values());
    const recommendedCandidate = preferredGeneric
      ? stockedCandidates.find((candidate) => candidate.drug_master_id === preferredGeneric.id)
      : exactStock
        ? stockedCandidates.find(
            (candidate) => candidate.drug_master_id === exactStock.drug_master.id,
          )
        : stockedCandidates[0];

    let stockStatus: 'stocked' | 'preferred_generic' | 'alternative_available' | 'out_of_stock' =
      'out_of_stock';
    if (exactStock) {
      stockStatus =
        line.is_generic_name_prescription && preferredGeneric ? 'preferred_generic' : 'stocked';
    } else if (preferredGeneric) {
      stockStatus = 'preferred_generic';
    } else if (stockedCandidates.length > 0) {
      stockStatus = 'alternative_available';
    }

    const message =
      stockStatus === 'stocked'
        ? '在庫あり'
        : stockStatus === 'preferred_generic'
          ? '採用後発品を優先候補として提示します'
          : stockStatus === 'alternative_available'
            ? '欠品時の代替候補があります'
            : '在庫未登録です';

    return {
      line_id: line.id,
      stock_status: stockStatus,
      message,
      recommended_drug_name: recommendedCandidate?.drug_name ?? null,
      recommended_drug_code: recommendedCandidate?.yj_code ?? null,
      stocked_candidates: stockedCandidates,
    };
  });
}

export const GET = withAuthContext(async (_req, ctx, { params }) => {
  const { id: rawId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return validationError('調剤タスクIDが不正です');

  const cycleAssignmentWhere = buildMedicationCycleAssignmentWhere(ctx);

  const task = await prisma.dispenseTask.findFirst({
    where: {
      id,
      org_id: ctx.orgId,
      ...(cycleAssignmentWhere ? { cycle: cycleAssignmentWhere } : {}),
    },
    include: {
      results: {
        select: {
          id: true,
          line_id: true,
          actual_drug_name: true,
          actual_drug_code: true,
          actual_quantity: true,
          actual_unit: true,
          discrepancy_reason: true,
          carry_type: true,
          special_notes: true,
          dispensed_at: true,
          line: {
            select: {
              id: true,
              line_number: true,
              drug_name: true,
              drug_code: true,
              dosage_form: true,
              dose: true,
              frequency: true,
              days: true,
              quantity: true,
              unit: true,
              is_generic: true,
              is_generic_name_prescription: true,
              packaging_instructions: true,
              notes: true,
              start_date: true,
              end_date: true,
            },
          },
        },
      },
      audits: true,
      cycle: {
        select: {
          id: true,
          patient_id: true,
          overall_status: true,
          case_: {
            select: {
              id: true,
              primary_pharmacist_id: true,
              patient: {
                select: {
                  id: true,
                  name: true,
                  name_kana: true,
                  residences: {
                    where: { is_primary: true },
                    take: 1,
                    select: {
                      building_id: true,
                      address: true,
                      unit_name: true,
                    },
                  },
                },
              },
            },
          },
          inquiries: {
            where: {
              OR: [{ result: null }, { result: 'pending' }],
            },
            orderBy: [{ inquired_at: 'desc' }, { created_at: 'desc' }],
            select: {
              id: true,
              line_id: true,
              reason: true,
              inquiry_to_physician: true,
              inquiry_content: true,
              result: true,
              proposal_origin: true,
              residual_adjustment: true,
              change_detail: true,
              line: {
                select: {
                  id: true,
                  line_number: true,
                  drug_name: true,
                },
              },
            },
          },
          prescription_intakes: {
            orderBy: { created_at: 'desc' },
            take: 2,
            select: {
              id: true,
              source_type: true,
              prescribed_date: true,
              prescriber_name: true,
              prescriber_institution: true,
              original_document_url: true,
              original_collected_at: true,
              jahis_supplemental_records: {
                orderBy: [{ line_number: 'asc' }, { created_at: 'asc' }],
                select: {
                  id: true,
                  record_type: true,
                  record_label: true,
                  line_number: true,
                  summary: true,
                  payload: true,
                  raw_line: true,
                },
              },
              lines: {
                orderBy: { line_number: 'asc' },
                select: {
                  id: true,
                  line_number: true,
                  drug_name: true,
                  drug_code: true,
                  dosage_form: true,
                  dose: true,
                  frequency: true,
                  days: true,
                  quantity: true,
                  unit: true,
                  is_generic: true,
                  is_generic_name_prescription: true,
                  packaging_instructions: true,
                  notes: true,
                  start_date: true,
                  end_date: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (!task) return notFound('タスクが見つかりません');

  const site = await resolveDispenseSite(ctx.orgId, ctx.userId);
  const intake = task.cycle.prescription_intakes[0] ?? null;
  const stockGuidance = await buildLineStockGuidance({
    orgId: ctx.orgId,
    siteId: site?.id ?? null,
    lines:
      intake?.lines.map((line) => ({
        id: line.id,
        drug_name: line.drug_name,
        drug_code: line.drug_code,
        is_generic_name_prescription: line.is_generic_name_prescription,
      })) ?? [],
  });
  const primaryResidence = task.cycle.case_.patient.residences[0] ?? null;
  const facilityLabel = deriveFacilityLabel(primaryResidence ?? null);

  // Keep packaging groups/date warnings available for downstream audit/detail views
  // even after results exist, while the form still decides whether to use prefill data.
  const prefill = await generateDispensePrefill(task.cycle_id, ctx.orgId, site?.id ?? null).catch(
    () => null,
  );

  return success({
    ...task,
    facility_label: facilityLabel,
    site,
    stock_guidance: stockGuidance,
    prefill,
    original_collection_check: intake
      ? {
          required: intake.source_type === 'fax',
          collected: intake.original_collected_at != null,
          collected_at: intake.original_collected_at,
        }
      : {
          required: false,
          collected: false,
          collected_at: null,
        },
  });
});

export const PATCH = withAuthContext(async (req, ctx, { params }) => {
  if (!hasPermission(ctx.role, 'canDispense')) {
    return forbidden('調剤タスクの更新権限がありません');
  }

  const { id: rawId } = await params;
  const id = normalizeRequiredRouteParam(rawId);
  if (!id) return validationError('調剤タスクIDが不正です');

  const payload = await readJsonObjectRequestBody(req);
  if (!payload) return validationError('リクエストボディが不正です');

  const parsed = updateDispenseTaskSchema.safeParse(payload);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const { assigned_to, priority, due_date, status } = parsed.data;
  const cycleAssignmentWhere = buildMedicationCycleAssignmentWhere(ctx);

  const existing = await prisma.dispenseTask.findFirst({
    where: {
      id,
      org_id: ctx.orgId,
      ...(cycleAssignmentWhere ? { cycle: cycleAssignmentWhere } : {}),
    },
    select: { id: true, status: true, assigned_to: true },
  });
  if (!existing) return notFound('タスクが見つかりません');

  // Validate status transition: no reversal allowed
  if (status !== undefined) {
    const currentOrder = STATUS_ORDER[existing.status] ?? 0;
    const nextOrder = STATUS_ORDER[status] ?? 0;
    if (nextOrder < currentOrder) {
      return validationError(
        `ステータス "${existing.status}" から "${status}" への遷移は許可されていません`,
        { current: existing.status, requested: status },
      );
    }
  }

  // Auto-assign current user when transitioning to in_progress without assignee
  let resolvedAssignedTo = assigned_to;
  if (status === 'in_progress' && resolvedAssignedTo === undefined) {
    if (!existing.assigned_to) {
      resolvedAssignedTo = ctx.userId;
    }
  }

  const statusChanged = status !== undefined && status !== existing.status;

  const updated = await withOrgContext(ctx.orgId, async (tx) => {
    const result = await tx.dispenseTask.update({
      where: { id },
      data: {
        ...(resolvedAssignedTo !== undefined ? { assigned_to: resolvedAssignedTo } : {}),
        ...(priority !== undefined ? { priority } : {}),
        ...(due_date !== undefined ? { due_date: due_date ? new Date(due_date) : null } : {}),
        ...(status !== undefined ? { status } : {}),
      },
      include: {
        results: true,
        audits: true,
        cycle: {
          select: {
            id: true,
            patient_id: true,
            overall_status: true,
            case_: {
              select: {
                id: true,
                patient: {
                  select: {
                    id: true,
                    name: true,
                    name_kana: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (statusChanged) {
      await createAuditLogEntry(tx, ctx, {
        action: 'dispense_task_status_changed',
        targetType: 'DispenseTask',
        targetId: id,
        changes: { from: existing.status, to: status },
      });
    }

    return result;
  });

  await notifyWorkflowMutation({
    orgId: ctx.orgId,
    payload: {
      source: 'dispense_tasks_update',
      task_id: id,
      ...(status !== undefined ? { status } : {}),
    },
  });

  return success(updated);
});
