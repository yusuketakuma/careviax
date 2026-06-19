import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  withOrgContextMock,
  pharmacyPartnershipFindFirstMock,
  patientFindFirstMock,
  careCaseFindFirstMock,
  patientShareCaseFindManyMock,
  patientShareCaseCreateMock,
  createAuditLogEntryMock,
} = vi.hoisted(() => ({
  withOrgContextMock: vi.fn(),
  pharmacyPartnershipFindFirstMock: vi.fn(),
  patientFindFirstMock: vi.fn(),
  careCaseFindFirstMock: vi.fn(),
  patientShareCaseFindManyMock: vi.fn(),
  patientShareCaseCreateMock: vi.fn(),
  createAuditLogEntryMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: (handler: (...args: unknown[]) => Promise<Response>) => {
    return (req: NextRequest, routeContext?: unknown) =>
      handler(
        req,
        {
          orgId: 'org_1',
          userId: 'user_1',
          role: 'pharmacist',
        },
        routeContext,
      );
  },
}));

vi.mock('@/lib/db/rls', () => ({
  withOrgContext: withOrgContextMock,
}));

vi.mock('@/lib/audit/audit-entry', () => ({
  createAuditLogEntry: createAuditLogEntryMock,
}));

import { GET as rawGET, POST as rawPOST } from './route';

const emptyRouteContext = { params: Promise.resolve({}) };
const GET = (req: NextRequest) => rawGET(req, emptyRouteContext);
const POST = (req: NextRequest) => rawPOST(req, emptyRouteContext);

function createRequest(body?: unknown) {
  return new NextRequest('http://localhost/api/patient-share-cases', {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function createPostRequest(body: unknown) {
  return new NextRequest('http://localhost/api/patient-share-cases', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('/api/patient-share-cases POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pharmacyPartnershipFindFirstMock.mockResolvedValue({
      id: 'partnership_1',
      status: 'active',
      partner_pharmacy: { status: 'active' },
    });
    patientFindFirstMock.mockResolvedValue({
      id: 'patient_1',
      name: '山田 花子',
      name_kana: 'ヤマダ ハナコ',
      birth_date: new Date('1950-01-02T00:00:00.000Z'),
      gender: 'female',
      residences: [
        {
          address: '東京都港区1-2-3',
          facility_id: null,
          facility_unit_id: null,
          unit_name: '203',
        },
      ],
    });
    careCaseFindFirstMock.mockResolvedValue({ id: 'case_1', patient_id: 'patient_1' });
    patientShareCaseCreateMock.mockResolvedValue({
      id: 'share_case_1',
      status: 'draft',
      partnership_id: 'partnership_1',
      base_patient_id: 'patient_1',
      patient_link: { id: 'patient_link_1', match_status: 'pending' },
    });
    patientShareCaseFindManyMock.mockResolvedValue([
      {
        id: 'share_case_1',
        status: 'draft',
        patient_link: {
          id: 'patient_link_1',
          match_status: 'pending',
          approved_by_base: null,
          approved_by_partner: null,
          accepted_at: null,
          declined_at: null,
          partner_patient_id: 'partner_patient_1',
          base_patient_snapshot: { name: '山田 花子' },
          partner_patient_snapshot: { address: '東京都港区1-2-3' },
          decline_reason: '別人でした',
        },
      },
    ]);
    createAuditLogEntryMock.mockResolvedValue({ id: 'audit_1' });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        pharmacyPartnership: {
          findFirst: pharmacyPartnershipFindFirstMock,
        },
        patient: {
          findFirst: patientFindFirstMock,
        },
        careCase: {
          findFirst: careCaseFindFirstMock,
        },
        patientShareCase: {
          findMany: patientShareCaseFindManyMock,
          create: patientShareCaseCreateMock,
        },
      }),
    );
  });

  it('lists share cases without returning patient-link snapshots or decline reasons', async () => {
    const response = await GET(createRequest());

    expect(response.status).toBe(200);
    expect(patientShareCaseFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          patient_link: {
            select: {
              id: true,
              match_status: true,
              approved_by_base: true,
              approved_by_partner: true,
              accepted_at: true,
              declined_at: true,
              partner_patient_id: true,
            },
          },
        }),
      }),
    );
    const bodyText = JSON.stringify(await response.json());
    expect(bodyText).not.toContain('base_patient_snapshot');
    expect(bodyText).not.toContain('partner_patient_snapshot');
    expect(bodyText).not.toContain('別人でした');
    expect(bodyText).not.toContain('山田 花子');
    expect(bodyText).not.toContain('東京都港区1-2-3');
    expect(bodyText).toContain('has_partner_patient_id');
  });

  it('creates a draft share case with a pending patient link and patient snapshot', async () => {
    const response = await POST(
      createPostRequest({
        partnership_id: ' partnership_1 ',
        base_patient_id: ' patient_1 ',
        base_case_id: ' case_1 ',
        starts_at: '2026-06-01',
        share_scope: {
          medication_profile: true,
          care_reports: true,
          download: false,
        },
      }),
    );

    expect(response.status).toBe(201);
    expect(patientShareCaseCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        partnership_id: 'partnership_1',
        base_patient_id: 'patient_1',
        base_case_id: 'case_1',
        status: 'draft',
        starts_at: new Date('2026-06-01T00:00:00.000Z'),
        ends_at: null,
        created_by: 'user_1',
        updated_by: 'user_1',
        patient_link: {
          create: expect.objectContaining({
            org_id: 'org_1',
            base_patient_id: 'patient_1',
            match_status: 'pending',
            base_patient_snapshot: expect.objectContaining({
              id: 'patient_1',
              name: '山田 花子',
              birth_date: '1950-01-02',
              primary_residence: expect.objectContaining({
                address: '東京都港区1-2-3',
              }),
            }),
          }),
        },
      }),
      include: expect.any(Object),
    });
    expect(createAuditLogEntryMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orgId: 'org_1', userId: 'user_1' }),
      expect.objectContaining({
        action: 'patient_share_case_created',
        targetType: 'PatientShareCase',
        targetId: 'share_case_1',
      }),
    );
    expect(JSON.stringify(createAuditLogEntryMock.mock.calls)).not.toContain('山田 花子');
    expect(JSON.stringify(createAuditLogEntryMock.mock.calls)).not.toContain('東京都港区1-2-3');
  });

  it('rejects a care case that belongs to another patient before create or audit side effects', async () => {
    careCaseFindFirstMock.mockResolvedValue({ id: 'case_1', patient_id: 'patient_other' });

    const response = await POST(
      createPostRequest({
        partnership_id: 'partnership_1',
        base_patient_id: 'patient_1',
        base_case_id: 'case_1',
      }),
    );

    expect(response.status).toBe(400);
    expect(patientShareCaseCreateMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });
});
