import { NextRequest } from 'next/server';
import { z } from 'zod';
import { withAuthContext, type AuthRouteContext } from '@/lib/auth/context';
import { conflict, notFound, success, validationError } from '@/lib/api/response';
import { prisma } from '@/lib/db/client';
import { readJsonObject } from '@/lib/db/json';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import {
  formularyTemplateItemSchema,
  type FormularyTemplateItem,
} from '@/lib/validations/pharmacy-drug-stock';

const applyTemplateSchema = z.object({
  target_site_id: z.string().trim().min(1, 'target_site_id は必須です'),
  overwrite: z.boolean().default(false),
  dry_run: z.boolean().default(false),
});

function readTemplateItems(value: unknown) {
  if (!Array.isArray(value)) {
    return { items: [] as FormularyTemplateItem[], sourceItemCount: 0, invalidItemCount: 1 };
  }

  const items: FormularyTemplateItem[] = [];
  let invalidItemCount = 0;

  for (const item of value) {
    const parsed = formularyTemplateItemSchema.safeParse(readJsonObject(item));
    if (!parsed.success) {
      invalidItemCount += 1;
      continue;
    }

    items.push(parsed.data);
  }

  return { items, sourceItemCount: value.length, invalidItemCount };
}

function validateTemplateItemReferences(
  items: FormularyTemplateItem[],
  drugMasterById: Map<
    string,
    {
      id: string;
      yj_code: string;
      drug_name: string;
      is_generic?: boolean;
      generic_name?: string | null;
    }
  >,
) {
  const validItems: FormularyTemplateItem[] = [];
  const missingDrugMasterIds = new Set<string>();
  const invalidPreferredGenericIds = new Set<string>();
  let invalidReferenceItemCount = 0;

  for (const item of items) {
    const drug = drugMasterById.get(item.drug_master_id);
    if (!drug) {
      missingDrugMasterIds.add(item.drug_master_id);
      invalidReferenceItemCount += 1;
      continue;
    }

    if (item.preferred_generic_id) {
      const preferredGeneric = drugMasterById.get(item.preferred_generic_id);
      if (
        !preferredGeneric ||
        preferredGeneric.is_generic !== true ||
        (drug.generic_name &&
          preferredGeneric.generic_name &&
          drug.generic_name !== preferredGeneric.generic_name)
      ) {
        invalidPreferredGenericIds.add(item.preferred_generic_id);
        invalidReferenceItemCount += 1;
        continue;
      }
    }

    validItems.push(item);
  }

  return {
    validItems,
    invalidReferenceItemCount,
    missingDrugMasterIds: [...missingDrugMasterIds],
    invalidPreferredGenericIds: [...invalidPreferredGenericIds],
  };
}

function buildPreview({
  items,
  sourceItemCount,
  invalidItemCount,
  existingDrugIds,
  drugMasterById,
  overwrite,
}: {
  items: FormularyTemplateItem[];
  sourceItemCount: number;
  invalidItemCount: number;
  existingDrugIds: Set<string>;
  drugMasterById: Map<string, { id: string; yj_code: string; drug_name: string }>;
  overwrite: boolean;
}) {
  const rows = items.map((item) => {
    const exists = existingDrugIds.has(item.drug_master_id);
    const action = !exists ? 'create' : overwrite ? 'update' : 'skip_existing';
    return {
      action,
      drug_master_id: item.drug_master_id,
      reorder_point: item.reorder_point,
      preferred_generic_id: item.preferred_generic_id,
      drug_master: drugMasterById.get(item.drug_master_id) ?? {
        id: item.drug_master_id,
        yj_code: '',
        drug_name: '不明な医薬品',
      },
    };
  });
  const summary = {
    item_count: items.length,
    source_item_count: sourceItemCount,
    invalid_item_count: invalidItemCount,
    create_count: rows.filter((row) => row.action === 'create').length,
    update_count: rows.filter((row) => row.action === 'update').length,
    skip_existing_count: rows.filter((row) => row.action === 'skip_existing').length,
    apply_count: rows.filter((row) => row.action !== 'skip_existing').length,
  };
  return { summary, rows };
}

