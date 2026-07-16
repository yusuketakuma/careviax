import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  organizationFindManyMock,
  patientFindManyMock,
  withOrgContextMock,
  trackPatientStatusChangesMock,
} = vi.hoisted(() => ({
  organizationFindManyMock: vi.fn(),
  patientFindManyMock: vi.fn(),
  withOrgContextMock: vi.fn(),
  trackPatientStatusChangesMock: vi.fn(),
}));

vi.mock('@/lib/db/client', () => ({
  prisma: { organization: { findMany: organizationFindManyMock } },
}));
vi.mock('@/lib/db/rls', () => ({ withOrgContext: withOrgContextMock }));
vi.mock('@/server/services/patient-status-tracker', () => ({
  trackPatientStatusChanges: trackPatientStatusChangesMock,
}));
vi.mock('../runner', () => ({
  runJob: vi.fn(async (_type: string, work: () => Promise<unknown>) => work()),
}));

import { trackAllOrgPatientStatuses } from './patient-status';

describe('patient status daily job', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    organizationFindManyMock.mockResolvedValue([{ id: 'org_1' }]);
    withOrgContextMock.mockImplementation(
      async (orgId: string, work: (tx: unknown) => Promise<unknown>) =>
        work({
          orgId,
          patient: { findMany: patientFindManyMock },
        }),
    );
    trackPatientStatusChangesMock.mockResolvedValue({ changed: [], notifications: [] });
  });

  it('scans and tracks 101 patients in stable tenant pages', async () => {
    const patients = Array.from({ length: 101 }, (_, index) => ({
      id: `patient_${String(index).padStart(3, '0')}`,
    }));
    patientFindManyMock
      .mockResolvedValueOnce(patients.slice(0, 100))
      .mockResolvedValueOnce(patients.slice(100));
    trackPatientStatusChangesMock
      .mockResolvedValueOnce({ changed: [{ patientId: 'p1' }], notifications: [] })
      .mockResolvedValueOnce({ changed: [{ patientId: 'p2' }], notifications: [] });

    await expect(trackAllOrgPatientStatuses()).resolves.toEqual({ processedCount: 2 });

    expect(patientFindManyMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        cursor: { id: 'patient_099' },
        skip: 1,
        take: 100,
        orderBy: { id: 'asc' },
      }),
    );
    expect(trackPatientStatusChangesMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ orgId: 'org_1' }),
      { orgId: 'org_1', actorId: 'system', patientIds: patients.slice(0, 100).map(({ id }) => id) },
    );
    expect(trackPatientStatusChangesMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ orgId: 'org_1' }),
      { orgId: 'org_1', actorId: 'system', patientIds: ['patient_100'] },
    );
  });

  it('does not track a partial patient set when a later scan page fails', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({ id: `patient_${index}` }));
    patientFindManyMock
      .mockResolvedValueOnce(firstPage)
      .mockRejectedValueOnce(new Error('patient_page_2_failed'));

    await expect(trackAllOrgPatientStatuses()).rejects.toThrow('patient_page_2_failed');

    expect(trackPatientStatusChangesMock).not.toHaveBeenCalled();
  });
});
