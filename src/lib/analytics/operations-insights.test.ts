import { describe, expect, it } from 'vitest';
import {
  averageDurationMinutes,
  buildImprovementHints,
  buildMonthlyBuckets,
  tallyMonthlyVisits,
} from './operations-insights';

describe('buildMonthlyBuckets / tallyMonthlyVisits', () => {
  it('builds five trailing month buckets and tallies visits into them', () => {
    const buckets = buildMonthlyBuckets(new Date('2026-06-12T10:00:00'), 5);
    expect(buckets.map((bucket) => bucket.label)).toEqual(['2月', '3月', '4月', '5月', '6月']);

    const tallied = tallyMonthlyVisits(buckets, [
      new Date('2026-06-01T09:00:00'),
      new Date('2026-06-10T09:00:00'),
      new Date('2026-05-20T09:00:00'),
      new Date('2025-12-31T09:00:00'),
    ]);
    expect(tallied.map((bucket) => bucket.count)).toEqual([0, 0, 0, 1, 2]);
  });
});

describe('averageDurationMinutes', () => {
  it('averages non-negative durations and counts samples', () => {
    expect(
      averageDurationMinutes([
        { startedAt: new Date('2026-06-12T10:00:00'), endedAt: new Date('2026-06-12T10:30:00') },
        { startedAt: new Date('2026-06-12T10:00:00'), endedAt: new Date('2026-06-12T11:00:00') },
        { startedAt: new Date('2026-06-12T10:00:00'), endedAt: new Date('2026-06-12T09:00:00') },
      ]),
    ).toEqual({ averageMinutes: 45, sampleCount: 2 });
    expect(averageDurationMinutes([])).toEqual({ averageMinutes: 0, sampleCount: 0 });
  });
});

describe('buildImprovementHints', () => {
  it('derives hints from the slowest process and the month-over-month delta', () => {
    const hints = buildImprovementHints({
      monthlyVisits: [
        { key: '2026-05', label: '5月', count: 10 },
        { key: '2026-06', label: '6月', count: 14 },
      ],
      processes: [
        { key: 'audit', label: '監査', averageMinutes: 65, sampleCount: 4 },
        { key: 'visit', label: '訪問', averageMinutes: 120, sampleCount: 6 },
        { key: 'report', label: '報告', averageMinutes: 0, sampleCount: 0 },
      ],
    });

    expect(hints[0]).toContain('訪問');
    expect(hints[0]).toContain('120分');
    expect(hints[1]).toContain('4件増えています');
    expect(hints[2]).toContain('報告');
    expect(hints.length).toBeLessThanOrEqual(4);
  });
});
