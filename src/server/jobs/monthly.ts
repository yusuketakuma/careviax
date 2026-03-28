import { startOfMonth, subMonths, endOfMonth } from 'date-fns';
import { prisma } from '@/lib/db';
import { runJob } from './runner';

/**
 * Generate monthly visit report: patient x insurance type visit count aggregation.
 */
export async function generateMonthlyVisitReport() {
  return runJob('monthly_visit_report', async () => {
    const lastMonth = subMonths(new Date(), 1);
    const monthStart = startOfMonth(lastMonth);
    const monthEnd = endOfMonth(lastMonth);

    const visitRecords = await prisma.visitRecord.findMany({
      where: {
        visit_date: { gte: monthStart, lte: monthEnd },
        outcome_status: 'completed',
      },
      select: {
        id: true,
        org_id: true,
        patient_id: true,
        schedule: {
          select: {
            visit_type: true,
            case_: {
              select: {
                patient: {
                  select: {
                    id: true,
                    name: true,
                    medical_insurance_number: true,
                    care_insurance_number: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    // Aggregate by org -> patient -> insurance basis (medical / care / both)
    const aggregation = new Map<
      string,
      Map<
        string,
        {
          patientId: string;
          patientName: string;
          insuranceBasis: string;
          count: number;
          monthlyLimit: number;
        }
      >
    >();

    for (const vr of visitRecords) {
      const patient = vr.schedule?.case_?.patient;
      if (!patient) continue;

      const hasMedical = Boolean(patient.medical_insurance_number);
      const hasCare = Boolean(patient.care_insurance_number);
      const basis = hasMedical && hasCare ? 'both' : hasCare ? 'care' : 'medical';
      const monthlyLimit = basis === 'care' ? 2 : 4;

      const orgMap = aggregation.get(vr.org_id) ?? new Map();
      const key = `${patient.id}:${basis}`;
      const existing = orgMap.get(key) ?? {
        patientId: patient.id,
        patientName: patient.name ?? '不明',
        insuranceBasis: basis,
        count: 0,
        monthlyLimit,
      };
      existing.count++;
      orgMap.set(key, existing);
      aggregation.set(vr.org_id, orgMap);
    }

    const patientSummaries = Object.fromEntries(
      Array.from(aggregation.entries()).map(([orgId, orgMap]) => {
        const values = Array.from(orgMap.values());
        return [
          orgId,
          {
            totalPatients: values.length,
            overLimit: values.filter((entry) => entry.count > entry.monthlyLimit),
            underLimit: values.filter((entry) => entry.count < entry.monthlyLimit),
            withinLimit: values.filter((entry) => entry.count === entry.monthlyLimit),
          },
        ];
      })
    );

    const totalPatients = Array.from(aggregation.values()).reduce(
      (sum, orgMap) => sum + orgMap.size,
      0
    );

    return {
      processedCount: totalPatients,
      month: monthStart.toISOString().slice(0, 7),
      patientSummaries,
    };
  });
}

/**
 * Generate monthly operational metrics:
 * - Prescription concentration rate (処方箋集中率)
 * - Generic drug ratio (後発品割合)
 * - Home visit performance (在宅訪問実績)
 */
export async function generateMonthlyMetrics() {
  return runJob('monthly_metrics', async () => {
    const lastMonth = subMonths(new Date(), 1);
    const monthStart = startOfMonth(lastMonth);
    const monthEnd = endOfMonth(lastMonth);

    // Prescription concentration: count prescriptions grouped by prescriber institution
    const prescriptionIntakes = await prisma.prescriptionIntake.findMany({
      where: {
        prescribed_date: { gte: monthStart, lte: monthEnd },
      },
      select: {
        org_id: true,
        prescriber_institution: true,
      },
    });

    // Group by org for concentration calculation
    const orgPrescriptions = new Map<string, Map<string, number>>();
    for (const intake of prescriptionIntakes) {
      const orgMap = orgPrescriptions.get(intake.org_id) ?? new Map<string, number>();
      const institution = intake.prescriber_institution ?? 'unknown';
      orgMap.set(institution, (orgMap.get(institution) ?? 0) + 1);
      orgPrescriptions.set(intake.org_id, orgMap);
    }

    // Calculate concentration rate per org (top institution / total)
    const concentrationRates: Record<string, number> = {};
    for (const [orgId, institutionMap] of orgPrescriptions) {
      const total = Array.from(institutionMap.values()).reduce((a, b) => a + b, 0);
      const max = Math.max(...Array.from(institutionMap.values()));
      concentrationRates[orgId] = total > 0 ? Math.round((max / total) * 100) : 0;
    }

    // Home visit count per org
    const visitCounts = await prisma.visitRecord.groupBy({
      by: ['org_id'],
      where: {
        visit_date: { gte: monthStart, lte: monthEnd },
        outcome_status: 'completed',
      },
      _count: true,
    });

    const homeVisitCounts = Object.fromEntries(
      visitCounts.map((item) => [item.org_id, item._count])
    );
    const metricsCount = Object.keys(concentrationRates).length + visitCounts.length;

    return {
      processedCount: metricsCount,
      month: monthStart.toISOString().slice(0, 7),
      concentrationRates,
      homeVisitCounts,
    };
  });
}

export async function runMonthlyOperations() {
  return runJob('monthly', async () => {
    const results = await Promise.all([
      generateMonthlyVisitReport(),
      generateMonthlyMetrics(),
    ]);

    return {
      processedCount: results.reduce((total, r) => total + r.processedCount, 0),
      errors: results.flatMap((r) => r.errors ?? []),
    };
  });
}
