import { prisma } from '@/lib/db/client';
import { Prisma, type LabAnalyteCode } from '@prisma/client';
import { differenceInYears } from 'date-fns';

export type CdsAlert = {
  type: string;
  severity: 'critical' | 'warning' | 'info';
  message: string;
  details?: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// Shared types for internal use
// ---------------------------------------------------------------------------

type PrescriptionLine = {
  id: string;
  drug_name: string;
  drug_code: string | null;
  dose: string;
  frequency: string;
  days: number;
};

type CurrentMed = {
  id: string;
  drug_name: string;
  drug_master_id: string | null;
};

type MasterInfo = {
  id: string;
  yj_code: string;
  drug_name: string;
  therapeutic_category: string | null;
};

type DrugMasterForCds = {
  id: string;
  yj_code: string;
  drug_name: string;
  tall_man_name: string | null;
  therapeutic_category: string | null;
  max_administration_days: number | null;
  transitional_expiry_date: Date | null;
  is_narcotic: boolean;
  is_psychotropic: boolean;
  is_high_risk: boolean;
  is_lasa_risk: boolean;
  lasa_group_key: string | null;
};

type AllergyEntry = {
  drug_name?: string;
  therapeutic_category?: string;
  substance?: string;
  category?: 'drug' | 'food' | 'other';
  severity?: 'mild' | 'moderate' | 'severe' | 'unknown';
};

function allergyAlertSeverity(severity?: string): CdsAlert['severity'] {
  if (severity === 'severe') return 'critical';
  if (severity === 'moderate') return 'warning';
  if (severity === 'mild') return 'info';
  return 'critical'; // unknown or undefined → safe default
}

type RenalDoseEntry = {
  egfr_min?: number;
  egfr_max?: number;
  recommendation?: string;
};

type AlertRuleCondition = {
  yj_codes?: string[];
  therapeutic_categories?: string[];
};

type ManagedAlertType =
  | 'interaction'
  | 'duplicate'
  | 'allergy_cross'
  | 'renal_dose'
  | 'pim_elderly'
  | 'high_risk'
  | 'narcotic'
  | 'max_days';

const MANAGED_ALERT_TYPES: ManagedAlertType[] = [
  'interaction',
  'duplicate',
  'allergy_cross',
  'renal_dose',
  'pim_elderly',
  'high_risk',
  'narcotic',
  'max_days',
];

type DoPrescriptionRiskProfile = {
  key: string;
  label: string;
  therapeuticCategoryPrefixes: string[];
  drugNameKeywords: string[];
  minimumContinuedDays: number;
};

const DO_PRESCRIPTION_RISK_PROFILES: DoPrescriptionRiskProfile[] = [
  {
    key: 'anti_inflammatory_analgesic',
    label: '消炎鎮痛剤',
    therapeuticCategoryPrefixes: ['114'],
    drugNameKeywords: [
      'ロキソ',
      'ジクロフェナク',
      'セレコキシブ',
      'イブプロフェン',
      'アセトアミノフェン',
    ],
    minimumContinuedDays: 28,
  },
  {
    key: 'antibiotic',
    label: '抗菌薬',
    therapeuticCategoryPrefixes: ['61'],
    drugNameKeywords: ['アモキシシリン', 'クラリスロマイシン', 'レボフロキサシン', 'セフ', '抗菌'],
    minimumContinuedDays: 14,
  },
  {
    key: 'laxative',
    label: '下剤',
    therapeuticCategoryPrefixes: ['235'],
    drugNameKeywords: [
      'センノシド',
      '酸化マグネシウム',
      'マグミット',
      'ラキソベロン',
      'ルビプロストン',
      'モビコール',
    ],
    minimumContinuedDays: 28,
  },
];

async function resolveManagedAlertTypeStates() {
  const configuredRules = await prisma.drugAlertRule.findMany({
    where: {
      alert_type: {
        in: MANAGED_ALERT_TYPES,
      },
    },
    select: {
      alert_type: true,
      is_active: true,
    },
  });

  const states = new Map<ManagedAlertType, boolean>();
  for (const alertType of MANAGED_ALERT_TYPES) {
    const matchingRules = configuredRules.filter((rule) => rule.alert_type === alertType);
    states.set(
      alertType,
      matchingRules.length === 0 ? true : matchingRules.some((rule) => rule.is_active),
    );
  }
  return states;
}

function buildComparableLineKey(
  line: Pick<PrescriptionLine, 'drug_name' | 'drug_code' | 'dose' | 'frequency' | 'days'>,
) {
  return [line.drug_code ?? '', line.drug_name, line.dose, line.frequency, String(line.days)].join(
    '::',
  );
}

function isSamePrescriptionContent(
  currentLines: PrescriptionLine[],
  previousLines: PrescriptionLine[],
) {
  if (currentLines.length !== previousLines.length) return false;

  const currentKeys = [...currentLines].map(buildComparableLineKey).sort();
  const previousKeys = [...previousLines].map(buildComparableLineKey).sort();

  return currentKeys.every((key, index) => key === previousKeys[index]);
}

function findMatchingPreviousLine(
  previousLines: PrescriptionLine[],
  currentLine: PrescriptionLine,
) {
  return previousLines.find(
    (line) => buildComparableLineKey(line) === buildComparableLineKey(currentLine),
  );
}

function resolveDoPrescriptionRiskProfile(
  line: PrescriptionLine,
  drugInfo: Pick<MasterInfo, 'therapeutic_category'> | undefined,
) {
  return DO_PRESCRIPTION_RISK_PROFILES.find((profile) => {
    const category = drugInfo?.therapeutic_category ?? '';
    const matchByCategory = profile.therapeuticCategoryPrefixes.some((prefix) =>
      category.startsWith(prefix),
    );
    const matchByName = profile.drugNameKeywords.some((keyword) =>
      line.drug_name.includes(keyword),
    );
    return matchByCategory || matchByName;
  });
}

// ---------------------------------------------------------------------------
// 1. Drug interaction check (existing)
// ---------------------------------------------------------------------------

async function checkInteractions(
  prescriptionLines: PrescriptionLine[],
  currentMeds: CurrentMed[],
  masterByMedId: Map<string, MasterInfo>,
): Promise<CdsAlert[]> {
  const alerts: CdsAlert[] = [];

  // Collect all unique drug code pairs to check
  const lineCodes = prescriptionLines
    .map((l) => l.drug_code)
    .filter((c): c is string => c !== null);
  const medCodes = currentMeds
    .map((m) => masterByMedId.get(m.id)?.yj_code)
    .filter((c): c is string => c !== undefined);

  if (lineCodes.length === 0 || medCodes.length === 0) return alerts;

  // Single batch query for all drug pairs (contraindicated + caution)
  const allInteractions = await prisma.drugInteraction.findMany({
    where: {
      severity: { in: ['contraindicated', 'caution'] },
      OR: [
        { drug_a: { yj_code: { in: lineCodes } }, drug_b: { yj_code: { in: medCodes } } },
        { drug_a: { yj_code: { in: medCodes } }, drug_b: { yj_code: { in: lineCodes } } },
      ],
    },
    select: {
      severity: true,
      mechanism: true,
      clinical_effect: true,
      drug_a: { select: { yj_code: true } },
      drug_b: { select: { yj_code: true } },
    },
  });

  // Index interactions by canonical pair key for O(1) lookup
  const interactionsByPair = new Map<string, typeof allInteractions>();
  for (const ix of allInteractions) {
    const [a, b] = [ix.drug_a.yj_code, ix.drug_b.yj_code].sort();
    const key = `${a}::${b}`;
    const existing = interactionsByPair.get(key);
    if (existing) {
      existing.push(ix);
    } else {
      interactionsByPair.set(key, [ix]);
    }
  }

  // Check each line × med pair using the pre-fetched index
  for (const line of prescriptionLines) {
    if (!line.drug_code) continue;

    for (const med of currentMeds) {
      const medMaster = masterByMedId.get(med.id);
      if (!medMaster) continue;

      const [a, b] = [line.drug_code, medMaster.yj_code].sort();
      const key = `${a}::${b}`;
      const matches = interactionsByPair.get(key);
      if (!matches) continue;

      for (const interaction of matches) {
        alerts.push({
          type: 'interaction',
          severity: interaction.severity === 'contraindicated' ? 'critical' : 'warning',
          message:
            interaction.severity === 'contraindicated'
              ? `併用禁忌: ${line.drug_name} × ${med.drug_name}`
              : `併用注意: ${line.drug_name} × ${med.drug_name}`,
          details: {
            interaction_severity: interaction.severity,
            mechanism: interaction.mechanism ?? undefined,
            effect: interaction.clinical_effect ?? undefined,
          },
        });
      }
    }
  }

  return alerts;
}

// ---------------------------------------------------------------------------
// 2. Duplicate medication check (existing)
// ---------------------------------------------------------------------------

async function checkDuplicates(
  prescriptionLines: PrescriptionLine[],
  currentMeds: CurrentMed[],
  masterByMedId: Map<string, MasterInfo>,
): Promise<CdsAlert[]> {
  const alerts: CdsAlert[] = [];

  for (const line of prescriptionLines) {
    if (line.drug_code) {
      const dupByCode = currentMeds.find((m) => {
        const master = masterByMedId.get(m.id);
        return master?.yj_code === line.drug_code;
      });
      if (dupByCode) {
        alerts.push({
          type: 'duplicate',
          severity: 'warning',
          message: `重複投薬: ${line.drug_name}`,
        });
        continue;
      }
    }

    const dupByName = currentMeds.find((m) => m.drug_name === line.drug_name);
    if (dupByName) {
      alerts.push({
        type: 'duplicate',
        severity: 'warning',
        message: `重複投薬: ${line.drug_name}`,
      });
    }
  }

  return alerts;
}

// ---------------------------------------------------------------------------
// 3. Max administration days check (existing)
// ---------------------------------------------------------------------------

async function checkMaxDays(
  prescriptionLines: PrescriptionLine[],
  drugMasterMap?: Map<string, DrugMasterForCds>,
): Promise<CdsAlert[]> {
  const alerts: CdsAlert[] = [];

  const drugCodes = prescriptionLines
    .map((l) => l.drug_code)
    .filter((c): c is string => c !== null);

  if (drugCodes.length === 0) return alerts;

  let drugByCode: Map<
    string,
    Pick<DrugMasterForCds, 'yj_code' | 'max_administration_days' | 'drug_name'>
  >;
  if (drugMasterMap) {
    drugByCode = drugMasterMap;
  } else {
    const drugs = await prisma.drugMaster.findMany({
      where: { yj_code: { in: drugCodes } },
      select: { yj_code: true, max_administration_days: true, drug_name: true },
    });
    drugByCode = new Map(drugs.map((d) => [d.yj_code, d]));
  }

  for (const line of prescriptionLines) {
    if (!line.drug_code) continue;
    const drug = drugByCode.get(line.drug_code);

    if (drug?.max_administration_days && line.days > drug.max_administration_days) {
      alerts.push({
        type: 'max_days',
        severity: 'critical',
        message: `投与日数制限超過: ${line.drug_name}（上限${drug.max_administration_days}日、処方${line.days}日）`,
        details: {
          max_days: drug.max_administration_days,
          prescribed_days: line.days,
        },
      });
    }
  }

  return alerts;
}

// ---------------------------------------------------------------------------
// 3b. Package insert audit (contraindications, adverse effects, elderly)
// ---------------------------------------------------------------------------

type PatientForChecks = {
  birth_date: Date | null;
  allergy_info: Prisma.JsonValue | null;
};

async function checkPackageInsertAudit(
  prescriptionLines: PrescriptionLine[],
  patient: PatientForChecks | null,
): Promise<CdsAlert[]> {
  const alerts: CdsAlert[] = [];

  const drugCodes = prescriptionLines
    .map((l) => l.drug_code)
    .filter((c): c is string => c !== null);

  if (drugCodes.length === 0) return alerts;

  // Batch fetch package inserts for all prescribed drugs
  const packageInserts = await prisma.drugPackageInsert.findMany({
    where: { drug_master: { yj_code: { in: drugCodes } } },
    include: { drug_master: { select: { yj_code: true, drug_name: true } } },
  });

  if (packageInserts.length === 0) return alerts;

  const patientAge = patient?.birth_date ? differenceInYears(new Date(), patient.birth_date) : null;

  const insertByCode = new Map(packageInserts.map((pi) => [pi.drug_master.yj_code, pi]));

  for (const line of prescriptionLines) {
    if (!line.drug_code) continue;
    const pi = insertByCode.get(line.drug_code);
    if (!pi) continue;

    const drugName = pi.drug_master.drug_name;

    // Check contraindications
    if (pi.contraindications && Array.isArray(pi.contraindications)) {
      const items = pi.contraindications as Array<{ text?: string; severity?: string }>;
      for (const item of items.slice(0, 3)) {
        if (item.text) {
          alerts.push({
            type: 'package_insert_contraindication',
            severity: 'info',
            message: `【禁忌】${drugName}: ${item.text.slice(0, 100)}`,
            details: { drug_code: line.drug_code, section: 'contraindication' },
          });
        }
      }
    }

    // Check serious adverse effects
    if (pi.adverse_effects && Array.isArray(pi.adverse_effects)) {
      const items = pi.adverse_effects as Array<{ text?: string; severity?: string }>;
      const serious = items.filter((a) => a.severity === 'serious' || a.severity === '重大');
      for (const item of serious.slice(0, 2)) {
        if (item.text) {
          alerts.push({
            type: 'package_insert_adverse_effect',
            severity: 'info',
            message: `【重大な副作用】${drugName}: ${item.text.slice(0, 100)}`,
            details: { drug_code: line.drug_code, section: 'adverse_effect' },
          });
        }
      }
    }

    // Check elderly precautions (only for patients >= 65)
    if (
      patientAge !== null &&
      patientAge >= 65 &&
      pi.precautions_elderly &&
      Array.isArray(pi.precautions_elderly)
    ) {
      const items = pi.precautions_elderly as Array<{ text?: string }>;
      for (const item of items.slice(0, 2)) {
        if (item.text) {
          alerts.push({
            type: 'package_insert_elderly',
            severity: 'warning',
            message: `【高齢者注意】${drugName}（${patientAge}歳）: ${item.text.slice(0, 100)}`,
            details: { drug_code: line.drug_code, section: 'elderly', patient_age: patientAge },
          });
        }
      }
    }
  }

  return alerts;
}

// ---------------------------------------------------------------------------
// 3c. Transitional expiry date check (NEW)
// ---------------------------------------------------------------------------

async function checkTransitionalExpiry(
  prescriptionLines: PrescriptionLine[],
  drugMasterMap?: Map<string, DrugMasterForCds>,
): Promise<CdsAlert[]> {
  const alerts: CdsAlert[] = [];

  const drugCodes = prescriptionLines
    .map((l) => l.drug_code)
    .filter((c): c is string => c !== null);

  if (drugCodes.length === 0) return alerts;

  const now = new Date();

  let drugs: Array<{ yj_code: string; drug_name: string; transitional_expiry_date: Date | null }>;
  if (drugMasterMap) {
    drugs = drugCodes
      .map((code) => drugMasterMap.get(code))
      .filter((d): d is DrugMasterForCds => d !== undefined && d.transitional_expiry_date !== null);
  } else {
    drugs = await prisma.drugMaster.findMany({
      where: {
        yj_code: { in: drugCodes },
        transitional_expiry_date: { not: null },
      },
      select: { yj_code: true, drug_name: true, transitional_expiry_date: true },
    });
  }

  for (const drug of drugs) {
    if (!drug.transitional_expiry_date) continue;

    const daysUntilExpiry = Math.floor(
      (drug.transitional_expiry_date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
    );

    if (daysUntilExpiry < 0) {
      alerts.push({
        type: 'transitional_expiry',
        severity: 'critical',
        message: `経過措置期限切れ: ${drug.drug_name}（${drug.transitional_expiry_date.toISOString().slice(0, 10)}に失効済み）`,
        details: {
          drug_code: drug.yj_code,
          expiry_date: drug.transitional_expiry_date.toISOString(),
        },
      });
    } else if (daysUntilExpiry <= 90) {
      alerts.push({
        type: 'transitional_expiry',
        severity: 'warning',
        message: `経過措置期限接近: ${drug.drug_name}（残${daysUntilExpiry}日、${drug.transitional_expiry_date.toISOString().slice(0, 10)}）`,
        details: {
          drug_code: drug.yj_code,
          expiry_date: drug.transitional_expiry_date.toISOString(),
          days_remaining: daysUntilExpiry,
        },
      });
    }
  }

  return alerts;
}

// ---------------------------------------------------------------------------
// 4. Allergy cross-reaction check (NEW)
// ---------------------------------------------------------------------------

async function checkAllergyReactions(
  prescriptionLines: PrescriptionLine[],
  patient: PatientForChecks | null,
  drugMasterMap?: Map<string, DrugMasterForCds>,
): Promise<CdsAlert[]> {
  const alerts: CdsAlert[] = [];

  if (!patient?.allergy_info) return alerts;

  const allergyEntries = (
    Array.isArray(patient.allergy_info) ? patient.allergy_info : []
  ) as AllergyEntry[];

  if (allergyEntries.length === 0) return alerts;

  // Fetch allergy_cross rules
  const allergyRules = await prisma.drugAlertRule.findMany({
    where: { alert_type: 'allergy_cross', is_active: true },
  });

  // Resolve DrugMaster for prescription lines to get therapeutic_category
  const drugCodes = prescriptionLines
    .map((l) => l.drug_code)
    .filter((c): c is string => c !== null);

  let drugByCode: Map<
    string,
    Pick<DrugMasterForCds, 'yj_code' | 'drug_name' | 'therapeutic_category'>
  >;
  if (drugMasterMap) {
    drugByCode = drugMasterMap;
  } else {
    const prescribedDrugs =
      drugCodes.length > 0
        ? await prisma.drugMaster.findMany({
            where: { yj_code: { in: drugCodes } },
            select: { yj_code: true, drug_name: true, therapeutic_category: true },
          })
        : [];
    drugByCode = new Map(prescribedDrugs.map((d) => [d.yj_code, d]));
  }

  for (const line of prescriptionLines) {
    if (!line.drug_code) continue;
    const drugInfo = drugByCode.get(line.drug_code);

    // Check against allergy entries
    for (const allergy of allergyEntries) {
      // Direct drug name match
      if (allergy.drug_name && line.drug_name.includes(allergy.drug_name)) {
        alerts.push({
          type: 'allergy_cross',
          severity: allergyAlertSeverity(allergy.severity),
          message: `アレルギー交差反応: ${line.drug_name}（患者アレルギー: ${allergy.drug_name}）`,
          details: {
            allergy_drug: allergy.drug_name,
            prescribed_drug: line.drug_name,
            allergy_severity: allergy.severity,
          },
        });
      }

      // Therapeutic category match — only for drug-category allergies
      if (
        allergy.category === 'drug' &&
        allergy.therapeutic_category &&
        drugInfo?.therapeutic_category &&
        drugInfo.therapeutic_category === allergy.therapeutic_category
      ) {
        alerts.push({
          type: 'allergy_cross',
          severity: allergyAlertSeverity(allergy.severity),
          message: `アレルギー交差反応（薬効分類一致）: ${line.drug_name}（分類: ${drugInfo.therapeutic_category}）`,
          details: {
            therapeutic_category: drugInfo.therapeutic_category,
            allergy_category: allergy.therapeutic_category,
          },
        });
      }
    }

    // Check against DrugAlertRule allergy_cross rules
    for (const rule of allergyRules) {
      const condition = rule.condition as AlertRuleCondition | null;
      if (!condition) continue;

      const matchByCode = condition.yj_codes?.includes(line.drug_code) ?? false;
      const matchByCategory =
        drugInfo?.therapeutic_category &&
        (condition.therapeutic_categories?.includes(drugInfo.therapeutic_category) ?? false);

      if (matchByCode || matchByCategory) {
        alerts.push({
          type: 'allergy_cross',
          severity: 'critical',
          message: rule.message || `アレルギー交差反応の可能性: ${line.drug_name}`,
          details: { rule_id: rule.id, drug: line.drug_name },
        });
      }
    }
  }

  return alerts;
}

// ---------------------------------------------------------------------------
// 5. Narcotic / psychotropic special management flag (NEW)
// ---------------------------------------------------------------------------

async function checkNarcoticFlags(
  prescriptionLines: PrescriptionLine[],
  drugMasterMap?: Map<string, DrugMasterForCds>,
): Promise<CdsAlert[]> {
  const alerts: CdsAlert[] = [];

  const drugCodes = prescriptionLines
    .map((l) => l.drug_code)
    .filter((c): c is string => c !== null);

  if (drugCodes.length === 0) return alerts;

  let drugByCode: Map<
    string,
    Pick<DrugMasterForCds, 'yj_code' | 'drug_name' | 'is_narcotic' | 'is_psychotropic'>
  >;
  if (drugMasterMap) {
    drugByCode = drugMasterMap;
  } else {
    const drugs = await prisma.drugMaster.findMany({
      where: { yj_code: { in: drugCodes } },
      select: { yj_code: true, drug_name: true, is_narcotic: true, is_psychotropic: true },
    });
    drugByCode = new Map(drugs.map((d) => [d.yj_code, d]));
  }

  for (const line of prescriptionLines) {
    if (!line.drug_code) continue;
    const drug = drugByCode.get(line.drug_code);
    if (!drug) continue;

    if (drug.is_narcotic) {
      alerts.push({
        type: 'narcotic',
        severity: 'info',
        message: `麻薬管理対象: ${line.drug_name}`,
        details: { drug_code: line.drug_code },
      });
    }

    if (drug.is_psychotropic) {
      alerts.push({
        type: 'narcotic',
        severity: 'info',
        message: `向精神薬管理対象: ${line.drug_name}`,
        details: { drug_code: line.drug_code },
      });
    }
  }

  return alerts;
}

// ---------------------------------------------------------------------------
// 6. High-risk drug counseling flag (NEW)
// ---------------------------------------------------------------------------

async function checkHighRiskDrugs(
  prescriptionLines: PrescriptionLine[],
  drugMasterMap?: Map<string, DrugMasterForCds>,
): Promise<CdsAlert[]> {
  const alerts: CdsAlert[] = [];

  const highRiskRules = await prisma.drugAlertRule.findMany({
    where: { alert_type: 'high_risk', is_active: true },
  });

  // Resolve DrugMaster for therapeutic category matching
  const drugCodes = prescriptionLines
    .map((l) => l.drug_code)
    .filter((c): c is string => c !== null);

  let drugByCode: Map<
    string,
    Pick<
      DrugMasterForCds,
      | 'yj_code'
      | 'drug_name'
      | 'tall_man_name'
      | 'therapeutic_category'
      | 'is_high_risk'
      | 'is_lasa_risk'
      | 'lasa_group_key'
    >
  >;
  if (drugMasterMap) {
    drugByCode = drugMasterMap;
  } else {
    const prescribedDrugs =
      drugCodes.length > 0
        ? await prisma.drugMaster.findMany({
            where: { yj_code: { in: drugCodes } },
            select: {
              yj_code: true,
              drug_name: true,
              tall_man_name: true,
              therapeutic_category: true,
              is_high_risk: true,
              is_lasa_risk: true,
              lasa_group_key: true,
            },
          })
        : [];
    drugByCode = new Map(prescribedDrugs.map((d) => [d.yj_code, d]));
  }

  for (const line of prescriptionLines) {
    if (!line.drug_code) continue;
    const drugInfo = drugByCode.get(line.drug_code);
    const displayName = drugInfo?.tall_man_name ?? line.drug_name;

    if (drugInfo?.is_high_risk || drugInfo?.is_lasa_risk) {
      alerts.push({
        type: drugInfo.is_lasa_risk ? 'lasa_drug_name' : 'high_risk',
        severity: 'warning',
        message: drugInfo.is_lasa_risk
          ? `類似薬剤名注意: ${displayName}（通常表記: ${line.drug_name}）`
          : `ハイリスク薬: ${displayName}`,
        details: {
          drug_code: line.drug_code,
          drug: line.drug_name,
          drug_display_name: displayName,
          tall_man_name: drugInfo.tall_man_name ?? undefined,
          lasa_group_key: drugInfo.lasa_group_key ?? undefined,
          source: 'drug_master_safety_flags',
        },
      });
    }

    for (const rule of highRiskRules) {
      const condition = rule.condition as AlertRuleCondition | null;
      if (!condition) continue;

      const matchByCode = condition.yj_codes?.includes(line.drug_code) ?? false;
      const matchByCategory =
        drugInfo?.therapeutic_category &&
        (condition.therapeutic_categories?.includes(drugInfo.therapeutic_category) ?? false);

      if (matchByCode || matchByCategory) {
        alerts.push({
          type: 'high_risk',
          severity: 'warning',
          message:
            rule.message ||
            `ハイリスク薬：服薬指導必須（特定薬剤管理指導加算対象）: ${displayName}`,
          details: {
            rule_id: rule.id,
            drug: line.drug_name,
            drug_display_name: displayName,
            tall_man_name: drugInfo?.tall_man_name ?? undefined,
          },
        });
      }
    }
  }

  return alerts;
}

// ---------------------------------------------------------------------------
// 7. DO prescription long-term continuation risk (NEW)
// ---------------------------------------------------------------------------

async function checkDoPrescriptionRisk(
  orgId: string,
  cycleId: string,
  patientId: string,
): Promise<CdsAlert[]> {
  const currentIntake = await prisma.prescriptionIntake.findFirst({
    where: { org_id: orgId, cycle_id: cycleId },
    orderBy: [{ prescribed_date: 'desc' }, { created_at: 'desc' }],
    select: {
      id: true,
      prescribed_date: true,
      lines: {
        select: {
          id: true,
          drug_name: true,
          drug_code: true,
          dose: true,
          frequency: true,
          days: true,
        },
      },
    },
  });

  if (!currentIntake || currentIntake.lines.length === 0) return [];

  const previousIntake = await prisma.prescriptionIntake.findFirst({
    where: {
      org_id: orgId,
      cycle_id: { not: cycleId },
      cycle: { is: { patient_id: patientId } },
      prescribed_date: { lte: currentIntake.prescribed_date },
    },
    orderBy: [{ prescribed_date: 'desc' }, { created_at: 'desc' }],
    select: {
      id: true,
      prescribed_date: true,
      lines: {
        select: {
          id: true,
          drug_name: true,
          drug_code: true,
          dose: true,
          frequency: true,
          days: true,
        },
      },
    },
  });

  if (!previousIntake || previousIntake.lines.length === 0) return [];
  if (!isSamePrescriptionContent(currentIntake.lines, previousIntake.lines)) return [];

  const drugCodes = currentIntake.lines
    .map((line) => line.drug_code)
    .filter((code): code is string => code !== null);

  const prescribedDrugs =
    drugCodes.length > 0
      ? await prisma.drugMaster.findMany({
          where: { yj_code: { in: drugCodes } },
          select: { id: true, yj_code: true, drug_name: true, therapeutic_category: true },
        })
      : [];

  const drugByCode = new Map(prescribedDrugs.map((drug) => [drug.yj_code, drug]));

  const flaggedLines = currentIntake.lines
    .map((line) => {
      const previousLine = findMatchingPreviousLine(previousIntake.lines, line);
      if (!previousLine) return null;

      const riskProfile = resolveDoPrescriptionRiskProfile(
        line,
        line.drug_code ? drugByCode.get(line.drug_code) : undefined,
      );

      if (!riskProfile) return null;

      const continuedDays = line.days + previousLine.days;
      if (continuedDays < riskProfile.minimumContinuedDays) return null;

      return {
        drug_name: line.drug_name,
        category_label: riskProfile.label,
        continued_days: continuedDays,
      };
    })
    .filter(
      (
        line,
      ): line is {
        drug_name: string;
        category_label: string;
        continued_days: number;
      } => line !== null,
    );

  if (flaggedLines.length === 0) return [];

  const preview = flaggedLines
    .slice(0, 3)
    .map((line) => `${line.drug_name}（${line.category_label}・継続${line.continued_days}日）`)
    .join(' / ');
  const remainder = flaggedLines.length > 3 ? ` ほか${flaggedLines.length - 3}剤` : '';

  return [
    {
      type: 'do_prescription',
      severity: 'warning',
      message: `DO処方警告: 前回と同一内容です。${preview}${remainder}の漫然投与リスクを確認してください。`,
      details: {
        current_intake_id: currentIntake.id,
        previous_intake_id: previousIntake.id,
        current_prescribed_date: currentIntake.prescribed_date.toISOString(),
        previous_prescribed_date: previousIntake.prescribed_date.toISOString(),
        flagged_lines: flaggedLines,
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// 8. Elderly PIM (Potentially Inappropriate Medications) check (NEW)
// ---------------------------------------------------------------------------

async function checkElderlyPIM(
  prescriptionLines: PrescriptionLine[],
  patient: PatientForChecks | null,
  drugMasterMap?: Map<string, DrugMasterForCds>,
): Promise<CdsAlert[]> {
  const alerts: CdsAlert[] = [];

  if (!patient?.birth_date) return alerts;

  const age = differenceInYears(new Date(), patient.birth_date);
  if (age < 65) return alerts;

  const pimRules = await prisma.drugAlertRule.findMany({
    where: { alert_type: 'pim_elderly', is_active: true },
  });

  if (pimRules.length === 0) return alerts;

  // Resolve DrugMaster for therapeutic category matching
  const drugCodes = prescriptionLines
    .map((l) => l.drug_code)
    .filter((c): c is string => c !== null);

  let drugByCode: Map<string, Pick<DrugMasterForCds, 'yj_code' | 'therapeutic_category'>>;
  if (drugMasterMap) {
    drugByCode = drugMasterMap;
  } else {
    const prescribedDrugs =
      drugCodes.length > 0
        ? await prisma.drugMaster.findMany({
            where: { yj_code: { in: drugCodes } },
            select: { yj_code: true, therapeutic_category: true },
          })
        : [];
    drugByCode = new Map(prescribedDrugs.map((d) => [d.yj_code, d]));
  }

  for (const line of prescriptionLines) {
    if (!line.drug_code) continue;
    const drugInfo = drugByCode.get(line.drug_code);

    for (const rule of pimRules) {
      const condition = rule.condition as AlertRuleCondition | null;
      if (!condition) continue;

      const matchByCode = condition.yj_codes?.includes(line.drug_code) ?? false;
      const matchByCategory =
        drugInfo?.therapeutic_category &&
        (condition.therapeutic_categories?.includes(drugInfo.therapeutic_category) ?? false);

      if (matchByCode || matchByCategory) {
        alerts.push({
          type: 'pim_elderly',
          severity: 'warning',
          message: rule.message || `高齢者PIM警告: ${line.drug_name}（${age}歳）`,
          details: { rule_id: rule.id, drug: line.drug_name, patient_age: age },
        });
      }
    }
  }

  return alerts;
}

// ---------------------------------------------------------------------------
// 9. Renal dose adjustment alert (NEW)
// ---------------------------------------------------------------------------

async function checkRenalDoseAdjustment(
  prescriptionLines: PrescriptionLine[],
  patientId: string,
  orgId: string,
): Promise<CdsAlert[]> {
  const alerts: CdsAlert[] = [];

  // Fetch latest eGFR from PatientLabObservation
  const latestEgfr = await prisma.patientLabObservation.findFirst({
    where: { patient_id: patientId, org_id: orgId, analyte_code: 'egfr' },
    orderBy: { measured_at: 'desc' },
    select: { value_numeric: true },
  });

  const egfr = latestEgfr?.value_numeric ?? null;

  if (egfr === null) return alerts;

  // Fetch DrugPackageInsert with dosage_adjustment_renal for prescribed drugs
  const drugCodes = prescriptionLines
    .map((l) => l.drug_code)
    .filter((c): c is string => c !== null);

  if (drugCodes.length === 0) return alerts;

  const packageInserts = await prisma.drugPackageInsert.findMany({
    where: {
      drug_master: { yj_code: { in: drugCodes } },
      dosage_adjustment_renal: { not: Prisma.JsonNull },
    },
    include: {
      drug_master: { select: { yj_code: true, drug_name: true } },
    },
  });

  // Map by yj_code for quick lookup
  const insertByCode = new Map(packageInserts.map((pi) => [pi.drug_master.yj_code, pi]));

  for (const line of prescriptionLines) {
    if (!line.drug_code) continue;
    const pi = insertByCode.get(line.drug_code);
    if (!pi?.dosage_adjustment_renal) continue;

    // dosage_adjustment_renal is expected to be an array of { egfr_min, egfr_max, recommendation }
    const adjustments = (
      Array.isArray(pi.dosage_adjustment_renal) ? pi.dosage_adjustment_renal : []
    ) as RenalDoseEntry[];

    for (const adj of adjustments) {
      const min = adj.egfr_min ?? 0;
      const max = adj.egfr_max ?? Infinity;

      if (egfr >= min && egfr < max && adj.recommendation) {
        alerts.push({
          type: 'renal_dose',
          severity: 'warning',
          message: `腎機能用量調整: ${line.drug_name}（eGFR ${egfr}）— ${adj.recommendation}`,
          details: {
            drug: line.drug_name,
            egfr,
            egfr_range: `${min}-${max === Infinity ? '∞' : max}`,
            recommendation: adj.recommendation,
          },
        });
        break; // Only first matching range
      }
    }
  }

  return alerts;
}

// ---------------------------------------------------------------------------
// 10. PT-INR × anticoagulant / K × diuretic monitoring alerts
// ---------------------------------------------------------------------------

const ANTICOAGULANT_CATEGORY_PREFIXES = ['333'];
const ANTICOAGULANT_KEYWORDS = [
  'ワルファリン',
  'アピキサバン',
  'リバーロキサバン',
  'エドキサバン',
  'ダビガトラン',
];
const DIURETIC_CATEGORY_PREFIXES = ['213', '214', '2149'];
const DIURETIC_KEYWORDS = [
  'フロセミド',
  'スピロノラクトン',
  'トルバプタン',
  'アゾセミド',
  'カンレノ酸',
  'ヒドロクロロチアジド',
];

async function checkMonitoringAlerts(
  prescriptionLines: PrescriptionLine[],
  patientId: string,
  orgId: string,
  drugMasterMap?: Map<string, DrugMasterForCds>,
): Promise<CdsAlert[]> {
  const alerts: CdsAlert[] = [];

  const drugCodes = prescriptionLines
    .map((l) => l.drug_code)
    .filter((c): c is string => c !== null);

  let drugByCode: Map<string, Pick<DrugMasterForCds, 'yj_code' | 'therapeutic_category'>>;
  if (drugMasterMap) {
    drugByCode = drugMasterMap;
  } else {
    const prescribedDrugs =
      drugCodes.length > 0
        ? await prisma.drugMaster.findMany({
            where: { yj_code: { in: drugCodes } },
            select: { yj_code: true, therapeutic_category: true },
          })
        : [];
    drugByCode = new Map(prescribedDrugs.map((d) => [d.yj_code, d]));
  }

  let hasAnticoagulant = false;
  let hasDiuretic = false;

  for (const line of prescriptionLines) {
    const category = line.drug_code
      ? (drugByCode.get(line.drug_code)?.therapeutic_category ?? '')
      : '';
    if (
      ANTICOAGULANT_CATEGORY_PREFIXES.some((p) => category.startsWith(p)) ||
      ANTICOAGULANT_KEYWORDS.some((kw) => line.drug_name.includes(kw))
    )
      hasAnticoagulant = true;
    if (
      DIURETIC_CATEGORY_PREFIXES.some((p) => category.startsWith(p)) ||
      DIURETIC_KEYWORDS.some((kw) => line.drug_name.includes(kw))
    )
      hasDiuretic = true;
  }

  if (!hasAnticoagulant && !hasDiuretic) return alerts;

  const analyteCodes: string[] = [];
  if (hasAnticoagulant) analyteCodes.push('pt_inr');
  if (hasDiuretic) analyteCodes.push('k');

  const latestLabs = await prisma.patientLabObservation.findMany({
    where: {
      patient_id: patientId,
      org_id: orgId,
      analyte_code: { in: analyteCodes as LabAnalyteCode[] },
    },
    orderBy: { measured_at: 'desc' },
    select: { analyte_code: true, value_numeric: true },
  });

  const latestByAnalyte = new Map<string, number | null>();
  for (const row of latestLabs) {
    if (!latestByAnalyte.has(row.analyte_code)) {
      latestByAnalyte.set(row.analyte_code, row.value_numeric);
    }
  }

  if (hasAnticoagulant) {
    const ptInr = latestByAnalyte.get('pt_inr') ?? null;
    if (ptInr === null) {
      alerts.push({
        type: 'monitoring',
        severity: 'info',
        message: 'モニタリング: 抗凝固薬処方あり — PT-INR の直近値が未記録です',
        details: { analyte: 'pt_inr' },
      });
    } else if (ptInr >= 3.0) {
      alerts.push({
        type: 'monitoring',
        severity: 'critical',
        message: `モニタリング: 抗凝固薬 × PT-INR 高値（${ptInr}）— 出血リスク要確認`,
        details: { analyte: 'pt_inr', value: ptInr },
      });
    } else if (ptInr >= 2.5) {
      alerts.push({
        type: 'monitoring',
        severity: 'warning',
        message: `モニタリング: 抗凝固薬 × PT-INR 上昇傾向（${ptInr}）— 用量見直しを検討`,
        details: { analyte: 'pt_inr', value: ptInr },
      });
    }
  }

  if (hasDiuretic) {
    const k = latestByAnalyte.get('k') ?? null;
    if (k === null) {
      alerts.push({
        type: 'monitoring',
        severity: 'info',
        message: 'モニタリング: 利尿薬/RAA系薬処方あり — 血清K値の直近値が未記録です',
        details: { analyte: 'k' },
      });
    } else if (k < 3.0) {
      alerts.push({
        type: 'monitoring',
        severity: 'critical',
        message: `モニタリング: 利尿薬 × K低値（${k} mEq/L）— 低カリウム血症リスク要確認`,
        details: { analyte: 'k', value: k },
      });
    } else if (k < 3.5) {
      alerts.push({
        type: 'monitoring',
        severity: 'warning',
        message: `モニタリング: 利尿薬 × K低め（${k} mEq/L）— カリウム補充を検討`,
        details: { analyte: 'k', value: k },
      });
    }
  }

  return alerts;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Runs clinical decision support checks at dispense time.
 * Checks:
 *   1. Drug interactions (contraindicated)
 *   2. Duplicate medications
 *   3. Max administration days
 *   3b. Transitional expiry date
 *   4. Allergy cross-reactions (+ caution-level interactions)
 *   5. Narcotic / psychotropic flags
 *   6. High-risk drug counseling flag
 *   7. DO prescription long-term continuation risk
 *   8. Elderly PIM (potentially inappropriate medications)
 *   9. Renal dose adjustment
 *  10. PT-INR / K monitoring
 */
export async function checkDispenseAlerts(
  orgId: string,
  cycleId: string,
  patientId: string,
): Promise<CdsAlert[]> {
  const managedAlertStates = await resolveManagedAlertTypeStates();

  // Fetch prescription lines for this cycle
  const prescriptionLines = await prisma.prescriptionLine.findMany({
    where: {
      intake: { cycle_id: cycleId },
      org_id: orgId,
    },
    select: {
      id: true,
      drug_name: true,
      drug_code: true,
      dose: true,
      frequency: true,
      days: true,
    },
  });

  // Fetch current medications for this patient
  const currentMeds = await prisma.medicationProfile.findMany({
    where: { patient_id: patientId, is_current: true, org_id: orgId },
    select: {
      id: true,
      drug_name: true,
      drug_master_id: true,
    },
  });

  // Resolve drug_master details for current meds
  const currentMedMasterIds = currentMeds
    .map((m) => m.drug_master_id)
    .filter((id): id is string => id !== null && id !== undefined);

  const currentDrugMasters =
    currentMedMasterIds.length > 0
      ? await prisma.drugMaster.findMany({
          where: { id: { in: currentMedMasterIds } },
          select: { id: true, yj_code: true, drug_name: true, therapeutic_category: true },
        })
      : [];

  const masterByMedId = new Map<string, MasterInfo>();
  for (const med of currentMeds) {
    if (med.drug_master_id) {
      const master = currentDrugMasters.find((dm) => dm.id === med.drug_master_id);
      if (master) {
        masterByMedId.set(med.id, master);
      }
    }
  }

  // Fetch patient once for all checks that need it
  const patient = await prisma.patient.findFirst({
    where: { id: patientId, org_id: orgId },
    select: { birth_date: true, allergy_info: true },
  });

  // Single batch fetch for all drugMaster columns needed across all sub-checks
  const prescriptionDrugCodes = prescriptionLines
    .map((l) => l.drug_code)
    .filter((c): c is string => c !== null);
  const allDrugMasters =
    prescriptionDrugCodes.length > 0
      ? await prisma.drugMaster.findMany({
          where: { yj_code: { in: prescriptionDrugCodes } },
          select: {
            id: true,
            yj_code: true,
            drug_name: true,
            tall_man_name: true,
            therapeutic_category: true,
            max_administration_days: true,
            transitional_expiry_date: true,
            is_narcotic: true,
            is_psychotropic: true,
            is_high_risk: true,
            is_lasa_risk: true,
            lasa_group_key: true,
          },
        })
      : [];
  const drugMasterMap = new Map<string, DrugMasterForCds>(
    allDrugMasters.map((d) => [d.yj_code, d]),
  );

  // Run all checks in parallel
  const results = await Promise.all([
    managedAlertStates.get('interaction')
      ? checkInteractions(prescriptionLines, currentMeds, masterByMedId)
      : Promise.resolve([]),
    managedAlertStates.get('duplicate')
      ? checkDuplicates(prescriptionLines, currentMeds, masterByMedId)
      : Promise.resolve([]),
    managedAlertStates.get('max_days')
      ? checkMaxDays(prescriptionLines, drugMasterMap)
      : Promise.resolve([]),
    checkTransitionalExpiry(prescriptionLines, drugMasterMap),
    managedAlertStates.get('allergy_cross')
      ? checkAllergyReactions(prescriptionLines, patient, drugMasterMap)
      : Promise.resolve([]),
    managedAlertStates.get('narcotic')
      ? checkNarcoticFlags(prescriptionLines, drugMasterMap)
      : Promise.resolve([]),
    managedAlertStates.get('high_risk')
      ? checkHighRiskDrugs(prescriptionLines, drugMasterMap)
      : Promise.resolve([]),
    checkDoPrescriptionRisk(orgId, cycleId, patientId),
    managedAlertStates.get('pim_elderly')
      ? checkElderlyPIM(prescriptionLines, patient, drugMasterMap)
      : Promise.resolve([]),
    managedAlertStates.get('renal_dose')
      ? checkRenalDoseAdjustment(prescriptionLines, patientId, orgId)
      : Promise.resolve([]),
    // Package insert audit — always enabled (regulatory information)
    checkPackageInsertAudit(prescriptionLines, patient),
    // PT-INR / K monitoring — always enabled
    checkMonitoringAlerts(prescriptionLines, patientId, orgId, drugMasterMap),
  ]);

  return results.flat();
}
