import { expect, it } from 'vitest';
import { getQrScanDraftRouteTestSupport } from './route.test-support';

const {
  qrScanDraftFindFirstMock,
  qrScanDraftCreateMock,
  patientFindFirstMock,
  pharmacySiteFindFirstMock,
  jahisSupplementalRecordCreateManyMock,
  broadcastStatusUpdateMock,
  isJahisQRMock,
  parseJahisQRSafeMock,
  detectMultiQRMock,
  hasJahisQrSplitRecordMock,
  mapJahisToIntakeMock,
  canAccessPrescriptionPatientMock,
  POST,
  createRequest,
  expectSensitiveNoStore,
} = getQrScanDraftRouteTestSupport();

export function registerQrScanDraftPostIdentitySplitCases() {
  it('rejects blank QR texts and blank site ids before lookup or parsing', async () => {
    const response = await POST(
      createRequest({
        qr_texts: ['JAHISTC08,1', '   '],
        site_id: '   ',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(pharmacySiteFindFirstMock).not.toHaveBeenCalled();
    expect(isJahisQRMock).not.toHaveBeenCalled();
    expect(parseJahisQRSafeMock).not.toHaveBeenCalled();
    expect(mapJahisToIntakeMock).not.toHaveBeenCalled();
    expect(qrScanDraftCreateMock).not.toHaveBeenCalled();
  });

  it('rejects a malformed Record 911 before parsing or persistence', async () => {
    hasJahisQrSplitRecordMock.mockReturnValueOnce(true);
    detectMultiQRMock.mockReturnValueOnce(null);

    const response = await POST(
      createRequest({
        qr_texts: ['JAHISTC08,1\n911,short,2,1'],
        site_id: 'site_1',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '分割制御レコードが不正です',
      details: { invalid_indexes: [0] },
    });
    expect(parseJahisQRSafeMock).not.toHaveBeenCalled();
    expect(mapJahisToIntakeMock).not.toHaveBeenCalled();
    expect(qrScanDraftCreateMock).not.toHaveBeenCalled();
  });

  it('rejects patient_id outside the current org before saving the draft', async () => {
    patientFindFirstMock.mockResolvedValue(null);

    const response = await POST(
      createRequest({
        qr_texts: ['JAHISTC08,1'],
        patient_id: 'patient_other_org',
        site_id: 'site_1',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expect(qrScanDraftCreateMock).not.toHaveBeenCalled();
    expect(jahisSupplementalRecordCreateManyMock).not.toHaveBeenCalled();
  });

  it('keeps inaccessible or nonexistent patient targets non-enumerating', async () => {
    canAccessPrescriptionPatientMock.mockResolvedValueOnce(false);

    const response = await POST(
      createRequest({
        qr_texts: ['JAHISTC08,1'],
        patient_id: 'patient_hidden',
        site_id: 'site_1',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '指定された患者を確認できません',
    });
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(qrScanDraftCreateMock).not.toHaveBeenCalled();
  });

  it('rejects selected patients whose master identity does not match the QR patient', async () => {
    patientFindFirstMock.mockResolvedValue({
      id: 'patient_1',
      name: '山田 太郎',
      name_kana: 'ヤマダ タロウ',
      birth_date: new Date('1960-06-15T00:00:00.000Z'),
      gender: 'male',
    });

    const response = await POST(
      createRequest({
        qr_texts: ['JAHISTC08,1'],
        patient_id: 'patient_1',
        site_id: 'site_1',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'QRコードの患者情報が選択患者と一致しません',
    });
    expect(qrScanDraftFindFirstMock).not.toHaveBeenCalled();
    expect(qrScanDraftCreateMock).not.toHaveBeenCalled();
    expect(jahisSupplementalRecordCreateManyMock).not.toHaveBeenCalled();
    expect(broadcastStatusUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects QR payloads whose patient identity cannot be verified', async () => {
    parseJahisQRSafeMock.mockReturnValueOnce({
      success: true,
      warnings: [],
      data: {
        patient: {
          name: '山田 太郎',
          nameKana: 'ヤマダ タロウ',
          birthDate: null,
          gender: 'male',
        },
        medications: [{ drugName: 'アムロジピン錠5mg' }],
        prescribingInstitution: {},
        dispensingInstitution: {},
        supplementalRecords: [],
        rawText: 'JAHISTC08,1',
      },
    });

    const response = await POST(
      createRequest({
        qr_texts: ['JAHISTC08,1'],
        patient_id: 'patient_1',
        site_id: 'site_1',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'QRコードの患者情報を確認できません',
      details: {
        missing_identity: ['birth_date'],
      },
    });
    expect(qrScanDraftFindFirstMock).not.toHaveBeenCalled();
    expect(qrScanDraftCreateMock).not.toHaveBeenCalled();
    expect(jahisSupplementalRecordCreateManyMock).not.toHaveBeenCalled();
    expect(broadcastStatusUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects incomplete split QR page sets before saving a draft', async () => {
    parseJahisQRSafeMock.mockReturnValueOnce({
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
        splitInfo: {
          dataId: '12345678901234',
          splitCount: 2,
          sequenceNumber: 1,
        },
        rawText: 'JAHISTC08,1\n911,12345678901234,002,001',
      },
    });

    const response = await POST(
      createRequest({
        qr_texts: ['JAHISTC08,1\n911,12345678901234,002,001'],
        patient_id: 'patient_1',
        site_id: 'site_1',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '分割QRの枚数が不足しています。2枚中1枚です',
    });
    expect(qrScanDraftFindFirstMock).not.toHaveBeenCalled();
    expect(qrScanDraftCreateMock).not.toHaveBeenCalled();
  });

  it('rejects split QR pages whose data id does not match', async () => {
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
          splitInfo: {
            dataId: '12345678901234',
            splitCount: 2,
            sequenceNumber: 1,
          },
          rawText: 'JAHISTC08,1\n911,12345678901234,002,001',
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
          splitInfo: {
            dataId: '99999999999999',
            splitCount: 2,
            sequenceNumber: 2,
          },
          rawText: 'JAHISTC08,1\n911,99999999999999,002,002',
        },
      });

    const response = await POST(
      createRequest({
        qr_texts: [
          'JAHISTC08,1\n911,12345678901234,002,001',
          'JAHISTC08,1\n911,99999999999999,002,002',
        ],
        patient_id: 'patient_1',
        site_id: 'site_1',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message:
        '分割QRの識別子または総枚数が一致しません。同じ処方/お薬手帳のQRだけを読み取ってください',
    });
    expect(qrScanDraftFindFirstMock).not.toHaveBeenCalled();
    expect(qrScanDraftCreateMock).not.toHaveBeenCalled();
  });

  it('rejects split QR pages whose patient identity differs', async () => {
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
          splitInfo: {
            dataId: '12345678901234',
            splitCount: 2,
            sequenceNumber: 1,
          },
          rawText: 'JAHISTC08,1\n911,12345678901234,002,001',
        },
      })
      .mockReturnValueOnce({
        success: true,
        warnings: [],
        data: {
          patient: {
            name: '佐藤 花子',
            nameKana: 'サトウ ハナコ',
            birthDate: '1950-03-15',
            gender: 'female',
          },
          medications: [{ drugName: 'メトホルミン錠500mg' }],
          prescribingInstitution: {},
          dispensingInstitution: {},
          supplementalRecords: [],
          splitInfo: {
            dataId: '12345678901234',
            splitCount: 2,
            sequenceNumber: 2,
          },
          rawText: 'JAHISTC08,1\n911,12345678901234,002,002',
        },
      });

    const response = await POST(
      createRequest({
        qr_texts: [
          'JAHISTC08,1\n911,12345678901234,002,001',
          'JAHISTC08,1\n911,12345678901234,002,002',
        ],
        site_id: 'site_1',
      }),
    );

    if (!response) throw new Error('response is required');
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '分割QR内の患者情報が一致しません。同じ患者のQRだけを読み取ってください',
    });
    expect(qrScanDraftFindFirstMock).not.toHaveBeenCalled();
    expect(qrScanDraftCreateMock).not.toHaveBeenCalled();
  });
}
