import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { getHomeVisitIntake } from '@/lib/patient/home-visit-intake';
import {
  buildPatientDetailWhere,
  type PatientDetailScopeArgs,
} from '@/server/services/patient-detail-scope';
import { buildPatientOverviewBaseSelect } from '@/server/services/patient-overview-base-query';

type DbClient = typeof prisma | Prisma.TransactionClient;
type DetailArgs = PatientDetailScopeArgs;

/**
 * 患者詳細の生の現在値(基本情報/住所/scheduling_preference/連絡先/病名/多職種/ケース intake)を
 * 1 クエリで読み出す。privacy マスクや集計は行わない素のリーダで、getPatientOverview と
 * buildPatientStateSnapshot の共通読み出し基盤。
 *
 * 注: visit-brief.ts が buildPatientStateSnapshot を使うため、patient-detail.ts との循環参照を避ける
 * 目的で本リーダ＋スナップショット組立を独立モジュールへ切り出している。
 */
export async function findPatientOverviewBase(db: DbClient, args: DetailArgs) {
  return db.patient.findFirst({
    where: buildPatientDetailWhere(args),
    select: buildPatientOverviewBaseSelect(args),
  });
}

/**
 * 訪問記録作成時点の患者詳細スナップショット。findPatientOverviewBase の生の現在値読み出しを
 * 再利用し(二重実装回避)、訪問時の患者状態(基本情報/住所/介護度/連絡先/多職種/医療処置・麻薬/保険)を
 * JSON 安全な凍結オブジェクトとして返す。過去訪問の不変参照かつ前回訪問差分(訪問前確認ビュー)の基準点。
 */
export async function buildPatientStateSnapshot(
  db: DbClient,
  args: DetailArgs & { caseId: string; source?: string; capturedAt?: Date },
): Promise<Prisma.InputJsonValue | null> {
  const base = await findPatientOverviewBase(db, args);
  if (!base) return null;

  const insurances = await db.patientInsurance.findMany({
    where: { org_id: args.orgId, patient_id: args.patientId, is_active: true },
    select: {
      insurance_type: true,
      application_status: true,
      insurer_number: true,
      public_program_code: true,
      copay_ratio: true,
      valid_from: true,
      valid_until: true,
      confirmed_care_level: true,
    },
    orderBy: [{ insurance_type: 'asc' }, { valid_from: 'desc' }],
  });

  const cases = base.cases ?? [];
  const visitedCase = cases.find((item) => item.id === args.caseId) ?? cases[0] ?? null;
  const residences = base.residences ?? [];
  const primaryResidence = residences.find((item) => item.is_primary) ?? residences[0] ?? null;

  const snapshot = {
    captured_at: (args.capturedAt ?? new Date()).toISOString(),
    source: args.source ?? 'visit_record',
    case_id: visitedCase?.id ?? null,
    patient: {
      id: base.id,
      name: base.name,
      birth_date: base.birth_date,
      gender: base.gender,
      billing_support_flag: base.billing_support_flag,
    },
    primary_residence: primaryResidence
      ? {
          id: primaryResidence.id,
          facility_id: primaryResidence.facility_id ?? null,
          facility_unit_id: primaryResidence.facility_unit_id ?? null,
          has_address: Boolean(primaryResidence.address),
          has_unit_name: Boolean(primaryResidence.unit_name),
        }
      : null,
    scheduling_preference: base.scheduling_preference ?? null,
    conditions: (base.conditions ?? []).map((condition) => ({
      condition_type: condition.condition_type,
      name: condition.name,
      is_primary: condition.is_primary,
      is_active: condition.is_active,
    })),
    contacts: (base.contacts ?? []).map((contact) => ({
      relation: contact.relation,
      is_primary: contact.is_primary,
      is_emergency_contact: contact.is_emergency_contact,
    })),
    care_team_links: (visitedCase?.care_team_links ?? []).map((link) => ({
      role: link.role,
      name: link.name,
      is_primary: link.is_primary,
    })),
    home_visit_intake: visitedCase
      ? (getHomeVisitIntake(visitedCase.required_visit_support) ?? null)
      : null,
    insurances: insurances.map((insurance) => ({
      insurance_type: insurance.insurance_type,
      application_status: insurance.application_status,
      copay_ratio: insurance.copay_ratio,
      valid_from: insurance.valid_from,
      valid_until: insurance.valid_until,
      confirmed_care_level: insurance.confirmed_care_level,
    })),
  };

  // Date/Decimal を ISO 文字列等の JSON 安全値へ正規化してから凍結する(page.tsx と同じ手法)
  return JSON.parse(JSON.stringify(snapshot)) as Prisma.InputJsonValue;
}
