import { format } from 'date-fns';
import { unstable_rethrow } from 'next/navigation';
import { withAuthContext } from '@/lib/auth/context';
import { internalError, success } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { withOrgContext } from '@/lib/db/rls';
import { japanDateKey, japanMonthInstantRange } from '@/lib/utils/date-boundary';
import { buildTodayOpsRail } from '@/server/services/today-ops-rail';
import type { MasterHubCard, MasterHubResponse } from '@/types/master-hub';

/**
 * 13_master(マスター鮮度ハブ)用 BFF。
 * 11 マスター(医薬品/医療機関/他職種/施設/スタッフ/備品/社用車/薬局拠点/稼働日設定/配薬・帳票/請求)の件数・最終更新・鮮度ステータス・
 * 現場語ナラティブと、右レール(次にやること / 止まっている理由)・変更履歴件数を
 * 1 リクエストで返す読み取り専用集計(docs/design-gap-analysis-new.md 13_master)。
 */

/** 車両: 更新が止まったら鮮度警告(期限接近)にする閾値。 */
const VEHICLE_STALE_DAYS = 30;
/** 点検期限の接近(14日以内)を期限警告にする閾値。 */
const VEHICLE_INSPECTION_SOON_DAYS = 14;
/** 後方互換: 専用カラム未設定の車両のみ notes の「点検期限 M/d」表記から判定する。 */
const VEHICLE_INSPECTION_NOTE_PATTERN = /点検期限[:\s]*(\d{1,2})\/(\d{1,2})/;

/** 変更履歴(今月)として数えるマスター系 AuditLog target_type。 */
const MASTER_AUDIT_TARGET_TYPES = [
  'DrugMaster',
  'PharmacyDrugStock',
  'FormularyTemplate',
  'Facility',
  'FacilityUnit',
  'FacilityContact',
  'ExternalProfessional',
  'PrescriberInstitution',
  'ContactProfile',
  'VisitVehicleResource',
  'ServiceArea',
  'Membership',
  'User',
  'PharmacySite',
  'PharmacyOperatingHours',
  'BusinessHoliday',
  'PharmacistShift',
  'PharmacistCredential',
];

function maxDate(...values: Array<Date | null | undefined>): Date | null {
  let latest: Date | null = null;
  for (const value of values) {
    if (value && (!latest || value.getTime() > latest.getTime())) latest = value;
  }
  return latest;
}

/**
 * next_inspection_date(@db.Date)は UTC 深夜で返るため、表示・日数計算系
 * (format / daysUntil はローカル深夜で扱う)に合わせてローカル深夜の Date に正規化する。
 */
function localDateFromInspectionColumn(value: Date | null): Date | null {
  if (!value) return null;
  return new Date(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());
}

