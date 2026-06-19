import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { requireAuthContextMock } = vi.hoisted(() => ({
  requireAuthContextMock: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  requireAuthContext: requireAuthContextMock,
}));

import { GET } from './route';

function createRequest() {
  return new NextRequest('http://localhost/api/meta/route-catalog', {
    headers: {
      'x-org-id': 'org_1',
    },
  });
}

describe('/api/meta/route-catalog GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthContextMock.mockResolvedValue({
      ctx: {
        userId: 'user_1',
        orgId: 'org_1',
        role: 'admin',
      },
    });
  });

  it('returns the route catalog for admins', async () => {
    const request = createRequest();
    const response = await GET(request);
    expect(response).toBeDefined();
    if (!response) {
      throw new Error('Expected a response from route catalog GET');
    }

    expect(response.status).toBe(200);
    expect(requireAuthContextMock).toHaveBeenCalledWith(request, {
      permission: 'canAdmin',
      message: 'APIカタログの閲覧権限がありません',
    });
    await expect(response.json()).resolves.toMatchObject({
      meta: {
        scope: 'curated_operational_routes',
        exhaustive: false,
      },
      data: expect.arrayContaining([
        expect.objectContaining({
          path: '/api/patients',
        }),
        expect.objectContaining({
          path: '/api/patients/:id/prescriptions/export',
          methods: ['GET'],
          permission: 'canVisit',
          area: 'prescriptions',
        }),
        expect.objectContaining({
          path: '/api/patient-share-cases',
          methods: ['GET'],
          permission: 'canVisit',
          area: 'patients',
        }),
        expect.objectContaining({
          path: '/api/patient-share-cases',
          methods: ['POST'],
          permission: 'canManagePatientSharing',
          area: 'patients',
        }),
        expect.objectContaining({
          path: '/api/patient-share-cases/:id/activate',
          methods: ['POST'],
          permission: 'canManagePatientSharing',
          area: 'patients',
        }),
        expect.objectContaining({
          path: '/api/patient-share-cases/:id/consents',
          methods: ['GET'],
          permission: 'canVisit',
          area: 'patients',
        }),
        expect.objectContaining({
          path: '/api/patient-share-cases/:id/consents',
          methods: ['POST'],
          permission: 'canManagePatientSharing',
          area: 'patients',
        }),
        expect.objectContaining({
          path: '/api/patient-share-cases/:id/consents/:id/revoke',
          methods: ['POST'],
          permission: 'canManagePatientSharing',
          area: 'patients',
        }),
        expect.objectContaining({
          path: '/api/patient-share-cases/:id/patient-link',
          methods: ['PATCH'],
          permission: 'canManagePatientSharing',
          area: 'patients',
        }),
        expect.objectContaining({
          path: '/api/patient-share-cases/:id/correction-requests',
          methods: ['GET'],
          permission: 'canVisit',
          area: 'patients',
        }),
        expect.objectContaining({
          path: '/api/patient-share-cases/:id/correction-requests',
          methods: ['POST'],
          permission: 'canManagePatientSharing',
          area: 'patients',
        }),
        expect.objectContaining({
          path: '/api/pharmacy-visit-requests',
          methods: ['GET'],
          permission: 'canManagePatientSharing',
          area: 'visits',
        }),
        expect.objectContaining({
          path: '/api/pharmacy-visit-requests',
          methods: ['POST'],
          permission: 'canManagePatientSharing',
          area: 'visits',
        }),
        expect.objectContaining({
          path: '/api/pharmacy-visit-requests/:id/decision',
          methods: ['POST'],
          permission: 'canManagePatientSharing',
          area: 'visits',
        }),
        expect.objectContaining({
          path: '/api/partner-visit-records',
          methods: ['GET'],
          permission: 'canManagePatientSharing',
          area: 'visits',
        }),
        expect.objectContaining({
          path: '/api/partner-visit-records',
          methods: ['POST'],
          permission: 'canManagePatientSharing',
          area: 'visits',
        }),
        expect.objectContaining({
          path: '/api/partner-visit-records/:id/submit',
          methods: ['POST'],
          permission: 'canManagePatientSharing',
          area: 'visits',
        }),
        expect.objectContaining({
          path: '/api/partner-visit-records/:id/review',
          methods: ['POST'],
          permission: 'canManagePatientSharing',
          area: 'visits',
        }),
        expect.objectContaining({
          path: '/api/partner-visit-records/:id/physician-report-draft',
          methods: ['POST'],
          permission: 'canAuthorReport',
          area: 'reports',
        }),
        expect.objectContaining({
          path: '/api/jobs',
        }),
        expect.objectContaining({
          path: '/api/files/presigned-upload',
        }),
        expect.objectContaining({
          path: '/api/care-reports/:id/pdf',
          methods: ['GET'],
          permission: 'canSendCareReport',
          area: 'reports',
        }),
        expect.objectContaining({
          path: '/api/care-reports/:id/print-audit',
          methods: ['POST'],
          permission: 'canSendCareReport',
          area: 'reports',
        }),
        expect.objectContaining({
          path: '/api/care-reports/analytics',
          methods: ['GET'],
          permission: 'canSendCareReport',
          area: 'reports',
        }),
        expect.objectContaining({
          path: '/api/care-reports/reminders',
          methods: ['POST'],
          permission: 'canSendCareReport',
          area: 'reports',
        }),
        expect.objectContaining({
          path: '/api/care-reports/:id',
          methods: ['GET', 'PATCH'],
          permission: 'purpose-based',
          area: 'reports',
        }),
        expect.objectContaining({
          path: '/api/care-reports/generate-from-visit',
          methods: ['POST'],
          permission: 'canAuthorReport',
          area: 'reports',
        }),
        expect.objectContaining({
          path: '/api/care-reports/today-workspace',
          methods: ['GET'],
          permission: 'canReport',
          area: 'reports',
        }),
        expect.objectContaining({
          path: '/api/external-access',
          methods: ['GET', 'POST'],
          permission: 'canReport',
          area: 'reports',
        }),
        expect.objectContaining({
          path: '/api/external-access/:token',
          methods: ['GET'],
          permission: 'public',
          area: 'reports',
        }),
        expect.objectContaining({
          path: '/api/external-access/:token/self-report',
          methods: ['POST'],
          permission: 'public',
          area: 'reports',
        }),
        expect.objectContaining({
          path: '/api/communication-requests',
          methods: ['GET', 'POST'],
          permission: 'canReport',
          area: 'reports',
        }),
        expect.objectContaining({
          path: '/api/communication-requests/:id',
          methods: ['GET', 'PATCH'],
          permission: 'canReport',
          area: 'reports',
        }),
        expect.objectContaining({
          path: '/api/communication-requests/export',
          methods: ['GET'],
          permission: 'canReport',
          area: 'reports',
        }),
        expect.objectContaining({
          path: '/api/communication-requests/:id/responses',
          methods: ['GET', 'POST'],
          permission: 'canReport',
          area: 'reports',
        }),
        expect.objectContaining({
          path: '/api/communication-requests/:id/resolve-followup',
          methods: ['POST'],
          permission: 'canReport',
          area: 'reports',
        }),
        expect.objectContaining({
          path: '/api/billing-candidates/export',
          methods: ['GET'],
          permission: 'canManageBilling',
          area: 'billing',
        }),
        expect.objectContaining({
          path: '/api/visit-billing-candidates',
          methods: ['GET', 'POST'],
          permission: 'canManageBilling',
          area: 'billing',
        }),
        expect.objectContaining({
          path: '/api/visit-billing-candidates/summary',
          methods: ['GET'],
          permission: 'canManageBilling',
          area: 'billing',
        }),
        expect.objectContaining({
          path: '/api/pharmacy-invoices',
          methods: ['GET', 'POST'],
          permission: 'canManageBilling',
          area: 'billing',
        }),
        expect.objectContaining({
          path: '/api/pharmacy-invoices/:id/pdf',
          methods: ['GET'],
          permission: 'canManageBilling',
          area: 'billing',
        }),
        expect.objectContaining({
          path: '/api/pharmacy-contracts',
          methods: ['GET'],
          permission: 'canVisit',
          area: 'masters',
        }),
        expect.objectContaining({
          path: '/api/pharmacy-contracts',
          methods: ['POST'],
          permission: 'canManagePatientSharing',
          area: 'masters',
        }),
        expect.objectContaining({
          path: '/api/pharmacy-contracts/:id/versions',
          methods: ['POST'],
          permission: 'canManagePatientSharing',
          area: 'masters',
        }),
        expect.objectContaining({
          path: '/api/audit-logs/export',
          methods: ['GET'],
          permission: 'canAdmin',
          area: 'auditing',
        }),
        expect.objectContaining({
          path: '/api/drug-master-imports/status',
          methods: ['GET'],
          permission: 'canAdmin',
          area: 'masters',
        }),
        expect.objectContaining({
          path: '/api/drug-master-import-logs',
          methods: ['GET'],
          permission: 'canAdmin',
          area: 'masters',
        }),
        expect.objectContaining({
          path: '/api/pharmacy-drug-stocks/export',
          methods: ['GET'],
          permission: 'canAdmin',
          area: 'masters',
        }),
        expect.objectContaining({
          path: '/api/pharmacy-drug-stocks/template',
          methods: ['GET'],
          permission: 'canAdmin',
          area: 'masters',
        }),
        expect.objectContaining({
          path: '/api/partner-pharmacies',
          methods: ['GET'],
          permission: 'canVisit',
          area: 'masters',
        }),
        expect.objectContaining({
          path: '/api/partner-pharmacies',
          methods: ['POST'],
          permission: 'canManagePatientSharing',
          area: 'masters',
        }),
        expect.objectContaining({
          path: '/api/pharmacy-partnerships',
          methods: ['GET'],
          permission: 'canVisit',
          area: 'masters',
        }),
        expect.objectContaining({
          path: '/api/pharmacy-partnerships',
          methods: ['POST'],
          permission: 'canManagePatientSharing',
          area: 'masters',
        }),
        expect.objectContaining({
          path: '/api/pharmacy-partnerships/:id/activate',
          methods: ['POST'],
          permission: 'canManagePatientSharing',
          area: 'masters',
        }),
      ]),
    });
  });

  it('returns the admin gate response when the caller cannot view the route catalog', async () => {
    requireAuthContextMock.mockResolvedValueOnce({
      response: new Response(JSON.stringify({ code: 'AUTH_FORBIDDEN' }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      }),
    });

    const response = await GET(createRequest());

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: 'AUTH_FORBIDDEN' });
  });
});