export const POST = withAuthContext(
  async (req: NextRequest, authCtx, ctx: AuthRouteContext<{ id: string }>) => {
    const { id } = await ctx.params;
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = applyTemplateSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const [template, targetSite] = await Promise.all([
      prisma.formularyTemplate.findFirst({
        where: { id, org_id: authCtx.orgId },
      }),
      prisma.pharmacySite.findFirst({
        where: { id: parsed.data.target_site_id, org_id: authCtx.orgId },
        select: { id: true, name: true },
      }),
    ]);
    if (!template) return notFound('採用品テンプレートが見つかりません');
    if (!targetSite) return notFound('対象の薬局拠点が見つかりません');

    const { items, sourceItemCount, invalidItemCount } = readTemplateItems(template.items);
    if (invalidItemCount > 0 && !parsed.data.dry_run) {
      return conflict('採用品テンプレートに破損した項目が含まれているため適用できません', {
        template_id: template.id,
        invalid_item_count: invalidItemCount,
      });
    }

    const itemDrugIds = items.map((item) => item.drug_master_id);
    const preferredGenericIds = items
      .map((item) => item.preferred_generic_id)
      .filter((id): id is string => id !== null);
    const referenceDrugIds = [...new Set([...itemDrugIds, ...preferredGenericIds])];
    const drugMasters = referenceDrugIds.length
      ? await prisma.drugMaster.findMany({
          where: { id: { in: referenceDrugIds } },
          select: {
            id: true,
            yj_code: true,
            drug_name: true,
            is_generic: true,
            generic_name: true,
          },
        })
      : [];
    const drugMasterById = new Map(drugMasters.map((drug) => [drug.id, drug]));
    const {
      validItems,
      invalidReferenceItemCount,
      missingDrugMasterIds,
      invalidPreferredGenericIds,
    } = validateTemplateItemReferences(items, drugMasterById);
    const totalInvalidItemCount = invalidItemCount + invalidReferenceItemCount;

    if (totalInvalidItemCount > 0 && !parsed.data.dry_run) {
      return conflict('採用品テンプレートに破損した項目が含まれているため適用できません', {
        template_id: template.id,
        invalid_item_count: totalInvalidItemCount,
        ...(missingDrugMasterIds.length ? { missing_drug_master_ids: missingDrugMasterIds } : {}),
        ...(invalidPreferredGenericIds.length
          ? { invalid_preferred_generic_ids: invalidPreferredGenericIds }
          : {}),
      });
    }

    const validItemDrugIds = validItems.map((item) => item.drug_master_id);
    const existing = validItemDrugIds.length
      ? await prisma.pharmacyDrugStock.findMany({
          where: {
            org_id: authCtx.orgId,
            site_id: targetSite.id,
            drug_master_id: { in: validItemDrugIds },
          },
          select: { drug_master_id: true },
        })
      : [];
    const existingDrugIds = new Set(existing.map((stock) => stock.drug_master_id));
    const preview = buildPreview({
      items: validItems,
      sourceItemCount,
      invalidItemCount: totalInvalidItemCount,
      existingDrugIds,
      drugMasterById,
      overwrite: parsed.data.overwrite,
    });
    const operations = validItems.filter(
      (item) => parsed.data.overwrite || !existingDrugIds.has(item.drug_master_id),
    );

    if (parsed.data.dry_run) {
      return success({
        template: { id: template.id, name: template.name },
        targetSite,
        itemCount: validItems.length,
        sourceItemCount,
        invalidItemCount: totalInvalidItemCount,
        ...(missingDrugMasterIds.length ? { missingDrugMasterIds } : {}),
        ...(invalidPreferredGenericIds.length ? { invalidPreferredGenericIds } : {}),
        appliedCount: 0,
        skippedCount: validItems.length - preview.summary.apply_count,
        overwrite: parsed.data.overwrite,
        dryRun: true,
        preview,
      });
    }

    const appliedCount = await prisma.$transaction(async (tx) => {
      let count = 0;
      for (const item of operations) {
        await tx.pharmacyDrugStock.upsert({
          where: {
            site_id_drug_master_id: {
              site_id: targetSite.id,
              drug_master_id: item.drug_master_id,
            },
          },
          create: {
            org_id: authCtx.orgId,
            site_id: targetSite.id,
            drug_master_id: item.drug_master_id,
            is_stocked: true,
            reorder_point: item.reorder_point,
            preferred_generic_id: item.preferred_generic_id,
            adoption_source: 'template',
            adoption_note: item.adoption_note,
          },
          update: {
            is_stocked: true,
            reorder_point: item.reorder_point,
            preferred_generic_id: item.preferred_generic_id,
            adoption_source: 'template',
            adoption_note: item.adoption_note,
          },
          select: { id: true },
        });
        count += 1;
      }

      await tx.auditLog.create({
        data: {
          org_id: authCtx.orgId,
          actor_id: authCtx.userId,
          action: 'formulary_template_applied',
          target_type: 'PharmacySite',
          target_id: targetSite.id,
          changes: {
            template_id: template.id,
            template_name: template.name,
            target_site_id: targetSite.id,
            item_count: validItems.length,
            source_item_count: sourceItemCount,
            invalid_item_count: totalInvalidItemCount,
            applied_count: count,
            skipped_count: validItems.length - count,
            overwrite: parsed.data.overwrite,
            drug_master_ids: operations.map((item) => item.drug_master_id),
            preview_summary: preview.summary,
          },
          ip_address: authCtx.ipAddress,
          user_agent: authCtx.userAgent,
        },
      });

      return count;
    });

    return success({
      template: { id: template.id, name: template.name },
      targetSite,
      itemCount: validItems.length,
      sourceItemCount,
      invalidItemCount: totalInvalidItemCount,
      appliedCount,
      skippedCount: validItems.length - appliedCount,
      overwrite: parsed.data.overwrite,
      dryRun: false,
      preview,
    });
  },
  { permission: 'canAdmin' },
);
