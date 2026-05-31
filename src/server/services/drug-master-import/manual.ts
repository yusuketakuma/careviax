import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { toPrismaJsonInput } from '@/lib/db/json';
import { type DrugMasterImportLogDbClient, withImportLog } from './shared';

type ManualClinicalRulesDbClient = DrugMasterImportLogDbClient & {
  drugAlertRule: Pick<Prisma.TransactionClient['drugAlertRule'], 'createMany' | 'deleteMany'>;
  drugMaster: Pick<Prisma.TransactionClient['drugMaster'], 'findFirst' | 'update'>;
  drugPackageInsert: Pick<
    Prisma.TransactionClient['drugPackageInsert'],
    'create' | 'findFirst' | 'update'
  >;
};

const alertRuleConditionSchema = z
  .object({
    yj_codes: z.array(z.string().trim().min(1)).optional(),
    therapeutic_categories: z.array(z.string().trim().min(1)).optional(),
  })
  .refine(
    (value) => (value.yj_codes?.length ?? 0) > 0 || (value.therapeutic_categories?.length ?? 0) > 0,
    {
      message: 'yj_codes または therapeutic_categories のいずれかが必要です',
    },
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

const drugSafetyOverrideSchema = z
  .object({
    yj_code: z.string().trim().min(1).optional(),
    drug_name: z.string().trim().min(1).optional(),
    tall_man_name: z.string().trim().min(1).nullable().optional(),
    lasa_group_key: z.string().trim().min(1).nullable().optional(),
    is_lasa_risk: z.boolean().optional(),
    is_high_risk: z.boolean().optional(),
  })
  .refine((value) => Boolean(value.yj_code || value.drug_name), {
    message: 'yj_code または drug_name のいずれかが必要です',
  });

export const manualClinicalRuleBundleSchema = z.object({
  pim_rules: z.array(alertRuleSchema).default([]),
  high_risk_rules: z.array(alertRuleSchema).default([]),
  renal_adjustments: z.array(renalAdjustmentEntrySchema).default([]),
  drug_safety_overrides: z.array(drugSafetyOverrideSchema).default([]),
});

export type ManualClinicalRuleBundle = z.input<typeof manualClinicalRuleBundleSchema>;
type ParsedManualClinicalRuleBundle = z.output<typeof manualClinicalRuleBundleSchema>;

async function upsertRenalAdjustment(
  db: ManualClinicalRulesDbClient,
  entry: ParsedManualClinicalRuleBundle['renal_adjustments'][number],
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
        dosage_adjustment_renal: toPrismaJsonInput(entry.dosage_adjustment_renal),
        ...(entry.precautions_elderly !== undefined
          ? { precautions_elderly: toPrismaJsonInput(entry.precautions_elderly) }
          : {}),
      },
    });
    return true;
  }

  await db.drugPackageInsert.create({
    data: {
      drug_master_id: drug.id,
      dosage_adjustment_renal: toPrismaJsonInput(entry.dosage_adjustment_renal),
      precautions_elderly:
        entry.precautions_elderly !== undefined
          ? toPrismaJsonInput(entry.precautions_elderly)
          : Prisma.JsonNull,
      source_format: 'pdf',
    },
  });
  return true;
}

async function replaceAlertRules(
  db: ManualClinicalRulesDbClient,
  alertType: 'pim_elderly' | 'high_risk',
  rules:
    | ParsedManualClinicalRuleBundle['pim_rules']
    | ParsedManualClinicalRuleBundle['high_risk_rules'],
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
      condition: toPrismaJsonInput(rule.condition),
      severity: rule.severity,
      message: rule.message,
      is_active: rule.is_active,
    })),
  });

  return rules.length;
}

async function applyDrugSafetyOverride(
  db: ManualClinicalRulesDbClient,
  override: ParsedManualClinicalRuleBundle['drug_safety_overrides'][number],
) {
  const drug = await db.drugMaster.findFirst({
    where: override.yj_code
      ? { yj_code: override.yj_code }
      : { drug_name: { contains: override.drug_name! } },
    select: { id: true },
  });

  if (!drug) {
    return false;
  }

  const data: Prisma.DrugMasterUpdateInput = {
    ...(override.tall_man_name !== undefined ? { tall_man_name: override.tall_man_name } : {}),
    ...(override.lasa_group_key !== undefined ? { lasa_group_key: override.lasa_group_key } : {}),
    ...(override.is_lasa_risk !== undefined ? { is_lasa_risk: override.is_lasa_risk } : {}),
    ...(override.is_high_risk !== undefined ? { is_high_risk: override.is_high_risk } : {}),
  };

  if (Object.keys(data).length === 0) {
    return false;
  }

  await db.drugMaster.update({
    where: { id: drug.id },
    data,
  });
  return true;
}

export async function importManualClinicalRules(
  db: ManualClinicalRulesDbClient,
  bundle: ManualClinicalRuleBundle,
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

    let safetyOverrideCount = 0;
    for (const override of parsed.drug_safety_overrides) {
      if (await applyDrugSafetyOverride(db, override)) {
        safetyOverrideCount += 1;
      }
    }

    return {
      recordCount: pimCount + highRiskCount + renalCount + safetyOverrideCount,
      payload: {
        pimCount,
        highRiskCount,
        renalCount,
        safetyOverrideCount,
      },
    };
  });
}
