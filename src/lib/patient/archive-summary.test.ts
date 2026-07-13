import { describe, expect, it } from 'vitest';
import {
  buildPatientArchiveSummary,
  isPatientArchivedWriteConflictPayload,
  isPatientArchiveWritable,
  normalizePatientArchiveSummary,
  PATIENT_ARCHIVED_WRITE_CONFLICT_CODE,
  PATIENT_ARCHIVED_WRITE_CONFLICT_MESSAGE,
} from './archive-summary';

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

  it('permits writes only for an explicit internally consistent active state', () => {
    expect(isPatientArchiveWritable(buildPatientArchiveSummary(null))).toBe(true);
    expect(isPatientArchiveWritable(buildPatientArchiveSummary('2026-06-01T00:00:00.000Z'))).toBe(
      false,
    );
    expect(isPatientArchiveWritable(null)).toBe(false);
    expect(isPatientArchiveWritable(undefined)).toBe(false);
  });

  it('recognizes only the canonical archived-patient conflict payload', () => {
    expect(
      isPatientArchivedWriteConflictPayload({
        code: PATIENT_ARCHIVED_WRITE_CONFLICT_CODE,
        message: PATIENT_ARCHIVED_WRITE_CONFLICT_MESSAGE,
      }),
    ).toBe(true);
    expect(
      isPatientArchivedWriteConflictPayload({
        code: 'UNRELATED_CONFLICT',
        message: PATIENT_ARCHIVED_WRITE_CONFLICT_MESSAGE,
      }),
    ).toBe(false);
    expect(
      isPatientArchivedWriteConflictPayload({
        code: 'WORKFLOW_CONFLICT',
        message: '患者A token=secret の依頼は既に起票済みです',
      }),
    ).toBe(false);
    expect(isPatientArchivedWriteConflictPayload(null)).toBe(false);
  });
});
