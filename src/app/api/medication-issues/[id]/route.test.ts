import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  requireAuthContextMock,
  patientFindFirstMock,
  patientFindManyMock,
  careCaseFindFirstMock,
  careCaseFindManyMock,
  medicationProfileCreateMock,
  medicationProfileFindFirstMock,
  medicationIssueFindFirstMock,
  medicationIssueUpdateMock,
  patientLabObservationCreateMock,
  patientLabObservationFindFirstMock,
  patientUpdateMock,
  withOrgContextMock,
} = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
  patientFindFirstMock: vi.fn(),
  patientFindManyMock: vi.fn(),
  careCaseFindFirstMock: vi.fn(),
  careCaseFindManyMock: vi.fn(),
  medicationProfileCreateMock: vi.fn(),
  medicationProfileFindFirstMock: vi.fn(),
  medicationIssueFindFirstMock: vi.fn(),
  medicationIssueUpdateMock: vi.fn(),
  patientLabObservationCreateMock: vi.fn(),
  patientLabObservationFindFirstMock: vi.fn(),
  patientUpdateMock: vi.fn(),
  withOrgContextMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    patient: {
      findFirst: patientFindFirstMock,
      findMany: patientFindManyMock,
    },
    careCase: {
      findFirst: careCaseFindFirstMock,
      findMany: careCaseFindManyMock,
    },
    medicationIssue: {
      findFirst: medicationIssueFindFirstMock,
    },
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

import { PATCH } from './route';

