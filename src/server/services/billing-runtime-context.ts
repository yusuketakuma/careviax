import type { Prisma } from '@prisma/client';
import { readJsonObject } from '@/lib/db/json';
import {
  CARE_REVISIONS,
  MEDICAL_REVISIONS,
  resolveRevisionEntryForDate,
} from './billing-rules/revisions';
import { normalizeHomeComprehensiveLevel2026 } from './billing-rules/revisions/medical/site-config-2026';

type TxLike = {
  pharmacySiteInsuranceConfig: {
    findFirst: (args: Prisma.PharmacySiteInsuranceConfigFindFirstArgs) => Promise<{
      id: string;
      revision_code: string;
      effective_from: Date;
      effective_to: Date | null;
      config: Prisma.JsonValue | null;
    } | null>;
  };
};

export type BillingRuntimeSiteConfigStatus =
  | 'not_required'
  | 'site_unassigned'
  | 'config_missing'
  | 'revision_mismatch'
  | 'resolved';

export type BillingCadencePolicy = {
  monthlyCapDefault: number;
  monthlyCapSpecial: number;
  specialWeeklyCap: number;
  weeklyPharmacistCapDefault: number;
};

export type BillingRuntimeHomeComprehensive = {
  level: string | null;
  ssotKey: string | null;
  code: string | null;
  name: string | null;
  points: number | null;
  buildingTier: 'single' | 'other' | null;
};

export type BillingRuntimeContext = {
  payerBasis: 'medical' | 'care';
  effectiveRevisionCode: string;
  effectiveRevisionLabel: string;
  siteId: string | null;
  siteConfigStatus: BillingRuntimeSiteConfigStatus;
  siteConfigId: string | null;
  siteConfigRevisionCode: string | null;
  siteConfig: Record<string, unknown>;
  buildingTier: 'single' | 'multi_2_9' | 'multi_10_plus';
  homeComprehensive: BillingRuntimeHomeComprehensive | null;
  warnings: string[];
  cadencePolicy: BillingCadencePolicy;
};

const BILLING_CADENCE_POLICY: BillingCadencePolicy = {
  monthlyCapDefault: 4,
  monthlyCapSpecial: 8,
  specialWeeklyCap: 2,
  weeklyPharmacistCapDefault: 40,
};

export function getBillingCadencePolicy(): BillingCadencePolicy {
  return BILLING_CADENCE_POLICY;
}

export function resolveBuildingTier(buildingPatientCount: number) {
  if (buildingPatientCount >= 10) return 'multi_10_plus' as const;
  if (buildingPatientCount >= 2) return 'multi_2_9' as const;
  return 'single' as const;
}

function resolveHomeComprehensive(args: {
  payerBasis: 'medical' | 'care';
  effectiveRevisionCode: string;
  siteConfigStatus: BillingRuntimeSiteConfigStatus;
  siteConfig: Record<string, unknown>;
  buildingPatientCount: number;
}): BillingRuntimeHomeComprehensive | null {
  if (args.payerBasis !== 'medical') return null;
  if (args.siteConfigStatus !== 'resolved') return null;

  const homeLevel = args.siteConfig.home_comprehensive_level;
  if (args.effectiveRevisionCode === '2026') {
    const normalizedLevel = normalizeHomeComprehensiveLevel2026(homeLevel);
    if (!normalizedLevel) return null;

    if (normalizedLevel === 'level_1') {
      return {
        level: normalizedLevel,
        ssotKey: 'site.medical.home_comprehensive_1',
        code: 'MED_ADD_HOME_COMPREHENSIVE_1',
        name: '在宅薬学総合体制加算1',
        points: 30,
        buildingTier: args.buildingPatientCount <= 1 ? 'single' : 'other',
      };
    }

    if (args.buildingPatientCount <= 1) {
      return {
        level: normalizedLevel,
        ssotKey: 'site.medical.home_comprehensive_2_i',
        code: 'MED_ADD_HOME_COMPREHENSIVE_2_I',
        name: '在宅薬学総合体制加算2 イ（単一建物1人）',
        points: 100,
        buildingTier: 'single',
      };
    }
    return {
      level: normalizedLevel,
      ssotKey: 'site.medical.home_comprehensive_2_ro',
      code: 'MED_ADD_HOME_COMPREHENSIVE_2_RO',
      name: '在宅薬学総合体制加算2 ロ（その他）',
      points: 50,
      buildingTier: 'other',
    };
  }

  if (homeLevel === 'level_2') {
    return {
      level: 'level_2',
      ssotKey: 'site.medical.home_comprehensive_2',
      code: 'MED_ADD_HOME_COMPREHENSIVE_2',
      name: '在宅薬学総合体制加算2',
      points: 50,
      buildingTier: args.buildingPatientCount <= 1 ? 'single' : 'other',
    };
  }

  if (homeLevel === 'level_1') {
    return {
      level: 'level_1',
      ssotKey: 'site.medical.home_comprehensive_1',
      code: 'MED_ADD_HOME_COMPREHENSIVE_1',
      name: '在宅薬学総合体制加算1',
      points: 15,
      buildingTier: args.buildingPatientCount <= 1 ? 'single' : 'other',
    };
  }

  return null;
}

