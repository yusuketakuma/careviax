import { formatDateKey } from '@/lib/date-key';
import { prisma } from '@/lib/db/client';
import { readJsonObject } from '@/lib/db/json';
import { medicationIdentityKey } from '@/lib/prescription/medication-diff';
import { Prisma, type LabAnalyteCode, type PatientConditionType } from '@prisma/client';
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
  drug_master_id: string | null;
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

const DRUG_MASTER_FOR_CDS_SELECT = {
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
} satisfies Prisma.DrugMasterSelect;

type AllergyEntry = {
  drug_name?: string;
  drug_code?: string;
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

function yjIngredientPrefix(code: string | null | undefined): string | null {
  const normalized = code?.replace(/[^A-Za-z0-9]/g, '').toUpperCase() ?? '';
  return normalized.length >= 7 ? normalized.slice(0, 7) : null;
}

function hasSameYjIngredientPrefix(
  left: string | null | undefined,
  right: string | null | undefined,
) {
  const leftPrefix = yjIngredientPrefix(left);
  const rightPrefix = yjIngredientPrefix(right);
  return Boolean(leftPrefix && rightPrefix && leftPrefix === rightPrefix);
}

type RenalDoseEntry = {
  egfr_min?: number;
  egfr_max?: number;
  recommendation: string;
};

type PackageInsertTextEntry = {
  text: string;
  severity?: string;
};

type ParsedClinicalJsonEntries<T> = {
  entries: T[];
  malformedCount: number;
};

type AlertRuleCondition = {
  yj_codes?: string[];
  therapeutic_categories?: string[];
};

function buildCdsDataQualityAlert(args: {
  source: 'drug_alert_rule' | 'drug_package_insert';
  section: string;
  malformedCount: number;
  drugName?: string;
  drugCode?: string | null;
  ruleId?: string;
}): CdsAlert {
  const target = args.drugName ? `${args.drugName}の` : '';
  return {
    type: 'cds_data_quality',
    severity: 'warning',
    message: `CDSデータ形式確認: ${target}${args.section}に解析できない項目があります`,
    details: {
      source: args.source,
      section: args.section,
      malformed_count: args.malformedCount,
      ...(args.drugCode ? { drug_code: args.drugCode } : {}),
      ...(args.drugName ? { drug_display_name: args.drugName } : {}),
      ...(args.ruleId ? { rule_id: args.ruleId } : {}),
      recommendation: '薬剤マスター/臨床ルールの取込データを確認してください',
    },
  };
}

function buildPrescriptionLineDrugIdentityMismatchAlert(
  line: PrescriptionLine,
  master: DrugMasterForCds,
): CdsAlert {
  return {
    type: 'cds_data_quality',
    severity: 'warning',
    message: `CDS薬剤コード確認: ${line.drug_name}の処方行コードがDrugMasterと一致しません`,
    details: {
      source: 'prescription_line_drug_identity',
      section: '処方行医薬品コード',
      line_id: line.id,
      drug_master_id: line.drug_master_id,
      drug_code: line.drug_code,
      resolved_drug_code: master.yj_code,
      drug_display_name: line.drug_name,
      recommendation: '処方行のdrug_master_id/source_drug_code/drug_codeの整合性を確認してください',
    },
  };
}

// X02: 処方行の医薬品コードが未解決だとアレルギー交差チェックはコード/薬効分類で
// 照合できず、name-based 照合しか行えない。無言スキップ（allergy-clean 扱い）は
// false-negative を生むため、「照合未完了（要確認）」を明示するシグナルを出す。
function buildAllergyCrossCheckIncompleteAlert(line: PrescriptionLine): CdsAlert {
  return {
    type: 'cds_data_quality',
    severity: 'warning',
    message: `アレルギー照合未完了（要確認）: ${line.drug_name}は医薬品コード未解決のためアレルギー交差チェックを完了できません`,
    details: {
      source: 'allergy_cross_check',
      section: 'アレルギー交差チェック',
      line_id: line.id,
      drug_master_id: line.drug_master_id,
      drug_display_name: line.drug_name,
      unresolved: 'drug_code',
      recommendation:
        '処方行の医薬品コード（drug_master_id/drug_code）を解決し、アレルギー交差チェックを手動で確認してください',
    },
  };
}

// CXR1-MSR01: legacy な string / 非構造 object 形式の allergy_info は交差チェックに
// 使えない。無言で allergy-clean 扱いにすると、他コードが allergy-present とみなす
// 患者で false-negative になるため、「アレルギー情報が未構造化（要確認）」を明示する。
function buildAllergyInfoUnstructuredAlert(): CdsAlert {
  return {
    type: 'cds_data_quality',
    severity: 'warning',
    message:
      'アレルギー情報形式確認（要確認）: 患者アレルギー情報が未構造化のためアレルギー交差チェックを完了できません',
    details: {
      source: 'allergy_info_format',
      section: '患者アレルギー情報',
      recommendation:
        '患者アレルギー情報を構造化形式（drug_name/drug_code/therapeutic_category 等）で登録し直し、アレルギー交差チェックを手動で確認してください',
    },
  };
}

// F81 + X03: 医薬品コード/マスターが未解決の薬剤は、相互作用・重複などの
// コードベース CDS チェック（yj_code 照合）から無言で除外される。無言スキップは
// 「チェック済み・問題なし」に見えてしまい false-negative を生むため、
// 「未解決のため照合不能な薬剤が N 件ある」旨の data-quality 警告を明示する。
// - unresolvedCurrentMeds: DrugMaster に解決できない現行薬（drug_master_id=null 含む）。
//   checkInteractions は解決できない現行薬を無言スキップするため相互作用照合から漏れる。
// - unresolvedPrescriptionLines: drug_code 未解決の処方行。コードベースの全チェックから漏れる。
function buildCdsIdentityUnresolvedAlert(args: {
  unresolvedPrescriptionLines: PrescriptionLine[];
  unresolvedCurrentMeds: CurrentMed[];
}): CdsAlert {
  const lineCount = args.unresolvedPrescriptionLines.length;
  const medCount = args.unresolvedCurrentMeds.length;
  const total = lineCount + medCount;
  const breakdown: string[] = [];
  if (lineCount > 0) breakdown.push(`処方${lineCount}件`);
  if (medCount > 0) breakdown.push(`併用薬${medCount}件`);
  return {
    type: 'cds_data_quality',
    severity: 'warning',
    message: `CDS照合未完了（要確認）: 医薬品コード未解決のため相互作用・重複などのコードベースCDSチェックを完了できない薬剤が${total}件あります（${breakdown.join(
      ' / ',
    )}）`,
    details: {
      source: 'cds_identity_unresolved',
      section: '医薬品コード照合',
      unresolved_prescription_line_count: lineCount,
      unresolved_current_med_count: medCount,
      unresolved_prescription_line_ids: args.unresolvedPrescriptionLines.map((line) => line.id),
      unresolved_current_med_ids: args.unresolvedCurrentMeds.map((med) => med.id),
      recommendation:
        '未解決の処方行/併用薬の医薬品コード（drug_master_id/drug_code）を解決し、相互作用・重複などのCDSチェックを手動で確認してください',
    },
  };
}

// allergy_info を交差チェック可能な entry 配列に正規化する。
// - 配列: 各要素を検査（構造化 object のみ採用）
// - 単一 object: 認識可能なフィールドがあれば 1 entry として採用
// - それ以外の非空値（legacy free-text string 等）: unstructured=true（要確認シグナル）
// 空配列・空文字列は「アレルギー無し」を意味するので unstructured にはしない。
function coerceAllergyEntry(value: unknown): AllergyEntry | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const obj = value as Record<string, unknown>;
  const hasRecognizedField =
    typeof obj.drug_name === 'string' ||
    typeof obj.drug_code === 'string' ||
    typeof obj.therapeutic_category === 'string' ||
    typeof obj.substance === 'string';
  return hasRecognizedField ? (obj as AllergyEntry) : null;
}

function isNonEmptyAllergyValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'object') return Object.keys(value as object).length > 0;
  return true; // number / boolean 等の非空値
}

function normalizeAllergyInfo(allergyInfo: Prisma.JsonValue): {
  entries: AllergyEntry[];
  unstructured: boolean;
} {
  const rawItems = Array.isArray(allergyInfo) ? allergyInfo : [allergyInfo];
  const entries: AllergyEntry[] = [];
  let unstructured = false;
  for (const item of rawItems) {
    const entry = coerceAllergyEntry(item);
    if (entry) {
      entries.push(entry);
    } else if (isNonEmptyAllergyValue(item)) {
      unstructured = true;
    }
  }
  return { entries, unstructured };
}

function uniqueNonEmpty(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(
      values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)),
    ),
  );
}

async function resolvePrescriptionLineDrugIdentitiesForCds(lines: PrescriptionLine[]): Promise<{
  lines: PrescriptionLine[];
  drugMasterMap: Map<string, DrugMasterForCds>;
  dataQualityAlerts: CdsAlert[];
}> {
  const drugMasterIds = uniqueNonEmpty(lines.map((line) => line.drug_master_id));
  const drugCodes = uniqueNonEmpty(lines.map((line) => line.drug_code));

  let where: Prisma.DrugMasterWhereInput | null = null;
  if (drugMasterIds.length > 0 && drugCodes.length > 0) {
    where = {
      OR: [{ id: { in: drugMasterIds } }, { yj_code: { in: drugCodes } }],
    };
  } else if (drugMasterIds.length > 0) {
    where = { id: { in: drugMasterIds } };
  } else if (drugCodes.length > 0) {
    where = { yj_code: { in: drugCodes } };
  }

  const drugMasters = where
    ? ((await prisma.drugMaster.findMany({
        where,
        select: DRUG_MASTER_FOR_CDS_SELECT,
      })) as DrugMasterForCds[])
    : [];

  const drugMasterById = new Map(drugMasters.map((drug) => [drug.id, drug]));
  const drugMasterMap = new Map(drugMasters.map((drug) => [drug.yj_code, drug]));
  const dataQualityAlerts: CdsAlert[] = [];

  const normalizedLines = lines.map((line) => {
    if (!line.drug_master_id) return line;

    const master = drugMasterById.get(line.drug_master_id);
    if (!master) return line;

    const lineDrugCode = line.drug_code?.trim() || null;
    if (lineDrugCode && lineDrugCode !== master.yj_code) {
      dataQualityAlerts.push(buildPrescriptionLineDrugIdentityMismatchAlert(line, master));
    }

    return { ...line, drug_code: master.yj_code };
  });

  return { lines: normalizedLines, drugMasterMap, dataQualityAlerts };
}

