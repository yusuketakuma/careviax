import { unzipSync, strFromU8 } from 'fflate';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  transactionMock,
  integrationJobCountMock,
  integrationJobCreateMock,
  integrationJobUpdateManyMock,
  integrationJobFindUniqueMock,
  integrationJobFindFirstMock,
  integrationJobUpdateMock,
  membershipFindFirstMock,
  patientCountMock,
  visitScheduleFindManyMock,
  careCaseFindManyMock,
  notificationUpsertMock,
  buildMedicationHistoryPdfMock,
  storeGeneratedFileMock,
} = vi.hoisted(() => ({
  transactionMock: vi.fn(),
  integrationJobCountMock: vi.fn(),
  integrationJobCreateMock: vi.fn(),
  integrationJobUpdateManyMock: vi.fn(),
  integrationJobFindUniqueMock: vi.fn(),
  integrationJobFindFirstMock: vi.fn(),
  integrationJobUpdateMock: vi.fn(),
  membershipFindFirstMock: vi.fn(),
  patientCountMock: vi.fn(),
  visitScheduleFindManyMock: vi.fn(),
  careCaseFindManyMock: vi.fn(),
  notificationUpsertMock: vi.fn(),
  buildMedicationHistoryPdfMock: vi.fn(),
  storeGeneratedFileMock: vi.fn(),
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    $transaction: transactionMock,
    integrationJob: {
      count: integrationJobCountMock,
      create: integrationJobCreateMock,
      updateMany: integrationJobUpdateManyMock,
      findUnique: integrationJobFindUniqueMock,
      findFirst: integrationJobFindFirstMock,
      update: integrationJobUpdateMock,
    },
    membership: {
      findFirst: membershipFindFirstMock,
    },
    patient: {
      count: patientCountMock,
    },
    visitSchedule: {
      findMany: visitScheduleFindManyMock,
    },
    careCase: {
      findMany: careCaseFindManyMock,
    },
    notification: {
      upsert: notificationUpsertMock,
    },
  },
}));

vi.mock('@/server/services/pdf-documents', () => ({
  buildMedicationHistoryPdf: buildMedicationHistoryPdfMock,
}));

vi.mock('@/server/services/file-storage', () => ({
  storeGeneratedFile: storeGeneratedFileMock,
}));

import {
  drainMedicationHistoryBulkExportQueue,
  queueMedicationHistoryBulkExport,
  runMedicationHistoryBulkExportJob,
} from './pdf-bulk-export';

