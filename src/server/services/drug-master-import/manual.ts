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

const packageInsertTextObjectSchema = z
  .object({
    text: z.string().trim().min(1).optional(),
    name: z.string().trim().min(1).optional(),
    description: z.string().trim().min(1).optional(),
    summary: z.string().trim().min(1).optional(),
    recommendation: z.string().trim().min(1).optional(),
    severity: z.string().trim().min(1).optional(),
    detail: z.string().trim().min(1).optional(),
  })
  .passthrough()
  .refine(
    (value) =>
      Boolean(
        value.text || value.name || value.description || value.summary || value.recommendation,
      ),
    { message: 'text、name、description、summary、recommendation のいずれかが必要です' },
  )
  .transform((value) => {
    const text =
      value.text ?? value.name ?? value.description ?? value.summary ?? value.recommendation;
    if (!text) {
      throw new Error('package insert text entry is missing text');
    }

    return {
      text,
      ...(value.severity ? { severity: value.severity } : {}),
      ...(value.detail ? { detail: value.detail } : {}),
    };
  });

const packageInsertTextEntrySchema = z.union([
  z.string().trim().min(1),
  packageInsertTextObjectSchema,
]);

function normalizePackageInsertTextSectionInput(value: unknown) {
  if (typeof value === 'string') return [value];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;

  const object = value as Record<string, unknown>;
  if (
    ['text', 'name', 'description', 'summary', 'recommendation'].some(
      (key) => typeof object[key] === 'string',
    )
  ) {
    return [value];
  }

  if (typeof object.note === 'string') return [object.note];

  for (const key of ['notes', 'items', 'entries']) {
    if (Array.isArray(object[key])) return object[key];
  }

  return value;
}

const packageInsertTextSectionSchema = z.preprocess(
  normalizePackageInsertTextSectionInput,
  z.array(packageInsertTextEntrySchema).min(1),
);

const renalAdjustmentEntrySchema = z
  .object({
    yj_code: z.string().trim().min(1).optional(),
    drug_name: z.string().trim().min(1).optional(),
    dosage_adjustment_renal: z.array(renalAdjustmentSchema).min(1),
    precautions_elderly: packageInsertTextSectionSchema.optional(),
  })
  .refine((value) => Boolean(value.yj_code), {
    path: ['yj_code'],
    message: '手動臨床ルールの腎機能調整は yj_code が必要です',
  });

const drugSafetyOverrideSchema = z
  .object({
    yj_code: z.string().trim().min(1).optional(),
    drug_name: z.string().trim().min(1).optional(),
    tall_man_name: z.string().trim().min(1).nullable().optional(),
    lasa_group_key: z.string().trim().min(1).nullable().optional(),
    is_lasa_risk: z.boolean().optional(),
    is_high_risk: z.boolean().optional(),
    outpatient_injection_eligible: z.boolean().optional(),
    outpatient_injection_note: z.string().trim().min(1).nullable().optional(),
  })
  .refine((value) => Boolean(value.yj_code), {
    path: ['yj_code'],
    message: '手動臨床ルールの安全性 override は yj_code が必要です',
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
    where: { yj_code: entry.yj_code! },
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
    where: { alert_type: alertType, org_id: null },
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
      org_id: null,
    })),
  });

  return rules.length;
}

async function applyDrugSafetyOverride(
  db: ManualClinicalRulesDbClient,
  override: ParsedManualClinicalRuleBundle['drug_safety_overrides'][number],
) {
  const drug = await db.drugMaster.findFirst({
    where: { yj_code: override.yj_code! },
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
    ...(override.outpatient_injection_eligible !== undefined
      ? { outpatient_injection_eligible: override.outpatient_injection_eligible }
      : {}),
    ...(override.outpatient_injection_note !== undefined
      ? { outpatient_injection_note: override.outpatient_injection_note }
      : {}),
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
      importMode: 'manual',
      changeSummary: {
        mode: 'manual',
        pim_rule_count: pimCount,
        high_risk_rule_count: highRiskCount,
        renal_adjustment_count: renalCount,
        safety_override_count: safetyOverrideCount,
      },
      payload: {
        pimCount,
        highRiskCount,
        renalCount,
        safetyOverrideCount,
      },
    };
  });
}
