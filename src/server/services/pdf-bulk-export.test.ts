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
  patientCountMock,
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
  patientCountMock: vi.fn(),
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
    patient: {
      count: patientCountMock,
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
      }),
    );
  });

  it('queues a medication history bulk export job', async () => {
    const result = await queueMedicationHistoryBulkExport({
      orgId: 'org_1',
      requestedBy: 'user_1',
      patientIds: ['patient_1', 'patient_2', 'patient_1'],
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