function createPatchRequest(body: unknown) {
  return new NextRequest('http://localhost/api/medication-issues/issue_1', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function createMalformedJsonPatchRequest() {
  return new NextRequest('http://localhost/api/medication-issues/issue_1', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: '{"status":',
  });
}

describe('/api/medication-issues/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        orgId: 'org_1',
        userId: 'user_1',
        role: 'pharmacist',
      },
    });
    patientFindFirstMock.mockResolvedValue({ id: 'patient_1' });
    patientFindManyMock.mockResolvedValue([{ id: 'patient_1' }]);
    careCaseFindFirstMock.mockResolvedValue({ id: 'case_1', patient_id: 'patient_1' });
    careCaseFindManyMock.mockResolvedValue([{ id: 'case_1' }]);
    medicationIssueFindFirstMock.mockResolvedValue({
      id: 'issue_1',
      status: 'open',
      patient_id: 'patient_1',
      case_id: 'case_1',
      title: '服薬課題',
      description: '説明',
      category: 'other',
    });
    medicationIssueUpdateMock.mockResolvedValue({
      id: 'issue_1',
      status: 'resolved',
    });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        medicationIssue: {
          update: medicationIssueUpdateMock,
        },
        patient: {
          findFirst: patientFindFirstMock,
          update: patientUpdateMock,
        },
        patientLabObservation: {
          findFirst: patientLabObservationFindFirstMock,
          create: patientLabObservationCreateMock,
        },
        medicationProfile: {
          findFirst: medicationProfileFindFirstMock,
          create: medicationProfileCreateMock,
        },
      }),
    );
  });

  it('rejects non-object patch payloads before loading the medication issue', async () => {
    const response = (await PATCH(createPatchRequest([]), {
      params: Promise.resolve({ id: 'issue_1' }),
    }))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(patientFindManyMock).not.toHaveBeenCalled();
    expect(careCaseFindManyMock).not.toHaveBeenCalled();
    expect(medicationIssueFindFirstMock).not.toHaveBeenCalled();
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(medicationIssueUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON patch payloads before loading the medication issue', async () => {
    const response = (await PATCH(createMalformedJsonPatchRequest(), {
      params: Promise.resolve({ id: 'issue_1' }),
    }))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      message: 'リクエストボディが不正です',
    });
    expect(patientFindManyMock).not.toHaveBeenCalled();
    expect(careCaseFindManyMock).not.toHaveBeenCalled();
    expect(medicationIssueFindFirstMock).not.toHaveBeenCalled();
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(medicationIssueUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects blank medication issue ids before parsing or loading the issue', async () => {
    const response = (await PATCH(
      createPatchRequest({
        status: 'resolved',
      }),
      {
        params: Promise.resolve({ id: '   ' }),
      },
    ))!;

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '服薬課題IDが不正です',
    });
    expect(patientFindManyMock).not.toHaveBeenCalled();
    expect(careCaseFindManyMock).not.toHaveBeenCalled();
    expect(medicationIssueFindFirstMock).not.toHaveBeenCalled();
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(medicationIssueUpdateMock).not.toHaveBeenCalled();
  });

  it('sets resolver metadata when an issue is resolved', async () => {
    const response = (await PATCH(
      createPatchRequest({
        status: 'resolved',
      }),
      {
        params: Promise.resolve({ id: 'issue_1' }),
      },
    ))!;

    expect(response.status).toBe(200);
    expect(medicationIssueFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: 'issue_1',
        org_id: 'org_1',
      },
      select: {
        id: true,
        status: true,
        patient_id: true,
        case_id: true,
        title: true,
        description: true,
        category: true,
      },
    });
    expect(medicationIssueUpdateMock).toHaveBeenCalledWith({
      where: { id: 'issue_1' },
      data: expect.objectContaining({
        status: 'resolved',
        resolved_by: 'user_1',
        resolved_at: expect.any(Date),
      }),
    });
  });

  it('clears resolver metadata when an issue is reopened', async () => {
    medicationIssueFindFirstMock.mockResolvedValue({
      id: 'issue_1',
      status: 'resolved',
      patient_id: 'patient_1',
      case_id: 'case_1',
      title: '服薬課題',
      description: '説明',
      category: 'other',
    });

    const response = (await PATCH(
      createPatchRequest({
        status: 'in_progress',
      }),
      {
        params: Promise.resolve({ id: 'issue_1' }),
      },
    ))!;

    expect(response.status).toBe(200);
    expect(medicationIssueUpdateMock).toHaveBeenCalledWith({
      where: { id: 'issue_1' },
      data: expect.objectContaining({
        status: 'in_progress',
        resolved_by: null,
        resolved_at: null,
      }),
    });
  });

  it('returns 404 before updating an inaccessible medication issue', async () => {
    medicationIssueFindFirstMock.mockResolvedValue(null);

    const response = (await PATCH(
      createPatchRequest({
        status: 'resolved',
      }),
      {
        params: Promise.resolve({ id: 'issue_2' }),
      },
    ))!;

    expect(response.status).toBe(404);
    expect(patientFindFirstMock).not.toHaveBeenCalled();
    expect(careCaseFindFirstMock).not.toHaveBeenCalled();
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(medicationIssueUpdateMock).not.toHaveBeenCalled();
  });

  it('rejects a stored patient and case mismatch before updating', async () => {
    medicationIssueFindFirstMock.mockResolvedValue({
      id: 'issue_1',
      status: 'open',
      patient_id: 'patient_1',
      case_id: 'case_2',
      title: '服薬課題',
      description: '説明',
      category: 'other',
    });
    careCaseFindFirstMock.mockResolvedValue({ id: 'case_2', patient_id: 'patient_other' });

    const response = (await PATCH(
      createPatchRequest({
        status: 'resolved',
      }),
      {
        params: Promise.resolve({ id: 'issue_1' }),
      },
    ))!;

    expect(response.status).toBe(400);
    expect(withOrgContextMock).not.toHaveBeenCalled();
    expect(medicationIssueUpdateMock).not.toHaveBeenCalled();
  });

  it('promotes a resolved QR allergy candidate to patient allergy_info', async () => {
    medicationIssueFindFirstMock.mockResolvedValue({
      id: 'issue_1',
      status: 'open',
      patient_id: 'patient_1',
      case_id: 'case_1',
      title: 'QR由来のアレルギー・副作用歴確認候補: 患者等記入事項',
      description: '[qr_supplemental:intake_1:601:7]\nペニシリンで発疹あり',
      category: 'side_effect',
    });
    patientFindFirstMock.mockResolvedValueOnce({ id: 'patient_1' }).mockResolvedValueOnce({
      id: 'patient_1',
      allergy_info: [],
    });

    const response = (await PATCH(
      createPatchRequest({
        status: 'resolved',
      }),
      {
        params: Promise.resolve({ id: 'issue_1' }),
      },
    ))!;

    expect(response.status).toBe(200);
    expect(patientUpdateMock).toHaveBeenCalledWith({
      where: { id: 'patient_1' },
      data: {
        allergy_info: [
          {
            drug_name: 'ペニシリン',
            category: 'drug',
            severity: 'unknown',
            confirmed_at: expect.any(String),
            source: 'qr_supplemental:issue_1',
          },
        ],
      },
    });
  });

  it('promotes a QR allergy candidate using the updated description from the resolving patch', async () => {
    medicationIssueFindFirstMock.mockResolvedValue({
      id: 'issue_1',
      status: 'open',
      patient_id: 'patient_1',
      case_id: 'case_1',
      title: 'QR由来のアレルギー・副作用歴確認候補: 患者等記入事項',
      description: '[qr_supplemental:intake_1:601:7]\nペニシリンで発疹あり',
      category: 'side_effect',
    });
    patientFindFirstMock.mockResolvedValueOnce({ id: 'patient_1' }).mockResolvedValueOnce({
      id: 'patient_1',
      allergy_info: [],
    });

    const response = (await PATCH(
      createPatchRequest({
        status: 'resolved',
        description: '[qr_supplemental:intake_1:601:7]\nセフェム系で発疹あり',
      }),
      {
        params: Promise.resolve({ id: 'issue_1' }),
      },
    ))!;

    expect(response.status).toBe(200);
    expect(patientUpdateMock).toHaveBeenCalledWith({
      where: { id: 'patient_1' },
      data: {
        allergy_info: [
          {
            drug_name: 'セフェム系',
            category: 'drug',
            severity: 'unknown',
            confirmed_at: expect.any(String),
            source: 'qr_supplemental:issue_1',
          },
        ],
      },
    });
  });

  it('does not promote when the resolving patch changes the category away from side effects', async () => {
    medicationIssueFindFirstMock.mockResolvedValue({
      id: 'issue_1',
      status: 'open',
      patient_id: 'patient_1',
      case_id: 'case_1',
      title: 'QR由来のアレルギー・副作用歴確認候補: 患者等記入事項',
      description: '[qr_supplemental:intake_1:601:7]\nペニシリンで発疹あり',
      category: 'side_effect',
    });

    const response = (await PATCH(
      createPatchRequest({
        status: 'resolved',
        category: 'other',
      }),
      {
        params: Promise.resolve({ id: 'issue_1' }),
      },
    ))!;

    expect(response.status).toBe(200);
    expect(patientUpdateMock).not.toHaveBeenCalled();
  });

  it('promotes a resolved QR lab candidate to patient lab observations when measured dates are explicit', async () => {
    medicationIssueFindFirstMock.mockResolvedValue({
      id: 'issue_1',
      status: 'open',
      patient_id: 'patient_1',
      case_id: 'case_1',
      title: 'QR由来の検査値・腎機能確認候補: 患者等記入事項',
      description: '[qr_supplemental:intake_1:601:8]\n2026/06/01 eGFR 42\n2026/06/01 K 5.2',
      category: 'other',
    });
    patientFindFirstMock
      .mockResolvedValueOnce({ id: 'patient_1' })
      .mockResolvedValueOnce({ id: 'patient_1' });
    patientLabObservationFindFirstMock.mockResolvedValue(null);

    const response = (await PATCH(
      createPatchRequest({
        status: 'resolved',
      }),
      {
        params: Promise.resolve({ id: 'issue_1' }),
      },
    ))!;

    expect(response.status).toBe(200);
    expect(patientLabObservationCreateMock).toHaveBeenCalledTimes(2);
    expect(patientLabObservationCreateMock).toHaveBeenNthCalledWith(1, {
      data: expect.objectContaining({
        org_id: 'org_1',
        patient_id: 'patient_1',
        analyte_code: 'egfr',
        measured_at: new Date('2026-06-01T00:00:00.000Z'),
        value_numeric: 42,
        unit: 'mL/min/1.73m2',
        source_type: 'import',
        note: '[qr_supplemental:intake_1:601:8] medication_issue_id=issue_1 analyte=egfr',
      }),
    });
  });

  it('promotes a QR lab candidate using the updated description from the resolving patch', async () => {
    medicationIssueFindFirstMock.mockResolvedValue({
      id: 'issue_1',
      status: 'open',
      patient_id: 'patient_1',
      case_id: 'case_1',
      title: 'QR由来の検査値・腎機能確認候補: 患者等記入事項',
      description: '[qr_supplemental:intake_1:601:8]\n2026/06/01 eGFR 42',
      category: 'other',
    });
    patientFindFirstMock
      .mockResolvedValueOnce({ id: 'patient_1' })
      .mockResolvedValueOnce({ id: 'patient_1' });
    patientLabObservationFindFirstMock.mockResolvedValue(null);

    const response = (await PATCH(
      createPatchRequest({
        status: 'resolved',
        description: '[qr_supplemental:intake_1:601:8]\n2026/06/01 eGFR 35',
      }),
      {
        params: Promise.resolve({ id: 'issue_1' }),
      },
    ))!;

    expect(response.status).toBe(200);
    expect(patientLabObservationCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        analyte_code: 'egfr',
        value_numeric: 35,
      }),
    });
  });

  it('does not promote QR lab candidates when the measured date is missing', async () => {
    medicationIssueFindFirstMock.mockResolvedValue({
      id: 'issue_1',
      status: 'open',
      patient_id: 'patient_1',
      case_id: 'case_1',
      title: 'QR由来の検査値・腎機能確認候補: 患者等記入事項',
      description: '[qr_supplemental:intake_1:601:8]\neGFR 42',
      category: 'other',
    });

    const response = (await PATCH(
      createPatchRequest({
        status: 'resolved',
      }),
      {
        params: Promise.resolve({ id: 'issue_1' }),
      },
    ))!;

    expect(response.status).toBe(200);
    expect(patientLabObservationCreateMock).not.toHaveBeenCalled();
  });

  it('does not promote a QR OTC candidate without an explicit medication profile promotion flag', async () => {
    medicationIssueFindFirstMock.mockResolvedValue({
      id: 'issue_1',
      status: 'open',
      patient_id: 'patient_1',
      case_id: 'case_1',
      title: 'QR由来のOTC・一般用薬確認候補: 要指導医薬品・一般用医薬品服用',
      description:
        '[qr_supplemental:intake_1:3:3]\n薬品名称: バファリンA\n服用開始年月日: 20260601',
      category: 'other',
    });
    patientFindFirstMock
      .mockResolvedValueOnce({ id: 'patient_1' })
      .mockResolvedValueOnce({ id: 'patient_1' });
    medicationProfileFindFirstMock.mockResolvedValue(null);

    const response = (await PATCH(
      createPatchRequest({
        status: 'resolved',
      }),
      {
        params: Promise.resolve({ id: 'issue_1' }),
      },
    ))!;

    expect(response.status).toBe(200);
    expect(medicationProfileCreateMock).not.toHaveBeenCalled();
  });

  it('promotes a resolved QR OTC candidate to a current medication profile when explicitly requested', async () => {
    medicationIssueFindFirstMock.mockResolvedValue({
      id: 'issue_1',
      status: 'open',
      patient_id: 'patient_1',
      case_id: 'case_1',
      title: 'QR由来のOTC・一般用薬確認候補: 要指導医薬品・一般用医薬品服用',
      description:
        '[qr_supplemental:intake_1:3:3]\n薬品名称: バファリンA\n服用開始年月日: 20260601',
      category: 'other',
    });
    patientFindFirstMock
      .mockResolvedValueOnce({ id: 'patient_1' })
      .mockResolvedValueOnce({ id: 'patient_1' });
    medicationProfileFindFirstMock.mockResolvedValue(null);

    const response = (await PATCH(
      createPatchRequest({
        status: 'resolved',
        promote_to_medication_profile: true,
      }),
      {
        params: Promise.resolve({ id: 'issue_1' }),
      },
    ))!;

    expect(response.status).toBe(200);
    expect(medicationProfileCreateMock).toHaveBeenCalledWith({
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

  it('promotes a QR OTC candidate using the updated description from the resolving patch', async () => {
    medicationIssueFindFirstMock.mockResolvedValue({
      id: 'issue_1',
      status: 'open',
      patient_id: 'patient_1',
      case_id: 'case_1',
      title: 'QR由来のOTC・一般用薬確認候補: 要指導医薬品・一般用医薬品服用',
      description: '[qr_supplemental:intake_1:3:3]\n薬品名称: バファリンA',
      category: 'other',
    });
    patientFindFirstMock
      .mockResolvedValueOnce({ id: 'patient_1' })
      .mockResolvedValueOnce({ id: 'patient_1' });
    medicationProfileFindFirstMock.mockResolvedValue(null);

    const response = (await PATCH(
      createPatchRequest({
        status: 'resolved',
        promote_to_medication_profile: true,
        description:
          '[qr_supplemental:intake_1:3:3]\n薬品名称: ロキソニンS\n服用開始年月日: 20260601',
      }),
      {
        params: Promise.resolve({ id: 'issue_1' }),
      },
    ))!;

    expect(response.status).toBe(200);
    expect(medicationProfileCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        drug_name: 'ロキソニンS',
        source: 'otc_qr',
      }),
    });
  });

  it('does not promote QR OTC ingredient-only record candidates', async () => {
    medicationIssueFindFirstMock.mockResolvedValue({
      id: 'issue_1',
      status: 'open',
      patient_id: 'patient_1',
      case_id: 'case_1',
      title: 'QR由来のOTC・一般用薬確認候補: 要指導医薬品・一般用医薬品成分',
      description: '[qr_supplemental:intake_1:31:31]\n成分名: アスピリン',
      category: 'other',
    });

    const response = (await PATCH(
      createPatchRequest({
        status: 'resolved',
        promote_to_medication_profile: true,
      }),
      {
        params: Promise.resolve({ id: 'issue_1' }),
      },
    ))!;

    expect(response.status).toBe(200);
    expect(medicationProfileCreateMock).not.toHaveBeenCalled();
  });
});
