import { describe, expect, it, vi } from 'vitest';
import {
  buildQrOtcMedicationProfileFromIssue,
  extractQrOtcCandidate,
  promoteResolvedQrOtcIssueToMedicationProfile,
} from './qr-otc-promotion';

describe('extractQrOtcCandidate', () => {
  it('extracts OTC drug name and usage dates from labeled QR text', () => {
    expect(
      extractQrOtcCandidate(
        [
          '[qr_supplemental:intake_1:3:3]',
          'QR補助レコード 3 から自動起票したレビュー候補です。',
          '薬品名称: バファリンA',
          '服用開始年月日: 20260601',
          '服用終了年月日: 2026/06/30',
          '3,バファリンA,20260601,20260630,1,4900000000000',
        ].join('\n'),
      ),
    ).toEqual({
      drug_name: 'バファリンA',
      jan_code: '4900000000000',
      start_date: new Date('2026-06-01T00:00:00.000Z'),
      end_date: new Date('2026-06-30T00:00:00.000Z'),
    });
  });

  it('falls back to record type 3 raw line drug name', () => {
    expect(extractQrOtcCandidate('3,ロキソニンS,20260601,,1,4900000000000')).toEqual({
      drug_name: 'ロキソニンS',
      jan_code: '4900000000000',
      start_date: new Date('2026-06-01T00:00:00.000Z'),
      end_date: null,
    });
  });

  it('extracts a labeled JAN code when present', () => {
    expect(
      extractQrOtcCandidate(
        [
          '[qr_supplemental:intake_1:3:3]',
          '薬品名称: バファリンA',
          'JANコード: 4900-0000-00000',
          '服用開始年月日: 20260601',
        ].join('\n'),
      ),
    ).toMatchObject({
      drug_name: 'バファリンA',
      jan_code: '4900000000000',
    });
  });

  it('rejects non-drug placeholders and reversed usage dates', () => {
    expect(extractQrOtcCandidate('薬品名称: なし')).toBeNull();
    expect(
      extractQrOtcCandidate(
        ['薬品名称: バファリンA', '服用開始年月日: 20260630', '服用終了年月日: 20260601'].join(
          '\n',
        ),
      ),
    ).toBeNull();
  });
});

describe('buildQrOtcMedicationProfileFromIssue', () => {
  it('builds a MedicationProfile candidate only from record type 3 OTC issues', () => {
    expect(
      buildQrOtcMedicationProfileFromIssue({
        issue: {
          id: 'issue_1',
          patient_id: 'patient_1',
          category: 'other',
          title: 'QR由来のOTC・一般用薬確認候補: 要指導医薬品・一般用医薬品服用',
          description:
            '[qr_supplemental:intake_1:3:3]\n薬品名称: バファリンA\n服用開始年月日: 20260601',
        },
      }),
    ).toEqual({
      drug_name: 'バファリンA',
      jan_code: null,
      start_date: new Date('2026-06-01T00:00:00.000Z'),
      end_date: null,
    });

    expect(
      buildQrOtcMedicationProfileFromIssue({
        issue: {
          id: 'issue_2',
          patient_id: 'patient_1',
          category: 'other',
          title: 'QR由来のOTC・一般用薬確認候補: 要指導医薬品・一般用医薬品成分',
          description: '[qr_supplemental:intake_1:31:31]\n成分名: アスピリン',
        },
      }),
    ).toBeNull();
  });
});