export async function resolveBillingRuntimeContext(
  tx: TxLike,
  args: {
    orgId: string;
    payerBasis: 'medical' | 'care';
    asOfDate: Date;
    siteId?: string | null;
    buildingPatientCount: number;
  },
): Promise<BillingRuntimeContext> {
  const revisionEntry = resolveRevisionEntryForDate(
    args.payerBasis === 'care' ? CARE_REVISIONS : MEDICAL_REVISIONS,
    args.asOfDate,
  );
  const effectiveRevisionCode =
    revisionEntry?.revision.code ?? (args.payerBasis === 'care' ? '2024' : '2024');
  const effectiveRevisionLabel =
    revisionEntry?.revision.label ??
    (args.payerBasis === 'care' ? '令和6年度 介護報酬改定' : '令和6年度 診療報酬改定');
  const warnings: string[] = [];
  const buildingTier = resolveBuildingTier(args.buildingPatientCount);

  if (!args.siteId) {
    warnings.push('薬局が未割当のため、薬局設定ベースの判定を省略しています。');
    return {
      payerBasis: args.payerBasis,
      effectiveRevisionCode,
      effectiveRevisionLabel,
      siteId: null,
      siteConfigStatus: 'site_unassigned',
      siteConfigId: null,
      siteConfigRevisionCode: null,
      siteConfig: {},
      buildingTier,
      homeComprehensive: null,
      warnings,
      cadencePolicy: BILLING_CADENCE_POLICY,
    };
  }
  const siteConfigRow = await tx.pharmacySiteInsuranceConfig.findFirst({
    where: {
      org_id: args.orgId,
      site_id: args.siteId,
      insurance_type: args.payerBasis === 'care' ? 'care' : 'medical',
      effective_from: { lte: args.asOfDate },
      OR: [{ effective_to: null }, { effective_to: { gte: args.asOfDate } }],
    },
    orderBy: { effective_from: 'desc' },
  });

  if (!siteConfigRow) {
    warnings.push(
      `${effectiveRevisionLabel} に適用される薬局保険設定が見つかりません。薬局設定ベースの加算は未評価です。`,
    );
    return {
      payerBasis: args.payerBasis,
      effectiveRevisionCode,
      effectiveRevisionLabel,
      siteId: args.siteId,
      siteConfigStatus: 'config_missing',
      siteConfigId: null,
      siteConfigRevisionCode: null,
      siteConfig: {},
      buildingTier,
      homeComprehensive: null,
      warnings,
      cadencePolicy: BILLING_CADENCE_POLICY,
    };
  }
  const siteConfig = readJsonObject(siteConfigRow.config) ?? {};
  const siteConfigStatus =
    siteConfigRow.revision_code === effectiveRevisionCode ? 'resolved' : 'revision_mismatch';
  if (siteConfigStatus === 'revision_mismatch') {
    warnings.push(
      `薬局設定は ${siteConfigRow.revision_code} のままで、適用改定 ${effectiveRevisionCode} と一致していません。`,
    );
  }
  return {
    payerBasis: args.payerBasis,
    effectiveRevisionCode,
    effectiveRevisionLabel,
    siteId: args.siteId,
    siteConfigStatus,
    siteConfigId: siteConfigRow.id,
    siteConfigRevisionCode: siteConfigRow.revision_code,
    siteConfig,
    buildingTier,
    homeComprehensive: resolveHomeComprehensive({
      payerBasis: args.payerBasis,
      effectiveRevisionCode,
      siteConfigStatus,
      siteConfig,
      buildingPatientCount: args.buildingPatientCount,
    }),
    warnings,
    cadencePolicy: BILLING_CADENCE_POLICY,
  };
}
