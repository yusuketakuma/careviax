import { describe, expect, it, vi } from 'vitest';
import {
  canAccessCareCase,
  canAccessCaseScopedPatientResource,
  canAccessPatient,
  listAccessiblePatientCaseIds,
} from './patient-access';

describe('patient access helpers', () => {
  it('scopes patient access through the shared assignment predicate for non-admin users', async () => {
    const patientFindFirst = vi.fn().mockResolvedValue({ id: 'patient_1' });

    const allowed = await canAccessPatient({
      db: {
        patient: {
          findFirst: patientFindFirst,
        },
      },
      orgId: 'org_1',
      patientId: 'patient_1',
      accessContext: { userId: 'user_1', role: 'pharmacist' },
    });

    expect(allowed).toBe(true);
    expect(patientFindFirst).toHaveBeenCalledWith({
      where: {
        id: 'patient_1',
        org_id: 'org_1',
      },
      select: { id: true },
    });
  });

  it('binds case-scoped resources to the same patient and assigned case', async () => {
    const careCaseFindFirst = vi.fn().mockResolvedValue({ id: 'case_1' });

    const allowed = await canAccessCaseScopedPatientResource({
      db: {
        patient: {
          findFirst: vi.fn(),
        },
        careCase: {
          findFirst: careCaseFindFirst,
        },
      },
      orgId: 'org_1',
      patientId: 'patient_1',
      caseId: 'case_1',
      accessContext: { userId: 'user_1', role: 'pharmacist' },
    });

    expect(allowed).toBe(true);
    expect(careCaseFindFirst).toHaveBeenCalledWith({
      where: {
        id: 'case_1',
        org_id: 'org_1',
        patient_id: 'patient_1',
      },
      select: { id: true },
    });
  });

  it('falls back to patient assignment for patient-level resources', async () => {
    const patientFindFirst = vi.fn().mockResolvedValue(null);

    const allowed = await canAccessCaseScopedPatientResource({
      db: {
        patient: {
          findFirst: patientFindFirst,
        },
        careCase: {
          findFirst: vi.fn(),
        },
      },
      orgId: 'org_1',
      patientId: 'patient_1',
      caseId: null,
      accessContext: { userId: 'user_1', role: 'pharmacist' },
    });

    expect(allowed).toBe(false);
    expect(patientFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'patient_1',
          org_id: 'org_1',
        }),
      }),
    );
  });

  it('does not add assignment predicates for admin case access', async () => {
    const careCaseFindFirst = vi.fn().mockResolvedValue({ id: 'case_1' });

    await canAccessCareCase({
      db: {
        patient: {
          findFirst: vi.fn(),
        },
        careCase: {
          findFirst: careCaseFindFirst,
        },
      },
      orgId: 'org_1',
      caseId: 'case_1',
      patientId: 'patient_1',
      accessContext: { userId: 'admin_1', role: 'admin' },
    });

    expect(careCaseFindFirst).toHaveBeenCalledWith({
      where: {
        id: 'case_1',
        org_id: 'org_1',
        patient_id: 'patient_1',
      },
      select: { id: true },
    });
  });

  it('lists accessible patient case ids with the same assignment predicate', async () => {
    const careCaseFindMany = vi.fn().mockResolvedValue([{ id: 'case_1' }, { id: 'case_2' }]);

    const caseIds = await listAccessiblePatientCaseIds({
      db: {
        patient: {
          findFirst: vi.fn(),
        },
        careCase: {
          findFirst: vi.fn(),
          findMany: careCaseFindMany,
        },
      },
      orgId: 'org_1',
      patientId: 'patient_1',
      accessContext: { userId: 'user_1', role: 'pharmacist' },
    });

    expect(caseIds).toEqual(['case_1', 'case_2']);
    expect(careCaseFindMany).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        patient_id: 'patient_1',
      },
      select: { id: true },
    });
  });
});
