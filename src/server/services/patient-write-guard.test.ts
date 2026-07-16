import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthContext } from '@/lib/auth/context';
import {
  acquirePatientWriteStateLock,
  requireWritablePatientForUpdate,
} from './patient-write-guard';

const ctx: AuthContext = {
  orgId: 'org_1',
  userId: 'user_1',
  role: 'pharmacist',
};

describe('patient write-state serialization', () => {
  const executeRaw = vi.fn();
  const patientFindFirst = vi.fn();
  const tx = {
    $executeRaw: executeRaw,
    patient: { findFirst: patientFindFirst },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    executeRaw.mockResolvedValue(1);
  });

  it('uses one deterministic transaction-scoped advisory lock per org and patient', async () => {
    await acquirePatientWriteStateLock(tx, 'org_1', 'patient_1');
    await acquirePatientWriteStateLock(tx, 'org_1', 'patient_1');

    expect(executeRaw).toHaveBeenCalledTimes(2);
    const first = executeRaw.mock.calls[0]?.[0] as { strings: string[]; values: unknown[] };
    const second = executeRaw.mock.calls[1]?.[0] as { strings: string[]; values: unknown[] };
    expect(first.strings.join('?')).toContain('pg_advisory_xact_lock');
    expect(first.values).toEqual(second.values);
  });

  it('locks before re-reading writable state', async () => {
    patientFindFirst.mockResolvedValue({ id: 'patient_1', archived_at: null });

    const result = await requireWritablePatientForUpdate(tx, ctx, 'patient_1');

    expect(result).toEqual({ patient: { id: 'patient_1', archived_at: null } });
    expect(executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
      patientFindFirst.mock.invocationCallOrder[0],
    );
  });

  it('returns the canonical conflict when the serialized re-read observes an archive', async () => {
    patientFindFirst.mockResolvedValue({
      id: 'patient_1',
      archived_at: new Date('2026-06-01T00:00:00.000Z'),
    });

    const result = await requireWritablePatientForUpdate(tx, ctx, 'patient_1');

    if (!('response' in result)) throw new Error('expected archived-patient conflict');
    expect(result.response.status).toBe(409);
    await expect(result.response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
    });
  });
});
