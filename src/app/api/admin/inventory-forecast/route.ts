import { unstable_rethrow } from 'next/navigation';
import { withAuthContext } from '@/lib/auth/context';
import { internalError, success } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import { prisma } from '@/lib/db/client';
import {
  buildInventoryForecast,
  countFacilityPatients,
  nextWeekUtcRange,
  type ForecastIntakeInput,
  type ForecastVisitInput,
} from '@/lib/analytics/inventory-forecast';

/**
 * p1_07「在庫と定期処方の予測」: 来週(翌週月曜〜日曜)の訪問予定患者と
 * 直近処方の 1 日量から薬剤別の必要量見込みを作り、薬局在庫と突合して
 * 「来週必要になりそうな薬」と「影響する患者さん」を返す BFF。
 */

const authenticatedGET = withAuthContext(
  async (_req, ctx) => {
    const week = nextWeekUtcRange(new Date());

    // 来週の訪問予定(キャンセル以外)と、在庫登録済み薬剤
    const [visitRows, stockRows] = await Promise.all([
      prisma.visitSchedule.findMany({
        where: {
          org_id: ctx.orgId,
          scheduled_date: { gte: week.gte, lt: week.lt },
          schedule_status: { not: 'cancelled' },
        },
        select: {
          case_id: true,
          scheduled_date: true,
          case_: {
            select: {
              patient: { select: { id: true, name: true } },
            },
          },
          facility_batch: {
            select: {
              id: true,
              facility_id: true,
              patient_ids: true,
            },
          },
        },
      }),
      prisma.pharmacyDrugStock.findMany({
        where: { org_id: ctx.orgId, is_stocked: true },
        select: {
          stock_qty: true,
          drug_master: {
            select: { drug_name: true, drug_name_kana: true, unit: true },
          },
        },
      }),
    ]);

    // 施設一括訪問の施設名(FacilityVisitBatch は facility_id スカラーのみ持つ)
    const facilityIds = [
      ...new Set(
        visitRows
          .map((row) => row.facility_batch?.facility_id)
          .filter((id): id is string => typeof id === 'string'),
      ),
    ];
    const facilityNameById = new Map(
      facilityIds.length > 0
        ? (
            await prisma.facility.findMany({
              where: { id: { in: facilityIds }, org_id: ctx.orgId },
              select: { id: true, name: true },
            })
          ).map((facility) => [facility.id, facility.name])
        : [],
    );

    // 来週訪問患者の処方取込(最新 1 件の選定は純関数側で行う)
    const caseIds = [...new Set(visitRows.map((row) => row.case_id))];
    const intakeRows =
      caseIds.length > 0
        ? await prisma.prescriptionIntake.findMany({
            where: {
              org_id: ctx.orgId,
              cycle: { case_id: { in: caseIds } },
            },
            select: {
              prescribed_date: true,
              created_at: true,
              cycle: { select: { patient_id: true } },
              lines: {
                select: {
                  drug_name: true,
                  dose: true,
                  frequency: true,
                  days: true,
                  quantity: true,
                  unit: true,
                  start_date: true,
                  end_date: true,
                },
              },
            },
          })
        : [];

    const visits: ForecastVisitInput[] = visitRows.map((row) => ({
      patientId: row.case_.patient.id,
      patientName: row.case_.patient.name,
      scheduledDate: row.scheduled_date,
      facilityBatch: row.facility_batch
        ? {
            id: row.facility_batch.id,
            facilityName: facilityNameById.get(row.facility_batch.facility_id) ?? '施設',
            patientCount: countFacilityPatients(row.facility_batch.patient_ids),
          }
        : null,
    }));

    const intakes: ForecastIntakeInput[] = intakeRows.map((row) => ({
      patientId: row.cycle.patient_id,
      prescribedDate: row.prescribed_date,
      createdAt: row.created_at,
      lines: row.lines.map((line) => ({
        drugName: line.drug_name,
        dose: line.dose,
        frequency: line.frequency,
        days: line.days,
        quantity: line.quantity,
        unit: line.unit,
        startDate: line.start_date,
        endDate: line.end_date,
      })),
    }));

    const summary = buildInventoryForecast({
      visits,
      intakes,
      stocks: stockRows.map((row) => ({
        drugName: row.drug_master.drug_name,
        drugNameKana: row.drug_master.drug_name_kana,
        unit: row.drug_master.unit,
        stockQty: row.stock_qty,
      })),
    });

    return success({
      data: {
        week: { start_date: week.startKey, end_date: week.endKey },
        drugs: summary.drugs,
        patients: summary.patients,
      },
    });
  },
  {
    permission: 'canAdmin',
    message: '在庫予測の閲覧権限がありません',
  },
);

export const GET: typeof authenticatedGET = async (req, routeContext) => {
  try {
    return withSensitiveNoStore(await authenticatedGET(req, routeContext));
  } catch (err) {
    unstable_rethrow(err);
    return withSensitiveNoStore(internalError());
  }
};
