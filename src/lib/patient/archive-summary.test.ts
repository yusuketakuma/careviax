import { describe, expect, it } from 'vitest';
import { buildPatientArchiveSummary, normalizePatientArchiveSummary } from './archive-summary';

describe('patient archive summary helpers', () => {
  it('builds active and archived summaries from archived_at values', () => {
    expect(buildPatientArchiveSummary(null)).toEqual({
      status: 'active',
      archived: false,
      archived_at: null,
    });
    expect(buildPatientArchiveSummary(new Date('2026-06-01T00:00:00.000Z'))).toEqual({
      status: 'archived',
      archived: true,
      archived_at: '2026-06-01T00:00:00.000Z',
    });
  });

  it('normalizes only internally consistent archive summaries', () => {
    expect(
      normalizePatientArchiveSummary({
        status: 'archived',
        archived: true,
        archived_at: '2026-06-01T00:00:00.000Z',
      }),
    ).toEqual({
      status: 'archived',
      archived: true,
      archived_at: '2026-06-01T00:00:00.000Z',
    });
    expect(
      normalizePatientArchiveSummary({
        status: 'active',
        archived: true,
        archived_at: '2026-06-01T00:00:00.000Z',
      }),
    ).toBeNull();
    expect(
      normalizePatientArchiveSummary({
        status: 'archived',
        archived: true,
        archived_at: null,
      }),
    ).toBeNull();
    expect(
      normalizePatientArchiveSummary({
        status: 'archived',
        archived: true,
        archived_at: 'not-a-date',
      }),
    ).toBeNull();
  });
});
