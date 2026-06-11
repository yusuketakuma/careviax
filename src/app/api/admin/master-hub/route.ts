import { format, startOfMonth } from 'date-fns';
import { withAuthContext } from '@/lib/auth/context';
import { success } from '@/lib/api/response';
import { withOrgContext } from '@/lib/db/rls';
import { buildTodayOpsRail } from '@/server/services/today-ops-rail';
import type { MasterHubCard, MasterHubResponse } from '@/types/master-hub';

/**
 * 13_master(マスター鮮度ハブ)用 BFF。
 * 5 マスター(薬剤/医療者/施設/スタッフ・権限/車両)の件数・最終更新・鮮度ステータス・
 * 現場語ナラティブと、右レール(次にやること / 止まっている理由)・変更履歴件数を
 * 1 リクエストで返す読み取り専用集計(docs/design-gap-analysis-new.md 13_master)。
 */

/** 車両: 更新が止まったら鮮度警告(期限接近)にする閾値。 */
const VEHICLE_STALE_DAYS = 30;
/** 車両 notes の「点検期限 M/d」表記から期限接近(14日以内)を判定する。 */
const VEHICLE_INSPECTION_SOON_DAYS = 14;
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

export const GET = withAuthContext(
  async (_req, ctx) => {
    const now = new Date();
    const monthStart = startOfMonth(now);

    const data = await withOrgContext(ctx.orgId, async (tx) => {
      const [
        drugCount,
        drugLatest,
        externalProfessionalCount,
        institutionCount,
        pendingInstitutions,
        professionalLatest,
        institutionLatest,
        facilityCount,
        facilityLatest,
        staffCount,
        staffLatest,
        vehicles,
        changeLogMonthCount,
        rail,
      ] = await Promise.all([
        tx.drugMaster.count(),
        tx.drugMaster.findFirst({
          orderBy: { updated_at: 'desc' },
          select: { updated_at: true },
        }),
        tx.externalProfessional.count({ where: { org_id: ctx.orgId } }),
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
        tx.visitVehicleResource.findMany({
          where: { org_id: ctx.orgId },
          orderBy: { updated_at: 'desc' },
          select: { label: true, available: true, notes: true, updated_at: true },
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

      // ── 薬剤マスター ────────────────────────────────────────────────
      const drugsCard: MasterHubCard = {
        key: 'drugs',
        title: '薬剤マスター',
        count: drugCount,
        count_unit: '件',
        last_updated_at: drugLatest?.updated_at?.toISOString() ?? null,
        status: drugCount > 0 ? 'healthy' : 'checking',
        status_count: drugCount > 0 ? null : 1,
        note:
          drugCount > 0
            ? '安全タグ・代替薬・在庫連動の列を含む'
            : '薬剤マスターが未取込です — 取込まで安全チェックが動きません',
        action_label: '→ 在庫へ',
        action_href: '/admin/drug-stock',
      };

      // ── 医療者マスター ──────────────────────────────────────────────
      const pendingInstitutionCount = pendingInstitutions.length;
      const professionalsCard: MasterHubCard = {
        key: 'professionals',
        title: '医療者マスター',
        count: externalProfessionalCount + institutionCount,
        count_unit: '件',
        last_updated_at:
          maxDate(
            professionalLatest?.updated_at,
            institutionLatest?.updated_at,
          )?.toISOString() ?? null,
        status: pendingInstitutionCount > 0 ? 'checking' : 'healthy',
        status_count: pendingInstitutionCount > 0 ? pendingInstitutionCount : null,
        note:
          pendingInstitutionCount > 0
            ? `${pendingInstitutions[0].name}の送付先FAXを事務が確認中 — 完了まで同院宛の送付はブロックされます`
            : '処方医・医療機関・他職種の連絡先と送付先を管理します',
        action_label: '→ ハンドオフへ',
        action_href: '/handoff',
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
        action_label: '→ 訪問へ',
        action_href: '/visits',
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
        action_label: '→ スケジュールへ',
        action_href: '/schedules',
      };

      // ── 車両マスター ────────────────────────────────────────────────
      // 点検期限の専用カラムは未整備のため、運用は notes の「点検期限 M/d」表記を読む。
      const unavailableVehicles = vehicles.filter((vehicle) => !vehicle.available);
      const inspectionCandidates = vehicles
        .map((vehicle) => {
          const deadline = parseInspectionDeadline(vehicle.notes, now);
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
        action_label: '点検を予約',
        action_href: '/schedules',
      };
      if (
        nearestInspection &&
        daysUntil(nearestInspection.deadline, now) <= VEHICLE_INSPECTION_SOON_DAYS
      ) {
        const remaining = daysUntil(nearestInspection.deadline, now);
        vehiclesCard = {
          ...vehicleBase,
          status: 'due_soon',
          status_count: null,
          note: `${nearestInspection.label}の点検期限 ${format(nearestInspection.deadline, 'M/d')}(あと${remaining}日) — 期限切れで配車候補から自動除外されます`,
        };
      } else if (unavailableVehicles.length > 0) {
        vehiclesCard = {
          ...vehicleBase,
          status: 'checking',
          status_count: unavailableVehicles.length,
          note: `${unavailableVehicles[0].label}が稼働停止中 — 配車候補から自動除外されています`,
        };
      } else if (vehicleStaleDays != null && vehicleStaleDays >= VEHICLE_STALE_DAYS) {
        vehiclesCard = {
          ...vehicleBase,
          status: 'due_soon',
          status_count: null,
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

      return {
        generated_at: now.toISOString(),
        masters: [drugsCard, professionalsCard, facilitiesCard, staffCard, vehiclesCard],
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
