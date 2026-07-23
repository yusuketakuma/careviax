import { expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { getQrScanDraftRouteTestSupport } from './route.test-support';

const {
  qrScanDraftFindFirstMock,
  qrScanDraftCreateMock,
  pharmacySiteFindFirstMock,
  jahisSupplementalRecordCreateManyMock,
  broadcastStatusUpdateMock,
  isJahisQRMock,
  parseJahisQRSafeMock,
  mergeJahisQrPageTextsMock,
  mapJahisToIntakeMock,
  POST,
  createRequest,
  expectSensitiveNoStore,
} = getQrScanDraftRouteTestSupport();

export function registerQrScanDraftPostDedupeCases() {
  it('accepts an official split page without a repeated patient record and maps the reassembled data', async () => {
    const splitBase = {
      prescribingInstitution: {},
      dispensingInstitution: {},
      remarks: [],
      patientNotes: [],
      supplementalRecords: [],
    };
    parseJahisQRSafeMock
      .mockReturnValueOnce({
        success: true,
        warnings: [],
        data: {
          ...splitBase,
          patient: {
            name: '山田 太郎',
            nameKana: 'ヤマダ タロウ',
            birthDate: '1950-03-15',
            gender: 'male',
          },
          medications: [{ drugName: 'アムロジピン錠5mg', dose: '1', unit: '錠' }],
          splitInfo: { dataId: '12345678901234', splitCount: 2, sequenceNumber: 1 },
          rawText: 'JAHISTC08,1\n1,山田 太郎,1,19500315\n911,12345678901234,2,1',
        },
      })
      .mockReturnValueOnce({
        success: true,
        warnings: [],
        data: {
          ...splitBase,
          patient: { name: '' },
          medications: [],
          splitInfo: { dataId: '12345678901234', splitCount: 2, sequenceNumber: 2 },
          rawText: 'JAHISTC08,1\n301,1,朝食後,14,日分,1,1,,1\n911,12345678901234,2,2',
        },
      })
      .mockReturnValueOnce({
        success: true,
        warnings: [],
        data: {
          ...splitBase,
          patient: {
            name: '山田 太郎',
            nameKana: 'ヤマダ タロウ',
            birthDate: '1950-03-15',
            gender: 'male',
          },
          medications: [
            {
              drugName: 'アムロジピン錠5mg',
              dose: '1',
              unit: '錠',
              usage: '朝食後',
              usageQuantity: '14',
              usageUnit: '日分',
            },
          ],
          rawText: 'reassembled',
        },
      });
    mergeJahisQrPageTextsMock.mockReturnValueOnce('reassembled');

    const response = await POST(
      createRequest({
        qr_texts: [
          'JAHISTC08,1\n1,山田 太郎,1,19500315\n911,12345678901234,2,1',
          'JAHISTC08,1\n301,1,朝食後,14,日分,1,1,,1\n911,12345678901234,2,2',
        ],
        patient_id: 'patient_1',
        site_id: 'site_1',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(201);
    expect(mergeJahisQrPageTextsMock).toHaveBeenCalledOnce();
    expect(mapJahisToIntakeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        patient: expect.objectContaining({ name: '山田 太郎' }),
        medications: [
          expect.objectContaining({ usage: '朝食後', usageQuantity: '14', usageUnit: '日分' }),
        ],
      }),
      expect.any(Object),
    );
  });

  it('rejects mixed e-okusuri and outpatient prescription QR families', async () => {
    parseJahisQRSafeMock
      .mockReturnValueOnce({
        success: true,
        warnings: [],
        data: {
          patient: {
            name: '山田 太郎',
            nameKana: 'ヤマダ タロウ',
            birthDate: '1950-03-15',
            gender: 'male',
          },
          medications: [{ drugName: 'アムロジピン錠5mg' }],
          prescribingInstitution: {},
          dispensingInstitution: {},
          supplementalRecords: [],
          rawText: 'JAHISTC08,1',
        },
      })
      .mockReturnValueOnce({
        success: true,
        warnings: [],
        data: {
          patient: {
            name: '山田 太郎',
            nameKana: 'ヤマダ タロウ',
            birthDate: '1950-03-15',
            gender: 'male',
          },
          medications: [{ drugName: 'メトホルミン錠500mg' }],
          prescribingInstitution: {},
          dispensingInstitution: {},
          supplementalRecords: [],
          rawText: 'JAHIS11',
        },
      });

    const response = await POST(
      createRequest({
        qr_texts: ['JAHISTC08,1', 'JAHIS11'],
        patient_id: 'patient_1',
        site_id: 'site_1',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '異なるJAHIS QR形式が混在しています。同じ処方/お薬手帳のQRだけを読み取ってください',
    });
    expect(qrScanDraftFindFirstMock).not.toHaveBeenCalled();
    expect(qrScanDraftCreateMock).not.toHaveBeenCalled();
  });

  it('rejects exact duplicate QR payloads before creating another draft', async () => {
    qrScanDraftFindFirstMock.mockResolvedValueOnce({
      id: 'draft_existing',
      status: 'confirmed',
    });

    const response = await POST(
      createRequest({
        qr_texts: ['JAHISTC08,1'],
        patient_id: 'patient_1',
        site_id: 'site_1',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: '同じQRスキャン下書きが既に存在します',
      details: {
        duplicate_draft_id: 'draft_existing',
        status: 'confirmed',
      },
    });
    expect(qrScanDraftFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          status: { in: ['pending', 'confirmed'] },
          qr_payload_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      }),
    );
    expect(qrScanDraftCreateMock).not.toHaveBeenCalled();
    expect(jahisSupplementalRecordCreateManyMock).not.toHaveBeenCalled();
    expect(broadcastStatusUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects unmatched duplicate QR payloads using the canonical payload hash', async () => {
    qrScanDraftFindFirstMock.mockResolvedValueOnce({
      id: 'draft_unmatched_existing',
      status: 'pending',
    });

    const response = await POST(
      createRequest({
        qr_texts: ['JAHISTC08,1'],
        site_id: 'site_1',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: '同じQRスキャン下書きが既に存在します',
      details: {
        duplicate_draft_id: 'draft_unmatched_existing',
        status: 'pending',
      },
    });
    expect(qrScanDraftFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          org_id: 'org_1',
          status: { in: ['pending', 'confirmed'] },
          qr_payload_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      }),
    );
    expect(qrScanDraftCreateMock).not.toHaveBeenCalled();
    expect(jahisSupplementalRecordCreateManyMock).not.toHaveBeenCalled();
    expect(broadcastStatusUpdateMock).not.toHaveBeenCalled();
  });

  it('maps QR payload unique conflicts during create to workflow conflict', async () => {
    qrScanDraftCreateMock.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    const response = await POST(
      createRequest({
        qr_texts: ['JAHISTC08,1'],
        patient_id: 'patient_1',
        site_id: 'site_1',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: '同じQRスキャン下書きが既に存在します',
    });
    expect(jahisSupplementalRecordCreateManyMock).not.toHaveBeenCalled();
    expect(broadcastStatusUpdateMock).not.toHaveBeenCalled();
  });

  it('fails closed when duplicate QR lookup fails', async () => {
    qrScanDraftFindFirstMock.mockRejectedValueOnce(new Error('db unavailable'));

    const response = await POST(
      createRequest({
        qr_texts: ['JAHISTC08,1'],
        patient_id: 'patient_1',
        site_id: 'site_1',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WORKFLOW_CONFLICT',
      message: 'QRスキャン下書きの重複確認に失敗しました',
    });
    expect(qrScanDraftCreateMock).not.toHaveBeenCalled();
    expect(jahisSupplementalRecordCreateManyMock).not.toHaveBeenCalled();
    expect(broadcastStatusUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects site_id outside the current org before QR parsing and stock mapping', async () => {
    pharmacySiteFindFirstMock.mockResolvedValue(null);

    const response = await POST(
      createRequest({
        qr_texts: ['JAHISTC08,1'],
        site_id: 'site_other_org',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(pharmacySiteFindFirstMock).toHaveBeenCalledWith({
      where: { id: 'site_other_org', org_id: 'org_1' },
      select: { id: true },
    });
    expect(isJahisQRMock).not.toHaveBeenCalled();
    expect(parseJahisQRSafeMock).not.toHaveBeenCalled();
    expect(mapJahisToIntakeMock).not.toHaveBeenCalled();
    expect(qrScanDraftCreateMock).not.toHaveBeenCalled();
    expect(jahisSupplementalRecordCreateManyMock).not.toHaveBeenCalled();
  });

  it('rejects oversized QR text before site lookup and draft creation', async () => {
    const response = await POST(
      createRequest({
        qr_texts: [`JAHISTC08,1\n${'A'.repeat(8192)}`],
        site_id: 'site_1',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(pharmacySiteFindFirstMock).not.toHaveBeenCalled();
    expect(isJahisQRMock).not.toHaveBeenCalled();
    expect(parseJahisQRSafeMock).not.toHaveBeenCalled();
    expect(mapJahisToIntakeMock).not.toHaveBeenCalled();
    expect(qrScanDraftCreateMock).not.toHaveBeenCalled();
  });

  it('rejects too many QR texts before site lookup and draft creation', async () => {
    const response = await POST(
      createRequest({
        qr_texts: Array.from({ length: 17 }, () => 'JAHISTC08,1'),
        site_id: 'site_1',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(pharmacySiteFindFirstMock).not.toHaveBeenCalled();
    expect(isJahisQRMock).not.toHaveBeenCalled();
    expect(parseJahisQRSafeMock).not.toHaveBeenCalled();
    expect(mapJahisToIntakeMock).not.toHaveBeenCalled();
    expect(qrScanDraftCreateMock).not.toHaveBeenCalled();
  });
}