function readNonEmptyText(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function readPackageInsertObjectText(object: Record<string, unknown>) {
  return (
    readNonEmptyText(object.text) ??
    readNonEmptyText(object.name) ??
    readNonEmptyText(object.description)
  );
}

function readPackageInsertTextEntry(item: unknown): PackageInsertTextEntry | null {
  const text = readNonEmptyText(item);
  if (text) return { text };

  const object = readJsonObject(item);
  if (!object) return null;

  const objectText = readPackageInsertObjectText(object);
  if (!objectText) return null;

  const severity = typeof object.severity === 'string' ? object.severity : undefined;
  return { text: objectText, ...(severity !== undefined ? { severity } : {}) };
}

function readPackageInsertTextEntries(
  value: unknown,
): ParsedClinicalJsonEntries<PackageInsertTextEntry> {
  if (value === null || value === undefined) return { entries: [], malformedCount: 0 };

  if (!Array.isArray(value)) {
    const object = readJsonObject(value);
    if (!object) {
      const entry = readPackageInsertTextEntry(value);
      return entry ? { entries: [entry], malformedCount: 0 } : { entries: [], malformedCount: 1 };
    }

    const entries = Object.entries(object).flatMap(([key, item]): PackageInsertTextEntry[] => {
      const text = readNonEmptyText(item) ?? (readJsonObject(item) ? JSON.stringify(item) : null);
      return text ? [{ text: `${key}: ${text}` }] : [];
    });
    return { entries, malformedCount: entries.length === 0 ? 1 : 0 };
  }

  let malformedCount = 0;
  const entries = value.flatMap((item): PackageInsertTextEntry[] => {
    const entry = readPackageInsertTextEntry(item);
    if (!entry) {
      malformedCount += 1;
      return [];
    }
    return [entry];
  });
  return { entries, malformedCount };
}

function readOptionalFiniteNumber(value: unknown) {
  return value === undefined || value === null
    ? undefined
    : typeof value === 'number' && Number.isFinite(value)
      ? value
      : null;
}

function readRenalDoseEntries(value: unknown): ParsedClinicalJsonEntries<RenalDoseEntry> {
  if (value === null || value === undefined) return { entries: [], malformedCount: 0 };
  if (!Array.isArray(value)) return { entries: [], malformedCount: 1 };

  let malformedCount = 0;
  const entries = value.flatMap((item): RenalDoseEntry[] => {
    const object = readJsonObject(item);
    if (!object) {
      malformedCount += 1;
      return [];
    }

    const egfrMin = readOptionalFiniteNumber(object.egfr_min);
    const egfrMax = readOptionalFiniteNumber(object.egfr_max);
    const recommendation =
      typeof object.recommendation === 'string' && object.recommendation.trim().length > 0
        ? object.recommendation
        : null;

    if (egfrMin === null || egfrMax === null || !recommendation) {
      malformedCount += 1;
      return [];
    }

    return [
      {
        ...(egfrMin !== undefined ? { egfr_min: egfrMin } : {}),
        ...(egfrMax !== undefined ? { egfr_max: egfrMax } : {}),
        recommendation,
      },
    ];
  });
  return { entries, malformedCount };
}

function readAlertRuleStringArray(
  condition: Record<string, unknown>,
  key: keyof AlertRuleCondition,
): ParsedClinicalJsonEntries<string> {
  const value = condition[key];
  if (value === undefined || value === null) return { entries: [], malformedCount: 0 };
  if (!Array.isArray(value)) return { entries: [], malformedCount: 1 };

  let malformedCount = 0;
  const entries = value.flatMap((item): string[] => {
    const text = readNonEmptyText(item);
    if (!text) {
      malformedCount += 1;
      return [];
    }
    return [text.trim()];
  });
  return { entries, malformedCount };
}

function matchesAlertRuleCondition(
  condition: unknown,
  drugCode: string,
  therapeuticCategory?: string | null,
): { matched: boolean; malformedCount: number } {
  const conditionObject = readJsonObject(condition);
  if (!conditionObject) {
    return {
      matched: false,
      malformedCount: condition === null || condition === undefined ? 0 : 1,
    };
  }

  const yjCodes = readAlertRuleStringArray(conditionObject, 'yj_codes');
  const therapeuticCategories = readAlertRuleStringArray(conditionObject, 'therapeutic_categories');
  const hasValidCriteria = yjCodes.entries.length > 0 || therapeuticCategories.entries.length > 0;
  const malformedCount =
    yjCodes.malformedCount + therapeuticCategories.malformedCount + (hasValidCriteria ? 0 : 1);

  if (yjCodes.entries.includes(drugCode)) return { matched: true, malformedCount };
  if (!therapeuticCategory) return { matched: false, malformedCount };
  return {
    matched: therapeuticCategories.entries.includes(therapeuticCategory),
    malformedCount,
  };
}

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

function scopedDrugAlertRuleWhere(
  orgId: string,
  where: Prisma.DrugAlertRuleWhereInput,
): Prisma.DrugAlertRuleWhereInput {
  return {
    ...where,
    OR: [{ org_id: orgId }, { org_id: null }],
  };
}

async function resolveManagedAlertTypeStates(orgId: string) {
  const configuredRules = await prisma.drugAlertRule.findMany({
    where: scopedDrugAlertRuleWhere(orgId, {
      alert_type: {
        in: MANAGED_ALERT_TYPES,
      },
    }),
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
  line: Pick<
    PrescriptionLine,
    'drug_name' | 'drug_master_id' | 'drug_code' | 'dose' | 'frequency' | 'days'
  >,
) {
  return [medicationIdentityKey(line), line.dose, line.frequency, String(line.days)].join('::');
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

      // Code-resolved prescription lines must not fall back to drug-name matching.
      // Same display names can represent different strengths/products.
      continue;
    }

    const dupByName = currentMeds.find(
      (m) => !masterByMedId.has(m.id) && m.drug_name === line.drug_name,
    );
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

// X05: 添付文書 alert の臨床重要度ランク（大きいほど重要 = 重大 > 注意 > 情報）。
// severity は添付文書取込データ由来の自由形式文字列のため、既知の重大/注意マーカーを
// マップする。未知/未設定は情報（最低ランク）扱い。切り捨て時に重要項目を優先的に残す
// ためだけに使い、表示 alert 自体の severity は据え置く（誤った critical 昇格を避ける）。
function packageInsertSeverityRank(entry: PackageInsertTextEntry): number {
  const raw = entry.severity?.trim().toLowerCase();
  if (!raw) return 0;
  // 重大（serious / 重大 / 警告 / 禁忌 / critical）
  if (
    raw.includes('serious') ||
    raw.includes('重大') ||
    raw.includes('critical') ||
    raw.includes('warning') ||
    raw.includes('警告') ||
    raw.includes('禁忌') ||
    raw.includes('danger') ||
    raw.includes('severe') ||
    raw.includes('high')
  ) {
    return 2;
  }
  // 注意（caution / 注意 / 慎重）
  if (
    raw.includes('caution') ||
    raw.includes('注意') ||
    raw.includes('慎重') ||
    raw.includes('moderate')
  ) {
    return 1;
  }
  return 0;
}

// X05: 添付文書 alert が unsorted のまま slice(0, N) で切り捨てられると、重大な項目が
// 後方に居た場合に無言で落ちる（false-negative）。臨床重要度降順 → 決定的 tie-break
// （元の順序）で整列してから上限件数で制限し、切り捨てが起きた件数を返す。
function rankAndLimitPackageInsertEntries(
  entries: PackageInsertTextEntry[],
  limit: number,
): { shown: PackageInsertTextEntry[]; hiddenCount: number } {
  const sorted = entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => {
      const rankDiff = packageInsertSeverityRank(b.entry) - packageInsertSeverityRank(a.entry);
      if (rankDiff !== 0) return rankDiff;
      // 決定的 tie-break: 元の出現順を維持（同一入力で常に同一結果）。
      return a.index - b.index;
    })
    .map((item) => item.entry);
  const shown = sorted.slice(0, Math.max(0, limit));
  return { shown, hiddenCount: Math.max(0, sorted.length - shown.length) };
}

// X05: 切り捨てが起きたことを件数で明示する counted-list 契約の marker alert。
// 「N 件中 M 件のみ表示、残りは未表示（要確認）」を出し、隠れた項目に重大な禁忌等が
// 含まれうる旨を fail-open に surface する（無言で落とさない）。
function buildPackageInsertTruncationAlert(args: {
  type:
    | 'package_insert_contraindication_truncated'
    | 'package_insert_adverse_effect_truncated'
    | 'package_insert_elderly_truncated';
  section: string;
  sectionKey: 'contraindication' | 'adverse_effect' | 'elderly';
  drugName: string;
  drugCode: string;
  shownCount: number;
  hiddenCount: number;
}): CdsAlert {
  const totalCount = args.shownCount + args.hiddenCount;
  return {
    type: args.type,
    severity: 'warning',
    message: `【${args.section}】${args.drugName}: 重要度上位${args.shownCount}件を表示、他${args.hiddenCount}件は未表示（全${totalCount}件、要確認）`,
    details: {
      drug_code: args.drugCode,
      section: args.sectionKey,
      truncated: true,
      shown_count: args.shownCount,
      hidden_count: args.hiddenCount,
      total_count: totalCount,
      recommendation: '添付文書で未表示の項目（重大な項目を含みうる）を確認してください',
    },
  };
}

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

    const contraindications = readPackageInsertTextEntries(pi.contraindications);
    if (contraindications.malformedCount > 0) {
      alerts.push(
        buildCdsDataQualityAlert({
          source: 'drug_package_insert',
          section: '禁忌',
          malformedCount: contraindications.malformedCount,
          drugName,
          drugCode: line.drug_code,
        }),
      );
    }
    const contraindicationsLimited = rankAndLimitPackageInsertEntries(contraindications.entries, 3);
    for (const item of contraindicationsLimited.shown) {
      alerts.push({
        type: 'package_insert_contraindication',
        severity: 'info',
        message: `【禁忌】${drugName}: ${item.text.slice(0, 100)}`,
        details: { drug_code: line.drug_code, section: 'contraindication' },
      });
    }
    if (contraindicationsLimited.hiddenCount > 0) {
      alerts.push(
        buildPackageInsertTruncationAlert({
          type: 'package_insert_contraindication_truncated',
          section: '禁忌',
          sectionKey: 'contraindication',
          drugName,
          drugCode: line.drug_code,
          shownCount: contraindicationsLimited.shown.length,
          hiddenCount: contraindicationsLimited.hiddenCount,
        }),
      );
    }

    const adverseEffects = readPackageInsertTextEntries(pi.adverse_effects);
    if (adverseEffects.malformedCount > 0) {
      alerts.push(
        buildCdsDataQualityAlert({
          source: 'drug_package_insert',
          section: '重大な副作用',
          malformedCount: adverseEffects.malformedCount,
          drugName,
          drugCode: line.drug_code,
        }),
      );
    }
    const seriousAdverseEffects = adverseEffects.entries.filter(
      (item) => item.severity === 'serious' || item.severity === '重大',
    );
    const seriousAdverseEffectsLimited = rankAndLimitPackageInsertEntries(seriousAdverseEffects, 2);
    for (const item of seriousAdverseEffectsLimited.shown) {
      alerts.push({
        type: 'package_insert_adverse_effect',
        severity: 'info',
        message: `【重大な副作用】${drugName}: ${item.text.slice(0, 100)}`,
        details: { drug_code: line.drug_code, section: 'adverse_effect' },
      });
    }
    if (seriousAdverseEffectsLimited.hiddenCount > 0) {
      alerts.push(
        buildPackageInsertTruncationAlert({
          type: 'package_insert_adverse_effect_truncated',
          section: '重大な副作用',
          sectionKey: 'adverse_effect',
          drugName,
          drugCode: line.drug_code,
          shownCount: seriousAdverseEffectsLimited.shown.length,
          hiddenCount: seriousAdverseEffectsLimited.hiddenCount,
        }),
      );
    }

    if (patientAge !== null && patientAge >= 65) {
      const elderlyPrecautions = readPackageInsertTextEntries(pi.precautions_elderly);
      if (elderlyPrecautions.malformedCount > 0) {
        alerts.push(
          buildCdsDataQualityAlert({
            source: 'drug_package_insert',
            section: '高齢者注意',
            malformedCount: elderlyPrecautions.malformedCount,
            drugName,
            drugCode: line.drug_code,
          }),
        );
      }
      const elderlyPrecautionsLimited = rankAndLimitPackageInsertEntries(
        elderlyPrecautions.entries,
        2,
      );
      for (const item of elderlyPrecautionsLimited.shown) {
        alerts.push({
          type: 'package_insert_elderly',
          severity: 'warning',
          message: `【高齢者注意】${drugName}（${patientAge}歳）: ${item.text.slice(0, 100)}`,
          details: { drug_code: line.drug_code, section: 'elderly', patient_age: patientAge },
        });
      }
      if (elderlyPrecautionsLimited.hiddenCount > 0) {
        alerts.push(
          buildPackageInsertTruncationAlert({
            type: 'package_insert_elderly_truncated',
            section: '高齢者注意',
            sectionKey: 'elderly',
            drugName,
            drugCode: line.drug_code,
            shownCount: elderlyPrecautionsLimited.shown.length,
            hiddenCount: elderlyPrecautionsLimited.hiddenCount,
          }),
        );
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

    const expiryDateKey = formatDateKey(drug.transitional_expiry_date);
    const daysUntilExpiry = Math.floor(
      (drug.transitional_expiry_date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
    );

    if (daysUntilExpiry < 0) {
      alerts.push({
        type: 'transitional_expiry',
        severity: 'critical',
        message: `経過措置期限切れ: ${drug.drug_name}（${expiryDateKey}に失効済み）`,
        details: {
          drug_code: drug.yj_code,
          expiry_date: drug.transitional_expiry_date.toISOString(),
        },
      });
    } else if (daysUntilExpiry <= 90) {
      alerts.push({
        type: 'transitional_expiry',
        severity: 'warning',
        message: `経過措置期限接近: ${drug.drug_name}（残${daysUntilExpiry}日、${expiryDateKey}）`,
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
  orgId: string,
  prescriptionLines: PrescriptionLine[],
  patient: PatientForChecks | null,
  drugMasterMap?: Map<string, DrugMasterForCds>,
): Promise<CdsAlert[]> {
  const alerts: CdsAlert[] = [];

  if (!patient?.allergy_info) return alerts;

  // CXR1-MSR01: legacy string / 非構造 object も無視せず正規化し、構造化できない場合は
  // 「要確認」シグナルを出す（allergy-clean へ倒さない）。
  const { entries: allergyEntries, unstructured: allergyInfoUnstructured } = normalizeAllergyInfo(
    patient.allergy_info,
  );

  if (allergyInfoUnstructured) {
    alerts.push(buildAllergyInfoUnstructuredAlert());
  }

  if (allergyEntries.length === 0) return alerts;

  // Fetch allergy_cross rules
  const allergyRules = await prisma.drugAlertRule.findMany({
    where: scopedDrugAlertRuleWhere(orgId, { alert_type: 'allergy_cross', is_active: true }),
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

  const reportedMalformedRuleIds = new Set<string>();
  for (const line of prescriptionLines) {
    // X02: drug_code 未解決の処方行を無言スキップしない。コード/薬効分類での照合は
    // できないが、name-based 照合は依然有効なので実行し、加えて「照合未完了（要確認）」
    // を明示する（allergy-clean に倒さない）。
    if (!line.drug_code) {
      alerts.push(buildAllergyCrossCheckIncompleteAlert(line));
    }
    const drugInfo = line.drug_code ? drugByCode.get(line.drug_code) : undefined;

    // Check against allergy entries
    for (const allergy of allergyEntries) {
      const allergyDrugCode = allergy.drug_code?.trim();
      if (allergyDrugCode && line.drug_code && allergyDrugCode === line.drug_code) {
        alerts.push({
          type: 'allergy_cross',
          severity: allergyAlertSeverity(allergy.severity),
          message: `アレルギー交差反応: ${line.drug_name}（患者アレルギー: ${allergy.drug_name ?? allergyDrugCode}）`,
          details: {
            allergy_drug: allergy.drug_name,
            allergy_drug_code: allergyDrugCode,
            prescribed_drug: line.drug_name,
            prescribed_drug_code: line.drug_code,
            allergy_severity: allergy.severity,
          },
        });
      } else if (
        allergy.drug_name &&
        line.drug_name.includes(allergy.drug_name) &&
        (!allergyDrugCode || hasSameYjIngredientPrefix(allergyDrugCode, line.drug_code))
      ) {
        alerts.push({
          type: 'allergy_cross',
          severity: allergyAlertSeverity(allergy.severity),
          message: `アレルギー交差反応: ${line.drug_name}（患者アレルギー: ${allergy.drug_name}）`,
          details: {
            allergy_drug: allergy.drug_name,
            ...(allergyDrugCode ? { allergy_drug_code: allergyDrugCode } : {}),
            prescribed_drug: line.drug_name,
            ...(line.drug_code ? { prescribed_drug_code: line.drug_code } : {}),
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

    // Check against DrugAlertRule allergy_cross rules.
    // ルール照合は yj_code / 薬効分類ベースのため、drug_code 未解決行では実行しない
    // （name-based 照合と「照合未完了」シグナルは上で済ませている）。
    for (const rule of allergyRules) {
      if (!line.drug_code) continue;
      const conditionMatch = matchesAlertRuleCondition(
        rule.condition,
        line.drug_code,
        drugInfo?.therapeutic_category,
      );
      if (conditionMatch.malformedCount > 0 && !reportedMalformedRuleIds.has(rule.id)) {
        alerts.push(
          buildCdsDataQualityAlert({
            source: 'drug_alert_rule',
            section: 'アレルギー交差ルール',
            malformedCount: conditionMatch.malformedCount,
            drugName: line.drug_name,
            drugCode: line.drug_code,
            ruleId: rule.id,
          }),
        );
        reportedMalformedRuleIds.add(rule.id);
      }

      if (conditionMatch.matched) {
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
  orgId: string,
  prescriptionLines: PrescriptionLine[],
  drugMasterMap?: Map<string, DrugMasterForCds>,
): Promise<CdsAlert[]> {
  const alerts: CdsAlert[] = [];

  const highRiskRules = await prisma.drugAlertRule.findMany({
    where: scopedDrugAlertRuleWhere(orgId, { alert_type: 'high_risk', is_active: true }),
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

  const reportedMalformedRuleIds = new Set<string>();
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
      const conditionMatch = matchesAlertRuleCondition(
        rule.condition,
        line.drug_code,
        drugInfo?.therapeutic_category,
      );
      if (conditionMatch.malformedCount > 0 && !reportedMalformedRuleIds.has(rule.id)) {
        alerts.push(
          buildCdsDataQualityAlert({
            source: 'drug_alert_rule',
            section: '高リスク薬ルール',
            malformedCount: conditionMatch.malformedCount,
            drugName: displayName,
            drugCode: line.drug_code,
            ruleId: rule.id,
          }),
        );
        reportedMalformedRuleIds.add(rule.id);
      }

      if (conditionMatch.matched) {
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
          drug_master_id: true,
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
          drug_master_id: true,
          drug_code: true,
          dose: true,
          frequency: true,
          days: true,
        },
      },
    },
  });

  if (!previousIntake || previousIntake.lines.length === 0) return [];
  const resolved = await resolvePrescriptionLineDrugIdentitiesForCds([
    ...currentIntake.lines,
    ...previousIntake.lines,
  ]);
  const currentLines = resolved.lines.slice(0, currentIntake.lines.length);
  const previousLines = resolved.lines.slice(currentIntake.lines.length);

  if (!isSamePrescriptionContent(currentLines, previousLines)) return [];

  const flaggedLines = currentLines
    .map((line) => {
      const previousLine = findMatchingPreviousLine(previousLines, line);
      if (!previousLine) return null;

      const riskProfile = resolveDoPrescriptionRiskProfile(
        line,
        line.drug_code ? resolved.drugMasterMap.get(line.drug_code) : undefined,
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
  orgId: string,
  prescriptionLines: PrescriptionLine[],
  patient: PatientForChecks | null,
  drugMasterMap?: Map<string, DrugMasterForCds>,
): Promise<CdsAlert[]> {
  const alerts: CdsAlert[] = [];

  if (!patient?.birth_date) return alerts;

  const age = differenceInYears(new Date(), patient.birth_date);
  if (age < 65) return alerts;

  const pimRules = await prisma.drugAlertRule.findMany({
    where: scopedDrugAlertRuleWhere(orgId, { alert_type: 'pim_elderly', is_active: true }),
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

  const reportedMalformedRuleIds = new Set<string>();
  for (const line of prescriptionLines) {
    if (!line.drug_code) continue;
    const drugInfo = drugByCode.get(line.drug_code);

    for (const rule of pimRules) {
      const conditionMatch = matchesAlertRuleCondition(
        rule.condition,
        line.drug_code,
        drugInfo?.therapeutic_category,
      );
      if (conditionMatch.malformedCount > 0 && !reportedMalformedRuleIds.has(rule.id)) {
        alerts.push(
          buildCdsDataQualityAlert({
            source: 'drug_alert_rule',
            section: '高齢者PIMルール',
            malformedCount: conditionMatch.malformedCount,
            drugName: line.drug_name,
            drugCode: line.drug_code,
            ruleId: rule.id,
          }),
        );
        reportedMalformedRuleIds.add(rule.id);
      }

      if (conditionMatch.matched) {
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

// X04: eGFR/腎機能が未記録の患者では腎機能用量チェックを実施できない。無言で
// 「該当なし（clean）」に倒すと、実際には腎排泄型薬剤で減量が必要でも見落とされ
// false-negative を生む。腎機能用量調整データを持つ薬剤が処方されているのに eGFR が
// 未記録の場合は「腎機能未記録のため用量チェック未実施（要確認）」を明示する。
function buildRenalFunctionUnrecordedCoverageNotice(
  lines: Array<Pick<PrescriptionLine, 'drug_name' | 'drug_code'>>,
): CdsAlert {
  return {
    type: 'cds_data_quality',
    severity: 'warning',
    message: `腎機能用量チェック未完了（要確認）: eGFR/腎機能が未記録のため、腎機能用量調整対象${lines.length}剤の用量チェックを実施できません`,
    details: {
      source: 'renal_dose_coverage',
      section: '腎機能用量調整',
      unchecked_drug_count: lines.length,
      unchecked_drug_names: lines.map((line) => line.drug_name),
      unchecked_drug_codes: lines.map((line) => line.drug_code),
      recommendation:
        '直近のeGFR/血清クレアチニン検査値を登録し、腎排泄型薬剤の用量を添付文書の腎機能別用量調整欄と手動で照合してください',
    },
  };
}

async function checkRenalDoseAdjustment(
  prescriptionLines: PrescriptionLine[],
  patientId: string,
  orgId: string,
): Promise<CdsAlert[]> {
  const alerts: CdsAlert[] = [];

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

  // 腎機能用量調整データを持つ薬剤が処方されているか（eGFR 未記録時の coverage 判定用）。
  const renalRelevantLines = prescriptionLines.filter(
    (line) => line.drug_code !== null && insertByCode.has(line.drug_code),
  );

  // Fetch latest eGFR from PatientLabObservation
  const latestEgfr = await prisma.patientLabObservation.findFirst({
    where: { patient_id: patientId, org_id: orgId, analyte_code: 'egfr' },
    orderBy: { measured_at: 'desc' },
    select: { value_numeric: true },
  });

  const egfr = latestEgfr?.value_numeric ?? null;

  // X04: eGFR 未記録時は無言 clean に倒さず、腎機能用量調整対象薬があれば
  // 「未チェック（要確認）」を明示する（対象薬が無ければ宣言対象が無いので何もしない）。
  if (egfr === null) {
    if (renalRelevantLines.length > 0) {
      alerts.push(buildRenalFunctionUnrecordedCoverageNotice(renalRelevantLines));
    }
    return alerts;
  }

  for (const line of prescriptionLines) {
    if (!line.drug_code) continue;
    const pi = insertByCode.get(line.drug_code);
    if (!pi?.dosage_adjustment_renal) continue;

    const adjustments = readRenalDoseEntries(pi.dosage_adjustment_renal);
    if (adjustments.malformedCount > 0) {
      alerts.push(
        buildCdsDataQualityAlert({
          source: 'drug_package_insert',
          section: '腎機能用量調整',
          malformedCount: adjustments.malformedCount,
          drugName: line.drug_name,
          drugCode: line.drug_code,
        }),
      );
    }

    for (const adj of adjustments.entries) {
      const min = adj.egfr_min ?? 0;
      const max = adj.egfr_max ?? Infinity;

      if (egfr >= min && egfr < max) {
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
// 11. 病名／問題リスト（PatientCondition）ベースの禁忌クロスチェック（F82）
// ---------------------------------------------------------------------------
//
// 【設計メモ / F82】
// 患者の病名／問題リスト（PatientCondition: 緑内障・重症筋無力症・前立腺肥大症・
// 気管支喘息 等）は、これまで CDS のどのチェックにも渡されておらず、「病名禁忌」
// （当該疾患を持つ患者に禁忌の薬剤）が体系的に照合されていなかった。添付文書の
// 禁忌欄（DrugPackageInsert.contraindications）は checkPackageInsertAudit で info
// として一覧表示されるだけで、「この患者が実際にその病名を持つ」という患者固有の
// 突合は無く、病名禁忌アラートは一切上がらなかった。
//
// 権威ある病名禁忌マスタ（疾患コード × 薬剤の構造化データ）の新設は新機能級
// （新 AlertType + DB migration）であり、本レーンの範囲外。そこで、DB スキーマを
// 変えずに既存データ（PatientCondition.name ＋ 添付文書禁忌欄の自由テキスト）だけで
// 実現できる暫定の安全側改善として、次の2段構えを実装する:
//
//  (1) fail-close の網羅性宣言（常時）: 患者に有効な病名／問題があり、かつ処方が
//      ある場合、「病名ベース禁忌チェックは名称照合のみで網羅的でない（要手動確認）」
//      という data-quality（coverage）シグナルを必ず1件出す。これにより「病名禁忌
//      アラートが無い＝チェック済みで問題なし」という誤読（false-negative の安心）を
//      防ぐ。X04（腎機能 coverage notice）と同じ思想。
//
//  (2) fail-safe の best-effort surfacing（付加のみ）: 添付文書の禁忌欄テキストに
//      患者の病名／問題名（2文字以上）が含まれていれば、`condition_contraindication`
//      critical アラートを追加する。名称照合ゆえ false-positive はありうるが、本
//      チェックはアラートを「追加」するだけで既存チェックを抑制せず、取りこぼし
//      （同義語・表記ゆれ等の false-negative）は上記(1)の coverage notice が担保する。

type PatientConditionForCds = {
  name: string;
  condition_type: PatientConditionType;
};

function buildConditionContraindicationCoverageNotice(
  conditions: PatientConditionForCds[],
): CdsAlert {
  return {
    type: 'cds_data_quality',
    severity: 'warning',
    message:
      '病名禁忌チェック未完了（要確認）: 病名／問題リストに基づく禁忌チェックは名称照合のみで網羅的ではありません。添付文書の禁忌欄と手動で照合してください',
    details: {
      source: 'condition_contraindication_coverage',
      section: '病名禁忌クロスチェック',
      condition_count: conditions.length,
      condition_names: conditions.map((condition) => condition.name),
      recommendation:
        '患者の病名／問題（緑内障・重症筋無力症・前立腺肥大症 等）と各薬剤の添付文書禁忌欄を手動で照合してください',
    },
  };
}

async function checkConditionContraindications(
  prescriptionLines: PrescriptionLine[],
  conditions: PatientConditionForCds[],
): Promise<CdsAlert[]> {
  // 病名／問題が無い、または処方が無い場合は宣言対象が無いので何もしない。
  if (conditions.length === 0 || prescriptionLines.length === 0) return [];

  const alerts: CdsAlert[] = [];

  // (1) fail-close: 病名禁忌ドメインは体系的に照合していない旨を必ず宣言する。
  alerts.push(buildConditionContraindicationCoverageNotice(conditions));

  // (2) fail-safe best-effort: 添付文書の禁忌欄テキストに病名が含まれれば surface。
  const drugCodes = prescriptionLines
    .map((l) => l.drug_code)
    .filter((c): c is string => c !== null);

  if (drugCodes.length === 0) return alerts;

  const packageInserts = await prisma.drugPackageInsert.findMany({
    where: {
      drug_master: { yj_code: { in: drugCodes } },
      contraindications: { not: Prisma.JsonNull },
    },
    include: {
      drug_master: { select: { yj_code: true, drug_name: true } },
    },
  });

  if (packageInserts.length === 0) return alerts;

  const insertByCode = new Map(packageInserts.map((pi) => [pi.drug_master.yj_code, pi]));

  // 1文字病名（"癌" 等）の暴発を避けるため 2 文字以上のみ名称照合の対象にする。
  const matchableConditions = conditions.filter((condition) => condition.name.trim().length >= 2);

  const seen = new Set<string>();
  for (const line of prescriptionLines) {
    if (!line.drug_code) continue;
    const pi = insertByCode.get(line.drug_code);
    if (!pi?.contraindications) continue;

    const contraindications = readPackageInsertTextEntries(pi.contraindications);
    for (const entry of contraindications.entries) {
      for (const condition of matchableConditions) {
        const conditionName = condition.name.trim();
        if (!entry.text.includes(conditionName)) continue;

        const dedupeKey = `${line.drug_code}::${conditionName}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);

        alerts.push({
          type: 'condition_contraindication',
          severity: 'critical',
          message: `病名禁忌の可能性（要確認）: ${line.drug_name} — 患者の病名「${conditionName}」が添付文書の禁忌欄に該当します`,
          details: {
            source: 'condition_contraindication',
            drug_code: line.drug_code,
            prescribed_drug: line.drug_name,
            condition_name: conditionName,
            condition_type: condition.condition_type,
            matched_contraindication: entry.text.slice(0, 100),
            recommendation: '当該病名に対する禁忌／慎重投与の該当可否を添付文書で確認してください',
          },
        });
      }
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
 *  11. 病名／問題リスト（PatientCondition）禁忌クロスチェック（coverage notice + best-effort）
 */
export async function checkDispenseAlerts(
  orgId: string,
  cycleId: string,
  patientId: string,
): Promise<CdsAlert[]> {
  const managedAlertStates = await resolveManagedAlertTypeStates(orgId);

  // Fetch prescription lines for this cycle
  const prescriptionLines = await prisma.prescriptionLine.findMany({
    where: {
      intake: { cycle_id: cycleId },
      org_id: orgId,
    },
    select: {
      id: true,
      drug_name: true,
      drug_master_id: true,
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

  // F82: 有効な病名／問題リストを取得（病名禁忌クロスチェック用）。
  const patientConditions = (await prisma.patientCondition.findMany({
    where: { patient_id: patientId, org_id: orgId, is_active: true },
    select: { name: true, condition_type: true },
  })) as PatientConditionForCds[];

  // Resolve PrescriptionLine identity master-first for all checks.
  const {
    lines: cdsPrescriptionLines,
    drugMasterMap,
    dataQualityAlerts: prescriptionLineIdentityAlerts,
  } = await resolvePrescriptionLineDrugIdentitiesForCds(prescriptionLines);

  // F81 + X03: identity-unresolved の薬剤を検出し、コードベース CDS チェック未完了を
  // 明示する data-quality 警告を出す（無言スキップ＝allergy/interaction-clean へ倒さない）。
  // - 現行薬: DrugMaster に解決できないもの（checkInteractions が無言スキップする集合）。
  // - 処方行: master-first 解決後も drug_code が未解決のもの。
  const unresolvedCurrentMeds = currentMeds.filter((med) => !masterByMedId.has(med.id));
  const unresolvedPrescriptionLines = cdsPrescriptionLines.filter((line) => !line.drug_code);
  const identityUnresolvedAlerts =
    prescriptionLines.length > 0 &&
    (unresolvedCurrentMeds.length > 0 || unresolvedPrescriptionLines.length > 0)
      ? [buildCdsIdentityUnresolvedAlert({ unresolvedPrescriptionLines, unresolvedCurrentMeds })]
      : [];

  // Run all checks in parallel
  const results = await Promise.all([
    Promise.resolve(prescriptionLineIdentityAlerts),
    Promise.resolve(identityUnresolvedAlerts),
    managedAlertStates.get('interaction')
      ? checkInteractions(cdsPrescriptionLines, currentMeds, masterByMedId)
      : Promise.resolve([]),
    managedAlertStates.get('duplicate')
      ? checkDuplicates(cdsPrescriptionLines, currentMeds, masterByMedId)
      : Promise.resolve([]),
    managedAlertStates.get('max_days')
      ? checkMaxDays(cdsPrescriptionLines, drugMasterMap)
      : Promise.resolve([]),
    checkTransitionalExpiry(cdsPrescriptionLines, drugMasterMap),
    managedAlertStates.get('allergy_cross')
      ? checkAllergyReactions(orgId, cdsPrescriptionLines, patient, drugMasterMap)
      : Promise.resolve([]),
    managedAlertStates.get('narcotic')
      ? checkNarcoticFlags(cdsPrescriptionLines, drugMasterMap)
      : Promise.resolve([]),
    managedAlertStates.get('high_risk')
      ? checkHighRiskDrugs(orgId, cdsPrescriptionLines, drugMasterMap)
      : Promise.resolve([]),
    checkDoPrescriptionRisk(orgId, cycleId, patientId),
    managedAlertStates.get('pim_elderly')
      ? checkElderlyPIM(orgId, cdsPrescriptionLines, patient, drugMasterMap)
      : Promise.resolve([]),
    managedAlertStates.get('renal_dose')
      ? checkRenalDoseAdjustment(cdsPrescriptionLines, patientId, orgId)
      : Promise.resolve([]),
    // Package insert audit — always enabled (regulatory information)
    checkPackageInsertAudit(cdsPrescriptionLines, patient),
    // PT-INR / K monitoring — always enabled
    checkMonitoringAlerts(cdsPrescriptionLines, patientId, orgId, drugMasterMap),
    // 病名／問題リスト禁忌クロスチェック（F82）— always enabled（安全側 coverage）
    checkConditionContraindications(cdsPrescriptionLines, patientConditions),
  ]);

  return results.flat();
}
