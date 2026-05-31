import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import type { CareTrend, CareTrendEntry } from '@/types/visit-brief';

type DbClient = typeof prisma | Prisma.TransactionClient;
type CareTrendReader = {
  visitRecord: {
    findMany(args: unknown): Promise<Array<{ id: string; visit_date: Date }>>;
  };
  medicationIssue: {
    findMany(args: unknown): Promise<Array<{
      id: string;
      title: string;
      status: string;
      identified_at: Date;
      resolved_at: Date | null;
    }>>;
  };
  residualMedication: {
    findMany(args: unknown): Promise<Array<{
      visit_record_id: string;
      excess_days: number | null;
    }>>;
  };
};

const DEFAULT_VISIT_LIMIT = 5;
const ISSUE_WINDOW_DAYS = 90;
const ISSUE_LIMIT = 5;

export async function computeCareTrend(
  db: DbClient,
  args: {
    orgId: string;
    patientId: string;
    visitLimit?: number;
  }
): Promise<CareTrend>;
export async function computeCareTrend(
  db: CareTrendReader,
  args: {
    orgId: string;
    patientId: string;
    visitLimit?: number;
  }
): Promise<CareTrend>;
export async function computeCareTrend(
  db: DbClient | CareTrendReader,
  args: {
    orgId: string;
    patientId: string;
    visitLimit?: number;
  }
): Promise<CareTrend> {
  const reader = db as CareTrendReader;
  const visitLimit = args.visitLimit ?? DEFAULT_VISIT_LIMIT;
  const issueWindowStart = new Date();
  issueWindowStart.setDate(issueWindowStart.getDate() - ISSUE_WINDOW_DAYS);

  // Single DB round-trip per sub-query (no N+1): fetch visits + residuals in one query,
  // and issues in a separate query — both run in parallel.
  const [visitRecords, medicationIssues] = await Promise.all([
    reader.visitRecord.findMany({
      where: {
        org_id: args.orgId,
        patient_id: args.patientId,
      },
      orderBy: { visit_date: 'desc' },
      take: visitLimit,
      select: {
        id: true,
        visit_date: true,
      },
    }),
    reader.medicationIssue.findMany({
      where: {
        org_id: args.orgId,
        patient_id: args.patientId,
        OR: [
          { status: { in: ['open', 'in_progress'] } },
          {
            status: 'resolved',
            resolved_at: { gte: issueWindowStart },
          },
        ],
      },
      orderBy: { identified_at: 'desc' },
      take: ISSUE_LIMIT,
      select: {
        id: true,
        title: true,
        status: true,
        identified_at: true,
        resolved_at: true,
      },
    }),
  ]);

  if (visitRecords.length === 0 && medicationIssues.length === 0) {
    return {
      residual_trend: [],
      residual_direction: 'stable',
      issue_timeline: [],
    };
  }

  // Fetch all residual medications for the selected visit records in one query
  const visitIds = visitRecords.map((v) => v.id);
  const residuals =
    visitIds.length > 0
      ? await reader.residualMedication.findMany({
          where: {
            org_id: args.orgId,
            visit_record_id: { in: visitIds },
          },
          select: {
            visit_record_id: true,
            excess_days: true,
          },
        })
      : [];

  // Group residuals by visit_record_id and sum excess_days
  const excessByVisit = new Map<string, number>();
  for (const r of residuals) {
    const prev = excessByVisit.get(r.visit_record_id) ?? 0;
    excessByVisit.set(r.visit_record_id, prev + (r.excess_days ?? 0));
  }

  // Build trend entries ordered oldest→newest for direction comparison
  // visitRecords is desc (newest first), so we reverse for the trend array
  const trendEntries: CareTrendEntry[] = visitRecords
    .slice()
    .reverse()
    .map((v) => ({
      visit_date: v.visit_date.toISOString(),
      value: excessByVisit.get(v.id) ?? 0,
      label: null,
    }));

  // Determine direction: compare last (most recent) vs first (oldest)
  let residualDirection: CareTrend['residual_direction'] = 'stable';
  if (trendEntries.length >= 2) {
    const first = trendEntries[0].value;
    const last = trendEntries[trendEntries.length - 1].value;
    const diff = last - first;
    if (diff > 2) {
      residualDirection = 'increasing';
    } else if (diff < -2) {
      residualDirection = 'decreasing';
    }
  }

  // Build simplified issue timeline (2-point: identified_at → resolved_at if resolved)
  const issueTimeline = medicationIssues.map((issue) => ({
    issue_id: issue.id,
    title: issue.title,
    current_status: issue.status,
    identified_at: issue.identified_at.toISOString(),
    resolved_at: issue.resolved_at ? issue.resolved_at.toISOString() : null,
  }));

  return {
    residual_trend: trendEntries,
    residual_direction: residualDirection,
    issue_timeline: issueTimeline,
  };
}