describe('pdf-bulk-export', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    integrationJobCountMock.mockResolvedValue(0);
    patientCountMock.mockResolvedValue(2);
    integrationJobCreateMock.mockResolvedValue({ id: 'job_1' });
    integrationJobUpdateManyMock.mockResolvedValue({ count: 1 });
    integrationJobFindUniqueMock.mockResolvedValue({
      id: 'job_1',
      org_id: 'org_1',
      status: 'pending',
      job_type: 'medication-history-bulk-export',
      input: {
        version: 1,
        requestedBy: 'user_1',
        patientIds: ['patient_1', 'patient_2'],
      },
    });
    buildMedicationHistoryPdfMock
      .mockResolvedValueOnce({
        fileName: 'medications-patient_1.pdf',
        buffer: Buffer.from('%PDF-A'),
      })
      .mockResolvedValueOnce({
        fileName: 'medications-patient_2.pdf',
        buffer: Buffer.from('%PDF-B'),
      });
    storeGeneratedFileMock.mockResolvedValue({ id: 'file_1' });
    integrationJobUpdateMock.mockResolvedValue({});
    membershipFindFirstMock.mockResolvedValue({ role: 'admin' });
    visitScheduleFindManyMock.mockResolvedValue([]);
    careCaseFindManyMock.mockResolvedValue([]);
    notificationUpsertMock.mockResolvedValue({});
    transactionMock.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        integrationJob: {
          count: integrationJobCountMock,
          create: integrationJobCreateMock,
          updateMany: integrationJobUpdateManyMock,
          findUnique: integrationJobFindUniqueMock,
          findFirst: integrationJobFindFirstMock,
        },
        patient: {
          count: patientCountMock,
        },
        visitSchedule: {
          findMany: visitScheduleFindManyMock,
        },
        careCase: {
          findMany: careCaseFindManyMock,
        },
      }),
    );
  });

  it('queues a medication history bulk export job', async () => {
    const result = await queueMedicationHistoryBulkExport({
      orgId: 'org_1',
      requestedBy: 'user_1',
      patientIds: ['patient_1', 'patient_2', 'patient_1'],
      accessContext: {
        userId: 'user_1',
        role: 'admin',
      },
    });

    expect(result).toMatchObject({
      jobId: 'job_1',
      queuePosition: 1,
      patientCount: 2,
      startedImmediately: true,
    });
    expect(integrationJobCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          job_type: 'medication-history-bulk-export',
          status: 'pending',
          org_id: 'org_1',
          input: expect.objectContaining({
            requestedBy: 'user_1',
            patientIds: ['patient_1', 'patient_2'],
          }),
        }),
      }),
    );
  });

  it('queues a non-admin bulk export when every patient is assigned or case-controlled', async () => {
    visitScheduleFindManyMock.mockResolvedValue([{ case_: { patient_id: 'patient_1' } }]);
    careCaseFindManyMock.mockResolvedValue([
      {
        patient_id: 'patient_2',
        primary_pharmacist_id: 'user_1',
        backup_pharmacist_id: null,
      },
    ]);

    const result = await queueMedicationHistoryBulkExport({
      orgId: 'org_1',
      requestedBy: 'user_1',
      patientIds: ['patient_1', 'patient_2'],
      accessContext: {
        userId: 'user_1',
        role: 'pharmacist',
      },
    });

    expect(result).toMatchObject({
      jobId: 'job_1',
      patientCount: 2,
    });
    expect(integrationJobCreateMock).toHaveBeenCalledOnce();
    expect(visitScheduleFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          case_: {
            patient_id: {
              in: ['patient_1', 'patient_2'],
            },
          },
        }),
      }),
    );
  });

  it('rejects non-admin bulk exports containing unassigned same-org patients', async () => {
    visitScheduleFindManyMock.mockResolvedValue([{ case_: { patient_id: 'patient_1' } }]);
    careCaseFindManyMock.mockResolvedValue([]);

    await expect(
      queueMedicationHistoryBulkExport({
        orgId: 'org_1',
        requestedBy: 'user_1',
        patientIds: ['patient_1', 'patient_2'],
        accessContext: {
          userId: 'user_1',
          role: 'pharmacist',
        },
      }),
    ).rejects.toMatchObject({
      code: 'AUTHORIZATION_ERROR',
      status: 403,
    });
    expect(integrationJobCreateMock).not.toHaveBeenCalled();
  });

  it('rejects bulk export queue requests when the caller lacks visit permission', async () => {
    await expect(
      queueMedicationHistoryBulkExport({
        orgId: 'org_1',
        requestedBy: 'user_1',
        patientIds: ['patient_1'],
        accessContext: {
          userId: 'user_1',
          role: 'clerk',
        },
      }),
    ).rejects.toMatchObject({
      code: 'AUTHORIZATION_ERROR',
      status: 403,
    });
    expect(integrationJobCountMock).not.toHaveBeenCalled();
  });

  it('renders PDFs, stores an attachment ZIP, and notifies the requester', async () => {
    integrationJobFindFirstMock.mockResolvedValue(null);

    const result = await runMedicationHistoryBulkExportJob('job_1');

    expect(result).toMatchObject({
      jobId: 'job_1',
      fileId: 'file_1',
      patientCount: 2,
    });
    expect(buildMedicationHistoryPdfMock).toHaveBeenNthCalledWith(1, 'org_1', 'patient_1');
    expect(buildMedicationHistoryPdfMock).toHaveBeenNthCalledWith(2, 'org_1', 'patient_2');
    expect(storeGeneratedFileMock).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'org_1',
        purpose: 'bulk-export',
        mimeType: 'application/zip',
        uploadedBy: 'user_1',
        jobId: 'job_1',
        downloadDisposition: 'attachment',
      }),
    );

    const zipBuffer = storeGeneratedFileMock.mock.calls[0]?.[0]?.buffer as Buffer;
    const entries = unzipSync(new Uint8Array(zipBuffer));
    expect(strFromU8(entries['medications-patient_1.pdf'] ?? new Uint8Array())).toBe('%PDF-A');
    expect(strFromU8(entries['medications-patient_2.pdf'] ?? new Uint8Array())).toBe('%PDF-B');

    expect(notificationUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          user_id: 'user_1',
          link: '/api/files/file_1/download',
        }),
      }),
    );
  });

  it('drains the pending export queue', async () => {
    integrationJobFindFirstMock
      .mockResolvedValueOnce({ id: 'job_1' })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);

    const result = await drainMedicationHistoryBulkExportQueue();

    expect(result).toMatchObject({
      processedCount: 2,
      errors: [],
    });
    expect(integrationJobFindFirstMock).toHaveBeenCalledTimes(3);
  });

  it('does not auto-retry failed jobs during drain', async () => {
    integrationJobFindFirstMock.mockResolvedValue(null);

    const result = await drainMedicationHistoryBulkExportQueue();

    expect(result).toMatchObject({
      processedCount: 0,
      errors: [],
    });
    expect(integrationJobUpdateManyMock).not.toHaveBeenCalled();
  });
});
