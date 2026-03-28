import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { DrugMasterImportDbClient, withImportLog } from './shared';

const alertRuleConditionSchema = z
  .object({
    yj_codes: z.array(z.string().trim().min(1)).optional(),
    therapeutic_categories: z.array(z.string().trim().min(1)).optional(),
  })
  .refine(
    (value) => (value.yj_codes?.length ?? 0) > 0 || (value.therapeutic_categories?.length ?? 0) > 0,
    {
      message: 'yj_codes または therapeutic_categories のいずれかが必要です',
    }
  );

const alertRuleSchema = z.object({
  condition: alertRuleConditionSchema,
  severity: z.enum(['critical', 'warning', 'info']).default('warning'),
  message: z.string().trim().min(1),
  is_active: z.boolean().default(true),
});

const renalAdjustmentSchema = z.object({
  egfr_min: z.number().optional(),
  egfr_max: z.number().optional(),
  recommendation: z.string().trim().min(1),
});

const renalAdjustmentEntrySchema = z
  .object({
    yj_code: z.string().trim().min(1).optional(),
    drug_name: z.string().trim().min(1).optional(),
    dosage_adjustment_renal: z.array(renalAdjustmentSchema).min(1),
    precautions_elderly: z.unknown().optional(),
  })
  .refine((value) => Boolean(value.yj_code || value.drug_name), {
    message: 'yj_code または drug_name のいずれかが必要です',
  });

export const manualClinicalRuleBundleSchema = z.object({
  pim_rules: z.array(alertRuleSchema).default([]),
  high_risk_rules: z.array(alertRuleSchema).default([]),
  renal_adjustments: z.array(renalAdjustmentEntrySchema).default([]),
});

export type ManualClinicalRuleBundle = z.input<typeof manualClinicalRuleBundleSchema>;
type ParsedManualClinicalRuleBundle = z.output<typeof manualClinicalRuleBundleSchema>;

async function upsertRenalAdjustment(
  db: DrugMasterImportDbClient,
  entry: ParsedManualClinicalRuleBundle['renal_adjustments'][number]
) {
  const drug = await db.drugMaster.findFirst({
    where: entry.yj_code
      ? { yj_code: entry.yj_code }
      : { drug_name: { contains: entry.drug_name! } },
    select: { id: true },
  });

  if (!drug) {
    return false;
  }

  const existing = await db.drugPackageInsert.findFirst({
    where: { drug_master_id: drug.id },
    orderBy: [{ revised_at: 'desc' }, { created_at: 'desc' }],
    select: {
      id: true,
      contraindications: true,
      interactions: true,
      adverse_effects: true,
      dosage_adjustment_renal: true,
      precautions_elderly: true,
      document_version: true,
      revised_at: true,
      source_format: true,
    },
  });

  if (existing) {
    await db.drugPackageInsert.update({
      where: { id: existing.id },
      data: {
        dosage_adjustment_renal: entry.dosage_adjustment_renal as Prisma.InputJsonValue,
        ...(entry.precautions_elderly !== undefined
          ? { precautions_elderly: entry.precautions_elderly as Prisma.InputJsonValue }
          : {}),
      },
    });
    return true;
  }

  await db.drugPackageInsert.create({
    data: {
      drug_master_id: drug.id,
      dosage_adjustment_renal: entry.dosage_adjustment_renal as Prisma.InputJsonValue,
      precautions_elderly:
        entry.precautions_elderly !== undefined
          ? (entry.precautions_elderly as Prisma.InputJsonValue)
          : Prisma.JsonNull,
      source_format: 'pdf',
    },
  });
  return true;
}

async function replaceAlertRules(
  db: DrugMasterImportDbClient,
  alertType: 'pim_elderly' | 'high_risk',
  rules:
    | ParsedManualClinicalRuleBundle['pim_rules']
    | ParsedManualClinicalRuleBundle['high_risk_rules']
) {
  await db.drugAlertRule.deleteMany({
    where: { alert_type: alertType },
  });

  if (rules.length === 0) {
    return 0;
  }

  await db.drugAlertRule.createMany({
    data: rules.map((rule) => ({
      alert_type: alertType,
      condition: rule.condition as Prisma.InputJsonValue,
      severity: rule.severity,
      message: rule.message,
      is_active: rule.is_active,
    })),
  });

  return rules.length;
}

export async function importManualClinicalRules(
  db: DrugMasterImportDbClient,
  bundle: ManualClinicalRuleBundle
) {
  return withImportLog(db, 'manual_clinical', async () => {
    const parsed: ParsedManualClinicalRuleBundle = manualClinicalRuleBundleSchema.parse(bundle);

    const [pimCount, highRiskCount] = await Promise.all([
      replaceAlertRules(db, 'pim_elderly', parsed.pim_rules),
      replaceAlertRules(db, 'high_risk', parsed.high_risk_rules),
    ]);

    let renalCount = 0;
    for (const entry of parsed.renal_adjustments) {
      if (await upsertRenalAdjustment(db, entry)) {
        renalCount += 1;
      }
    }

    return {
      recordCount: pimCount + highRiskCount + renalCount,
      payload: {
        pimCount,
        highRiskCount,
        renalCount,
      },
    };
  });
}