/** notes の「点検期限 M/d」を当年(過ぎていれば翌年)の日付として解釈する。 */
function parseInspectionDeadline(notes: string | null, now: Date): Date | null {
  if (!notes) return null;
  const match = VEHICLE_INSPECTION_NOTE_PATTERN.exec(notes);
  if (!match) return null;
  const month = Number(match[1]);
  const day = Number(match[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const candidate = new Date(now.getFullYear(), month - 1, day);
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  if (candidate.getTime() < todayStart.getTime()) {
    candidate.setFullYear(candidate.getFullYear() + 1);
  }
  return candidate;
}

function daysUntil(target: Date, now: Date): number {
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const targetStart = new Date(target);
  targetStart.setHours(0, 0, 0, 0);
  return Math.round((targetStart.getTime() - todayStart.getTime()) / 86_400_000);
}

const authenticatedGET = withAuthContext(
  async (_req, ctx) => {
    const now = new Date();
    // changeLogMonthCount は AuditLog.created_at(実時刻)を JST 民間月で数える。
    // startOfMonth(now)(ローカル月初)だと UTC prod で JST 月境界の変更が隣月へずれる。
    const monthStart = japanMonthInstantRange(japanDateKey(now).slice(0, 7)).gte;

    const data = await withOrgContext(ctx.orgId, async (tx) => {
      const [
        drugCount,
        drugLatest,
        externalProfessionalCount,
        pendingExternalProfessionals,
        missingExternalContactCount,
        institutionCount,
        pendingInstitutions,
        professionalLatest,
        institutionLatest,
        facilityCount,
        facilityLatest,
        staffCount,
        staffLatest,
        pcaPumpCount,
        unavailablePcaPumps,
        pcaPumpLatest,
        vehicles,
        pharmacySiteCount,
        pharmacySiteLatest,
        serviceAreaCount,
        packagingMethodCount,
        packagingMethodLatest,
        templateCount,
        templateLatest,
        billingRuleCount,
        billingRuleLatest,
        changeLogMonthCount,
        rail,
      ] = await Promise.all([
        tx.drugMaster.count(),
        tx.drugMaster.findFirst({
          orderBy: { updated_at: 'desc' },
          select: { updated_at: true },
        }),
        tx.externalProfessional.count({ where: { org_id: ctx.orgId } }),
        tx.externalProfessional.findMany({
          where: {
            org_id: ctx.orgId,
            OR: [{ phone: null }, { email: null, fax: null }],
          },
          orderBy: { updated_at: 'desc' },
          select: { name: true },
          take: 5,
        }),
        tx.externalProfessional.count({
          where: {
            org_id: ctx.orgId,
            OR: [{ phone: null }, { email: null, fax: null }],
          },
        }),
        tx.prescriberInstitution.count({ where: { org_id: ctx.orgId } }),
        tx.prescriberInstitution.findMany({
          where: { org_id: ctx.orgId, fax: null },
          orderBy: { updated_at: 'desc' },
          select: { name: true },
          take: 5,
        }),
        tx.externalProfessional.findFirst({
          where: { org_id: ctx.orgId },
          orderBy: { updated_at: 'desc' },
          select: { updated_at: true },
        }),
        tx.prescriberInstitution.findFirst({
          where: { org_id: ctx.orgId },
          orderBy: { updated_at: 'desc' },
          select: { updated_at: true },
        }),
        tx.facility.count({ where: { org_id: ctx.orgId } }),
        tx.facility.findFirst({
          where: { org_id: ctx.orgId },
          orderBy: { updated_at: 'desc' },
          select: { name: true, updated_at: true },
        }),
        tx.membership.count({ where: { org_id: ctx.orgId, is_active: true } }),
        tx.membership.findFirst({
          where: { org_id: ctx.orgId, is_active: true },
          orderBy: { updated_at: 'desc' },
          select: { updated_at: true },
        }),
        tx.pcaPump.count({ where: { org_id: ctx.orgId } }),
        tx.pcaPump.findMany({
          where: { org_id: ctx.orgId, status: { not: 'available' } },
          orderBy: { updated_at: 'desc' },
          select: { asset_code: true, status: true },
          take: 5,
        }),
        tx.pcaPump.findFirst({
          where: { org_id: ctx.orgId },
          orderBy: { updated_at: 'desc' },
          select: { updated_at: true },
        }),
        tx.visitVehicleResource.findMany({
          where: { org_id: ctx.orgId },
          orderBy: { updated_at: 'desc' },
          select: {
            label: true,
            available: true,
            notes: true,
            next_inspection_date: true,
            updated_at: true,
          },
        }),
        tx.pharmacySite.count({ where: { org_id: ctx.orgId } }),
        tx.pharmacySite.findFirst({
          where: { org_id: ctx.orgId },
          orderBy: { updated_at: 'desc' },
          select: { name: true, updated_at: true },
        }),
        tx.serviceArea.count({ where: { org_id: ctx.orgId } }),
        tx.packagingMethodMaster.count({ where: { org_id: ctx.orgId, is_active: true } }),
        tx.packagingMethodMaster.findFirst({
          where: { org_id: ctx.orgId },
          orderBy: { updated_at: 'desc' },
          select: { updated_at: true },
        }),
        tx.template.count({ where: { org_id: ctx.orgId } }),
        tx.template.findFirst({
          where: { org_id: ctx.orgId },
          orderBy: { updated_at: 'desc' },
          select: { updated_at: true },
        }),
        tx.billingRule.count({ where: { org_id: ctx.orgId, is_active: true } }),
        tx.billingRule.findFirst({
          where: { org_id: ctx.orgId },
          orderBy: { updated_at: 'desc' },
          select: { updated_at: true },
        }),
        tx.auditLog.count({
          where: {
            org_id: ctx.orgId,
            created_at: { gte: monthStart },
            target_type: { in: MASTER_AUDIT_TARGET_TYPES },
          },
        }),
        buildTodayOpsRail(tx, ctx.orgId, now),
      ]);

      // ── 医薬品マスター ──────────────────────────────────────────────
      const drugsCard: MasterHubCard = {
        key: 'drugs',
        title: '医薬品マスター',
        count: drugCount,
        count_unit: '件',
        last_updated_at: drugLatest?.updated_at?.toISOString() ?? null,
        status: drugCount > 0 ? 'healthy' : 'checking',
        status_count: drugCount > 0 ? null : 1,
        note:
          drugCount > 0
            ? '安全タグ・代替薬・在庫連動の列を含む'
            : '薬剤マスターが未取込です — 取込まで安全チェックが動きません',
        issue_count: drugCount > 0 ? 0 : 1,
        next_action_hint: drugCount > 0 ? '採用品と安全タグを確認する' : '医薬品マスターを取込む',
        action_label: '→ 医薬品へ',
        action_href: '/admin/drug-masters',
      };

      // ── 医療機関マスター ────────────────────────────────────────────
      const pendingInstitutionCount = pendingInstitutions.length;
      const institutionsCard: MasterHubCard = {
        key: 'institutions',
        title: '医療機関マスター',
        count: institutionCount,
        count_unit: '件',
        last_updated_at: institutionLatest?.updated_at?.toISOString() ?? null,
        status: pendingInstitutionCount > 0 ? 'checking' : 'healthy',
        status_count: pendingInstitutionCount > 0 ? pendingInstitutionCount : null,
        note:
          pendingInstitutionCount > 0
            ? `${pendingInstitutions[0].name}の送付先FAXを事務が確認中 — 完了まで同院宛の送付はブロックされます`
            : '処方元・報告先の医療機関コード、送付先、連絡方法を管理します',
        issue_count: pendingInstitutionCount,
        next_action_hint:
          pendingInstitutionCount > 0
            ? `${pendingInstitutions[0].name}の送付先FAXを確認する`
            : '処方元コードと送付先を点検する',
        action_label: '→ 医療機関へ',
        action_href: '/admin/institutions',
      };

      // ── 他職種マスター ──────────────────────────────────────────────
      const professionalsCard: MasterHubCard = {
        key: 'professionals',
        title: '他職種マスター',
        count: externalProfessionalCount,
        count_unit: '件',
        last_updated_at: professionalLatest?.updated_at?.toISOString() ?? null,
        status: missingExternalContactCount > 0 ? 'checking' : 'healthy',
        status_count: missingExternalContactCount > 0 ? missingExternalContactCount : null,
        note:
          missingExternalContactCount > 0 && pendingExternalProfessionals[0]
            ? `${pendingExternalProfessionals[0].name}の連絡先が不足しています — 報告・相談の送付候補から外れる可能性があります`
            : 'ケアマネ、訪問看護、施設職員など患者支援に関わる連携先を管理します',
        issue_count: missingExternalContactCount,
        next_action_hint:
          missingExternalContactCount > 0
            ? `${pendingExternalProfessionals[0]?.name ?? '他職種'}の連絡先を確認する`
            : '職種・所属・送付チャネルを点検する',
        action_label: '→ 他職種へ',
        action_href: '/admin/external-professionals',
      };

      // ── 施設マスター ────────────────────────────────────────────────
      const facilitiesCard: MasterHubCard = {
        key: 'facilities',
        title: '施設マスター',
        count: facilityCount,
        count_unit: '件',
        last_updated_at: facilityLatest?.updated_at?.toISOString() ?? null,
        status: 'healthy',
        status_count: null,
        note: facilityLatest
          ? `${facilityLatest.name}の鍵・駐車情報は${format(facilityLatest.updated_at, 'M/d')}更新 — 訪問パケットに反映済み`
          : '施設の鍵・駐車・受入時間を訪問パケットに反映します',
        issue_count: 0,
        next_action_hint: facilityLatest
          ? '最新施設の訪問条件を確認する'
          : '施設・訪問先を登録する',
        action_label: '→ 施設へ',
        action_href: '/admin/facilities',
      };

      // ── スタッフ・権限 ──────────────────────────────────────────────
      const staffCard: MasterHubCard = {
        key: 'staff',
        title: 'スタッフ・権限',
        count: staffCount,
        count_unit: '名',
        last_updated_at: staffLatest?.updated_at?.toISOString() ?? null,
        status: 'healthy',
        status_count: null,
        note: '本日の休みはスケジュールに反映済み。権限はロール×モードのマトリクス管理',
        issue_count: 0,
        next_action_hint: '本日のシフトと権限を確認する',
        action_label: '→ スタッフへ',
        action_href: '/admin/staff',
      };

      // ── 備品マスター ────────────────────────────────────────────────
      const equipmentCard: MasterHubCard = {
        key: 'equipment',
        title: '備品マスター',
        count: pcaPumpCount,
        count_unit: '台',
        last_updated_at: pcaPumpLatest?.updated_at?.toISOString() ?? null,
        status: unavailablePcaPumps.length > 0 ? 'checking' : 'healthy',
        status_count: unavailablePcaPumps.length > 0 ? unavailablePcaPumps.length : null,
        note:
          unavailablePcaPumps.length > 0
            ? `${unavailablePcaPumps[0].asset_code}が${unavailablePcaPumps[0].status}です — 貸出候補と返却検品を確認してください`
            : 'PCAポンプなど貸出機器の資産番号、状態、保守期限を管理します',
        issue_count: unavailablePcaPumps.length,
        next_action_hint:
          unavailablePcaPumps.length > 0
            ? `${unavailablePcaPumps[0].asset_code}の状態を確認する`
            : '貸出機器と保守期限を点検する',
        action_label: '→ 備品へ',
        action_href: '/admin/pca-pumps',
      };

      // ── 車両マスター ────────────────────────────────────────────────
      // 点検期限は専用カラム next_inspection_date を優先し、未設定の車両のみ
      // 後方互換として notes の「点検期限 M/d」表記にフォールバックする。
      const unavailableVehicles = vehicles.filter((vehicle) => !vehicle.available);
      const inspectionCandidates = vehicles
        .map((vehicle) => {
          const deadline =
            localDateFromInspectionColumn(vehicle.next_inspection_date) ??
            parseInspectionDeadline(vehicle.notes, now);
          return deadline ? { label: vehicle.label, deadline } : null;
        })
        .filter((value): value is { label: string; deadline: Date } => value != null)
        .sort((left, right) => left.deadline.getTime() - right.deadline.getTime());
      const nearestInspection = inspectionCandidates[0] ?? null;
      const vehicleLatest = maxDate(...vehicles.map((vehicle) => vehicle.updated_at));
      const vehicleStaleDays = vehicleLatest
        ? Math.floor((now.getTime() - vehicleLatest.getTime()) / 86_400_000)
        : null;

      let vehiclesCard: MasterHubCard;
      const vehicleBase = {
        key: 'vehicles' as const,
        title: '車両マスター',
        count: vehicles.length,
        count_unit: '台',
        last_updated_at: vehicleLatest?.toISOString() ?? null,
        issue_count: 0,
        next_action_hint: '点検期限と稼働可否を確認する',
        action_label: '点検を予約',
        action_href: '/admin/vehicles',
      };
      const inspectionDaysRemaining = nearestInspection
        ? daysUntil(nearestInspection.deadline, now)
        : null;
      if (nearestInspection && inspectionDaysRemaining != null && inspectionDaysRemaining < 0) {
        const overdueDays = Math.abs(inspectionDaysRemaining);
        vehiclesCard = {
          ...vehicleBase,
          status: 'expired',
          status_count: null,
          issue_count: 1,
          next_action_hint: `${nearestInspection.label}を配車候補から外して点検を予約する`,
          note: `${nearestInspection.label}の点検期限 ${format(nearestInspection.deadline, 'M/d')} が${overdueDays}日過ぎています — 配車候補から除外して点検を予約してください`,
        };
      } else if (
        nearestInspection &&
        inspectionDaysRemaining != null &&
        inspectionDaysRemaining <= VEHICLE_INSPECTION_SOON_DAYS
      ) {
        vehiclesCard = {
          ...vehicleBase,
          status: 'due_soon',
          status_count: null,
          issue_count: 1,
          next_action_hint: `${nearestInspection.label}の点検を予約する`,
          note: `${nearestInspection.label}の点検期限 ${format(nearestInspection.deadline, 'M/d')}(あと${inspectionDaysRemaining}日) — 期限切れで配車候補から自動除外されます`,
        };
      } else if (unavailableVehicles.length > 0) {
        vehiclesCard = {
          ...vehicleBase,
          status: 'checking',
          status_count: unavailableVehicles.length,
          issue_count: unavailableVehicles.length,
          next_action_hint: `${unavailableVehicles[0].label}の稼働可否を確認する`,
          note: `${unavailableVehicles[0].label}が稼働停止中 — 配車候補から自動除外されています`,
        };
      } else if (vehicleStaleDays != null && vehicleStaleDays >= VEHICLE_STALE_DAYS) {
        vehiclesCard = {
          ...vehicleBase,
          status: 'due_soon',
          status_count: null,
          issue_count: 1,
          next_action_hint: '点検・整備記録を更新する',
          note: `点検・整備の記録が${vehicleStaleDays}日間更新されていません — 期限切れで配車候補から自動除外されます`,
        };
      } else {
        vehiclesCard = {
          ...vehicleBase,
          status: 'healthy',
          status_count: null,
          note: '点検期限切れの車両は配車候補から自動除外されます',
        };
      }

      // ── 薬局拠点マスター ────────────────────────────────────────────
      const pharmacySitesCard: MasterHubCard = {
        key: 'pharmacy_sites',
        title: '薬局拠点マスター',
        count: pharmacySiteCount,
        count_unit: '拠点',
        last_updated_at: pharmacySiteLatest?.updated_at?.toISOString() ?? null,
        status: pharmacySiteCount > 0 && serviceAreaCount > 0 ? 'healthy' : 'checking',
        status_count: pharmacySiteCount === 0 ? 1 : serviceAreaCount === 0 ? 1 : null,
        note:
          pharmacySiteCount === 0
            ? '薬局拠点が未登録です — 担当者・在庫・訪問エリアの基準が作れません'
            : serviceAreaCount === 0
              ? `${pharmacySiteLatest?.name ?? '薬局拠点'}の訪問エリアが未登録です — 訪問候補生成に影響します`
              : `${pharmacySiteLatest?.name ?? '薬局拠点'}と訪問エリア ${serviceAreaCount}件を管理しています`,
        issue_count: pharmacySiteCount === 0 || serviceAreaCount === 0 ? 1 : 0,
        next_action_hint:
          pharmacySiteCount === 0
            ? '薬局拠点を登録する'
            : serviceAreaCount === 0
              ? '訪問エリアを登録する'
              : '拠点情報と訪問範囲を点検する',
        action_label: '→ 薬局拠点へ',
        action_href: '/admin/pharmacy-sites',
      };

      // ── 稼働日設定 ────────────────────────────────────────────────
      const operatingHoursCard: MasterHubCard = {
        key: 'operating_hours',
        title: '稼働日設定',
        count: pharmacySiteCount,
        count_unit: '拠点',
        last_updated_at: pharmacySiteLatest?.updated_at?.toISOString() ?? null,
        status: pharmacySiteCount > 0 ? 'healthy' : 'checking',
        status_count: pharmacySiteCount > 0 ? null : 1,
        note:
          pharmacySiteCount > 0
            ? '週次営業時間・定休・休日カレンダーを訪問可能日の判定に反映します'
            : '薬局拠点が未登録です — 稼働日設定を開始できません',
        issue_count: pharmacySiteCount > 0 ? 0 : 1,
        next_action_hint:
          pharmacySiteCount > 0 ? '拠点ごとの営業時間と稼働日を確認する' : '薬局拠点を登録する',
        action_label: '→ 稼働日設定へ',
        action_href: '/admin/operating-hours',
      };

      // ── 配薬・帳票マスター ──────────────────────────────────────────
      const dispensingCount = packagingMethodCount + templateCount;
      const dispensingCard: MasterHubCard = {
        key: 'dispensing',
        title: '配薬・帳票マスター',
        count: dispensingCount,
        count_unit: '件',
        last_updated_at:
          maxDate(packagingMethodLatest?.updated_at, templateLatest?.updated_at)?.toISOString() ??
          null,
        status: packagingMethodCount > 0 && templateCount > 0 ? 'healthy' : 'checking',
        status_count:
          [packagingMethodCount === 0, templateCount === 0].filter(Boolean).length || null,
        note:
          packagingMethodCount === 0
            ? '配薬方法が未登録です — セット作成時の包材・配薬単位が選べません'
            : templateCount === 0
              ? '帳票テンプレートが未登録です — 報告書・同意書の作成に影響します'
              : `配薬方法 ${packagingMethodCount}件 / 帳票テンプレート ${templateCount}件を管理しています`,
        issue_count: [packagingMethodCount === 0, templateCount === 0].filter(Boolean).length,
        next_action_hint:
          packagingMethodCount === 0
            ? '配薬方法を登録する'
            : templateCount === 0
              ? '帳票テンプレートを登録する'
              : '配薬方法と帳票テンプレートを点検する',
        action_label: packagingMethodCount === 0 ? '→ 配薬方法へ' : '→ 帳票へ',
        action_href:
          packagingMethodCount === 0 ? '/admin/packaging-methods' : '/admin/document-templates',
      };

      // ── 請求ルールマスター ──────────────────────────────────────────
      const billingCard: MasterHubCard = {
        key: 'billing',
        title: '請求ルールマスター',
        count: billingRuleCount,
        count_unit: '件',
        last_updated_at: billingRuleLatest?.updated_at?.toISOString() ?? null,
        status: billingRuleCount > 0 ? 'healthy' : 'checking',
        status_count: billingRuleCount > 0 ? null : 1,
        note:
          billingRuleCount > 0
            ? '在宅算定、加算、減算、保険別の根拠ルールを管理します'
            : '請求ルールが未登録です — 算定候補と証跡判定に影響します',
        issue_count: billingRuleCount > 0 ? 0 : 1,
        next_action_hint:
          billingRuleCount > 0 ? '改定年度と有効ルールを点検する' : '請求ルールを登録する',
        action_label: '→ 請求ルールへ',
        action_href: '/admin/billing-rules',
      };

      return {
        generated_at: now.toISOString(),
        masters: [
          drugsCard,
          institutionsCard,
          professionalsCard,
          facilitiesCard,
          staffCard,
          equipmentCard,
          vehiclesCard,
          pharmacySitesCard,
          operatingHoursCard,
          dispensingCard,
          billingCard,
        ],
        change_log_month_count: changeLogMonthCount,
        rail,
      } satisfies MasterHubResponse;
    });

    return success({ data });
  },
  {
    permission: 'canAdmin',
    message: 'マスター整備状況の閲覧権限がありません',
  },
);

export async function GET(
  req: Parameters<typeof authenticatedGET>[0],
  routeContext: Parameters<typeof authenticatedGET>[1],
) {
  try {
    return withSensitiveNoStore(await authenticatedGET(req, routeContext));
  } catch (err) {
    unstable_rethrow(err);
    return withSensitiveNoStore(internalError());
  }
}