describe('promoteResolvedQrOtcIssueToMedicationProfile', () => {
  it('creates a current otc_qr MedicationProfile for an explicitly promoted OTC issue', async () => {
    const medicationProfileCreate = vi.fn().mockResolvedValue({});
    const medicationProfileFindFirst = vi.fn().mockResolvedValue(null);
    const result = await promoteResolvedQrOtcIssueToMedicationProfile(
      {
        patient: {
          findFirst: vi.fn().mockResolvedValue({ id: 'patient_1' }),
        },
        medicationProfile: {
          findFirst: medicationProfileFindFirst,
          create: medicationProfileCreate,
        },
      },
      {
        orgId: 'org_1',
        confirmedAt: new Date('2026-06-08T12:00:00.000Z'),
        issue: {
          id: 'issue_1',
          patient_id: 'patient_1',
          category: 'other',
          title: 'QR由来のOTC・一般用薬確認候補: 要指導医薬品・一般用医薬品服用',
          description:
            '[qr_supplemental:intake_1:3:3]\n薬品名称: バファリンA\n服用開始年月日: 20260601',
        },
      },
    );

    expect(result).toMatchObject({ promoted: true });
    expect(medicationProfileFindFirst).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        patient_id: 'patient_1',
        is_current: true,
        source: 'otc_qr',
        OR: [{ drug_master_id: null, drug_name: 'バファリンA' }],
      },
      select: { id: true },
    });
    expect(medicationProfileCreate).toHaveBeenCalledWith({
      data: {
        org_id: 'org_1',
        patient_id: 'patient_1',
        drug_name: 'バファリンA',
        drug_master_id: null,
        dose: null,
        frequency: null,
        start_date: new Date('2026-06-01T00:00:00.000Z'),
        end_date: null,
        prescriber: null,
        is_current: true,
        source: 'otc_qr',
      },
    });
  });

  it('links OTC MedicationProfile to DrugMaster by JAN code when available', async () => {
    const medicationProfileCreate = vi.fn().mockResolvedValue({});
    const medicationProfileFindFirst = vi.fn().mockResolvedValue(null);
    const drugMasterFindFirst = vi.fn().mockResolvedValue({ id: 'drug_master_otc' });

    const result = await promoteResolvedQrOtcIssueToMedicationProfile(
      {
        patient: {
          findFirst: vi.fn().mockResolvedValue({ id: 'patient_1' }),
        },
        drugMaster: {
          findFirst: drugMasterFindFirst,
        },
        medicationProfile: {
          findFirst: medicationProfileFindFirst,
          create: medicationProfileCreate,
        },
      },
      {
        orgId: 'org_1',
        confirmedAt: new Date('2026-06-08T12:00:00.000Z'),
        issue: {
          id: 'issue_1',
          patient_id: 'patient_1',
          category: 'other',
          title: 'QR由来のOTC・一般用薬確認候補: 要指導医薬品・一般用医薬品服用',
          description:
            '[qr_supplemental:intake_1:3:3]\n薬品名称: バファリンA\nJANコード: 4900000000000\n服用開始年月日: 20260601',
        },
      },
    );

    expect(result).toMatchObject({
      promoted: true,
      candidate: expect.objectContaining({ jan_code: '4900000000000' }),
    });
    expect(drugMasterFindFirst).toHaveBeenCalledWith({
      where: { jan_code: '4900000000000' },
      select: { id: true },
    });
    expect(medicationProfileFindFirst).toHaveBeenCalledWith({
      where: {
        org_id: 'org_1',
        patient_id: 'patient_1',
        is_current: true,
        source: 'otc_qr',
        OR: [
          { drug_master_id: 'drug_master_otc' },
          { drug_master_id: null, drug_name: 'バファリンA' },
        ],
      },
      select: { id: true },
    });
    expect(medicationProfileCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        drug_name: 'バファリンA',
        drug_master_id: 'drug_master_otc',
      }),
    });
  });

  it('does not create a current profile without a confirmed start date', async () => {
    const medicationProfileCreate = vi.fn().mockResolvedValue({});
    const result = await promoteResolvedQrOtcIssueToMedicationProfile(
      {
        patient: {
          findFirst: vi.fn().mockResolvedValue({ id: 'patient_1' }),
        },
        medicationProfile: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: medicationProfileCreate,
        },
      },
      {
        orgId: 'org_1',
        confirmedAt: new Date('2026-06-08T12:00:00.000Z'),
        issue: {
          id: 'issue_1',
          patient_id: 'patient_1',
          category: 'other',
          title: 'QR由来のOTC・一般用薬確認候補: 要指導医薬品・一般用医薬品服用',
          description: '[qr_supplemental:intake_1:3:3]\n薬品名称: バファリンA',
        },
      },
    );

    expect(result).toEqual({ promoted: false, reason: 'start_date_required' });
    expect(medicationProfileCreate).not.toHaveBeenCalled();
  });

  it('skips duplicate current medication profiles', async () => {
    const medicationProfileCreate = vi.fn().mockResolvedValue({});
    const result = await promoteResolvedQrOtcIssueToMedicationProfile(
      {
        patient: {
          findFirst: vi.fn().mockResolvedValue({ id: 'patient_1' }),
        },
        medicationProfile: {
          findFirst: vi.fn().mockResolvedValue({ id: 'profile_1' }),
          create: medicationProfileCreate,
        },
      },
      {
        orgId: 'org_1',
        confirmedAt: new Date('2026-06-08T12:00:00.000Z'),
        issue: {
          id: 'issue_1',
          patient_id: 'patient_1',
          category: 'other',
          title: 'QR由来のOTC・一般用薬確認候補: 要指導医薬品・一般用医薬品服用',
          description:
            '[qr_supplemental:intake_1:3:3]\n薬品名称: バファリンA\n服用開始年月日: 20260601',
        },
      },
    );

    expect(result).toEqual({ promoted: false, reason: 'duplicate_current_profile' });
    expect(medicationProfileCreate).not.toHaveBeenCalled();
  });
});
