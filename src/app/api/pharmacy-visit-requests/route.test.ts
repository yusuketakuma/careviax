import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  withOrgContextMock,
  patientShareCaseFindFirstMock,
  pharmacyContractFindFirstMock,
  pharmacyContractVersionFindFirstMock,
  pharmacyVisitRequestCreateMock,
  createAuditLogEntryMock,
} = vi.hoisted(() => ({
  withOrgContextMock: vi.fn(),
  patientShareCaseFindFirstMock: vi.fn(),
  pharmacyContractFindFirstMock: vi.fn(),
  pharmacyContractVersionFindFirstMock: vi.fn(),
  pharmacyVisitRequestCreateMock: vi.fn(),
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

import { POST as rawPOST } from './route';

const emptyRouteContext = { params: Promise.resolve({}) };
const POST = (req: NextRequest) => rawPOST(req, emptyRouteContext);

function createRequest(body: unknown) {
  return new NextRequest('http://localhost/api/pharmacy-visit-requests', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('/api/pharmacy-visit-requests POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    patientShareCaseFindFirstMock.mockResolvedValue({
      id: 'share_case_1',
      status: 'active',
      starts_at: new Date('2026-06-01T00:00:00.000Z'),
      ends_at: new Date('2026-12-31T00:00:00.000Z'),
      partnership_id: 'partnership_1',
      partnership: {
        id: 'partnership_1',
        status: 'active',
        effective_from: new Date('2026-06-01T00:00:00.000Z'),
        effective_to: new Date('2026-12-31T00:00:00.000Z'),
        partner_pharmacy_id: 'partner_pharmacy_1',
        partner_pharmacy: { id: 'partner_pharmacy_1', status: 'active', name: '協力薬局' },
        base_site: { id: 'site_1', name: '基幹薬局' },
      },
    });
    pharmacyContractFindFirstMock.mockResolvedValue({
      id: 'contract_1',
      closing_day: 20,
      payment_due_rule: { month_offset: 1 },
    });
    pharmacyContractVersionFindFirstMock.mockResolvedValue({
      id: 'contract_version_1',
      fee_rules: [
        {
          id: 'fee_rule_1',
          billing_model: 'fixed_per_visit',
          unit_price: 5500,
          tax_category: 'taxable',
        },
      ],
    });
    pharmacyVisitRequestCreateMock.mockResolvedValue({
      id: 'visit_request_1',
      share_case_id: 'share_case_1',
      partnership_id: 'partnership_1',
      partner_pharmacy_id: 'partner_pharmacy_1',
      status: 'requested',
      urgency: 'urgent',
      visit_type: 'emergency',
      desired_start_at: new Date('2026-06-20T01:00:00.000Z'),
      desired_end_at: new Date('2026-06-20T02:00:00.000Z'),
      estimated_amount: 5500,
      partner_pharmacy: { id: 'partner_pharmacy_1', name: '協力薬局', status: 'active' },
      partnership: { id: 'partnership_1', base_site: { id: 'site_1', name: '基幹薬局' } },
    });
    createAuditLogEntryMock.mockResolvedValue({ id: 'audit_1' });
    withOrgContextMock.mockImplementation(async (_orgId, callback) =>
      callback({
        patientShareCase: {
          findFirst: patientShareCaseFindFirstMock,
        },
        pharmacyContract: {
          findFirst: pharmacyContractFindFirstMock,
        },
        pharmacyContractVersion: {
          findFirst: pharmacyContractVersionFindFirstMock,
        },
        pharmacyVisitRequest: {
          create: pharmacyVisitRequestCreateMock,
        },
      }),
    );
  });

  it('creates a requested visit request with an active contract estimate and compact audit', async () => {
    const response = await POST(
      createRequest({
        share_case_id: ' share_case_1 ',
        urgency: 'urgent',
        desired_start_at: '2026-06-20T01:00:00.000Z',
        desired_end_at: '2026-06-20T02:00:00.000Z',
        visit_type: 'emergency',
        request_reason: '患者名 山田花子: 発熱と残薬確認',
        physician_instruction: '医師指示: 血圧確認',
        patient_home_notes: '玄関暗証番号 1234',
        carry_items: { medication: ['A薬'] },
      }),
    );

    expect(response.status).toBe(201);
    expect(pharmacyVisitRequestCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        org_id: 'org_1',
        share_case_id: 'share_case_1',
        partnership_id: 'partnership_1',
        partner_pharmacy_id: 'partner_pharmacy_1',
        requested_by: 'user_1',
        status: 'requested',
        urgency: 'urgent',
        contract_id: 'contract_1',
        contract_version_id: 'contract_version_1',
        estimated_amount: 5500,
      }),
      include: expect.any(Object),
    });
    expect(createAuditLogEntryMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orgId: 'org_1', userId: 'user_1' }),
      expect.objectContaining({
        action: 'pharmacy_visit_request_created',
        targetType: 'PharmacyVisitRequest',
        targetId: 'visit_request_1',
        changes: expect.objectContaining({
          request_reason_length: expect.any(Number),
          has_physician_instruction: true,
          has_patient_home_notes: true,
          estimate_status: 'estimated',
        }),
      }),
    );
    const auditText = JSON.stringify(createAuditLogEntryMock.mock.calls);
    expect(auditText).not.toContain('山田花子');
    expect(auditText).not.toContain('血圧確認');
    expect(auditText).not.toContain('1234');
    const responseText = JSON.stringify(await response.json());
    expect(responseText).toContain('has_request_reason');
    expect(responseText).not.toContain('山田花子');
    expect(responseText).not.toContain('血圧確認');
    expect(responseText).not.toContain('1234');
  });

  it('rejects inactive share cases before create or audit side effects', async () => {
    patientShareCaseFindFirstMock.mockResolvedValue({
      id: 'share_case_1',
      status: 'pending_partner',
      starts_at: null,
      ends_at: null,
      partnership_id: 'partnership_1',
      partnership: {
        status: 'active',
        effective_from: null,
        effective_to: null,
        partner_pharmacy_id: 'partner_pharmacy_1',
        partner_pharmacy: { status: 'active' },
      },
    });

    const response = await POST(
      createRequest({
        share_case_id: 'share_case_1',
        request_reason: '訪問依頼',
      }),
    );

    expect(response.status).toBe(409);
    expect(pharmacyVisitRequestCreateMock).not.toHaveBeenCalled();
    expect(createAuditLogEntryMock).not.toHaveBeenCalled();
  });
});
