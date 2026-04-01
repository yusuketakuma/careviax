import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  visitRecordFindManyMock,
  medicationIssueFindManyMock,
  residualMedicationFindManyMock,
} = vi.hoisted(() => ({
  visitRecordFindManyMock: vi.fn(),
  medicationIssueFindManyMock: vi.fn(),
  residualMedicationFindManyMock: vi.fn(),
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {},
}));

import { computeCareTrend } from './care-trend';

function makeDb() {
  return {
    visitRecord: { findMany: visitRecordFindManyMock },
    medicationIssue: { findMany: medicationIssueFindManyMock },
    residualMedication: { findMany: residualMedicationFindManyMock },
  } as unknown as Parameters<typeof computeCareTrend>[0];
}

describe('computeCareTrend', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty trend when no visits or issues exist', async () => {
    visitRecordFindManyMock.mockResolvedValue([]);
    medicationIssueFindManyMock.mockResolvedValue([]);

    const result = await computeCareTrend(makeDb(), {
      orgId: 'org-1',
      patientId: 'p-1',
    });

    expect(result).toEqual({
      residual_trend: [],
      residual_direction: 'stable',
      issue_timeline: [],
    });
  });

  it('computes residual trend entries from visits', async () => {
    const d1 = new Date('2026-01-01');
    const d2 = new Date('2026-02-01');

    visitRecordFindManyMock.mockResolvedValue([
      { id: 'vr-2', visit_date: d2 },
      { id: 'vr-1', visit_date: d1 },
    ]);
    medicationIssueFindManyMock.mockResolvedValue([]);
    residualMedicationFindManyMock.mockResolvedValue([
      { visit_record_id: 'vr-1', excess_days: 3 },
      { visit_record_id: 'vr-2', excess_days: 5 },
      { visit_record_id: 'vr-2', excess_days: 2 },
    ]);

    const result = await computeCareTrend(makeDb(), {
      orgId: 'org-1',
      patientId: 'p-1',
    });

    // Oldest first in the trend
    expect(result.residual_trend).toHaveLength(2);
    expect(result.residual_trend[0].value).toBe(3); // vr-1
    expect(result.residual_trend[1].value).toBe(7); // vr-2: 5+2
  });

  it('detects increasing residual direction', async () => {
    const d1 = new Date('2026-01-01');
    const d2 = new Date('2026-02-01');

    visitRecordFindManyMock.mockResolvedValue([
      { id: 'vr-2', visit_date: d2 },
      { id: 'vr-1', visit_date: d1 },
    ]);
    medicationIssueFindManyMock.mockResolvedValue([]);
    residualMedicationFindManyMock.mockResolvedValue([
      { visit_record_id: 'vr-1', excess_days: 1 },
      { visit_record_id: 'vr-2', excess_days: 10 },
    ]);

    const result = await computeCareTrend(makeDb(), {
      orgId: 'org-1',
      patientId: 'p-1',
    });

    expect(result.residual_direction).toBe('increasing');
  });

  it('detects decreasing residual direction', async () => {
    const d1 = new Date('2026-01-01');
    const d2 = new Date('2026-02-01');

    visitRecordFindManyMock.mockResolvedValue([
      { id: 'vr-2', visit_date: d2 },
      { id: 'vr-1', visit_date: d1 },
    ]);
    medicationIssueFindManyMock.mockResolvedValue([]);
    residualMedicationFindManyMock.mockResolvedValue([
      { visit_record_id: 'vr-1', excess_days: 10 },
      { visit_record_id: 'vr-2', excess_days: 1 },
    ]);

    const result = await computeCareTrend(makeDb(), {
      orgId: 'org-1',
      patientId: 'p-1',
    });

    expect(result.residual_direction).toBe('decreasing');
  });

  it('builds issue timeline from medication issues', async () => {
    const identifiedAt = new Date('2026-03-01');
    const resolvedAt = new Date('2026-03-15');

    visitRecordFindManyMock.mockResolvedValue([]);
    medicationIssueFindManyMock.mockResolvedValue([
      {
        id: 'issue-1',
        title: '副作用疑い',
        status: 'resolved',
        identified_at: identifiedAt,
        resolved_at: resolvedAt,
      },
      {
        id: 'issue-2',
        title: '残薬超過',
        status: 'open',
        identified_at: identifiedAt,
        resolved_at: null,
      },
    ]);

    const result = await computeCareTrend(makeDb(), {
      orgId: 'org-1',
      patientId: 'p-1',
    });

    expect(result.issue_timeline).toHaveLength(2);
    expect(result.issue_timeline[0]).toEqual({
      issue_id: 'issue-1',
      title: '副作用疑い',
      current_status: 'resolved',
      identified_at: identifiedAt.toISOString(),
      resolved_at: resolvedAt.toISOString(),
    });
    expect(result.issue_timeline[1].resolved_at).toBeNull();
  });
});
