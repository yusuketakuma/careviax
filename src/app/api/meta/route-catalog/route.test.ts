import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { expectSensitiveNoStore } from '@/test/api-response-assertions';

const { requireAuthContextMock, withAuthContextMock } = vi.hoisted(() => {
  const requireAuthContextMock = vi.fn();
  const withAuthContextMock = vi.fn(
    (
      handler: (
        req: NextRequest,
        ctx: { userId: string; orgId: string; role: string },
        routeContext: { params: Promise<Record<string, string>> },
      ) => Promise<Response>,
      options: unknown,
    ) => {
      return async (
        req: NextRequest,
        routeContext: { params: Promise<Record<string, string>> },
      ) => {
        const authResult = await requireAuthContextMock(req, options);
        const response =
          authResult && typeof authResult === 'object' && 'response' in authResult
            ? authResult.response
            : await handler(req, authResult.ctx, routeContext);
        response.headers.set('Cache-Control', 'private, no-store, max-age=0');
        response.headers.set('Pragma', 'no-cache');
        return response;
      };
    },
  );

  return { requireAuthContextMock, withAuthContextMock };
});

vi.mock('@/lib/auth/context', () => ({
  withAuthContext: withAuthContextMock,
}));

import { GET } from './route';

const emptyRouteContext = { params: Promise.resolve({}) };

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
    const response = await GET(request, emptyRouteContext);
    expect(response).toBeDefined();
    if (!response) {
      throw new Error('Expected a response from route catalog GET');
    }

    expect(response.status).toBe(200);
    expectSensitiveNoStore(response);
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
          path: '/api/patients/check-duplicate',
          methods: ['GET'],
          permission: 'canViewDashboard',
          area: 'patients',
        }),
        expect.objectContaining({
          path: '/api/patients/board',
          methods: ['GET'],
          permission: 'canViewDashboard',
          description: '患者ボード一覧・対応状況集計取得',
          area: 'patients',
        }),
        expect.objectContaining({
          path: '/api/patients/:id/overview',
          methods: ['GET'],
          permission: 'canViewDashboard',
          description: '患者詳細ワークスペース概要取得',
          area: 'patients',
        }),
        expect.objectContaining({
          path: '/api/patients/:id/mcs',
          methods: ['GET'],
          permission: 'canViewDashboard',
          description: '患者MCS連携概要取得',
          area: 'patients',
        }),
        expect.objectContaining({
          path: '/api/patients/:id/mcs',
          methods: ['PATCH'],
          permission: 'canVisit',
          description: '患者MCS連携プロフィール更新',
          area: 'patients',
        }),
        expect.objectContaining({
          path: '/api/patients/:id/prescriptions',
          methods: ['GET'],
          permission: 'canViewDashboard',
          area: 'prescriptions',
        }),
        expect.objectContaining({
          path: '/api/patients/:id/prescriptions/export',
          methods: ['GET'],
          permission: 'canVisit',
          area: 'prescriptions',
        }),
        expect.objectContaining({
          path: '/api/qr-scan-drafts/:id',
          methods: ['GET'],
          permission: 'canViewDashboard',
          description: 'サニタイズ済みQRスキャン下書き詳細取得',
          area: 'prescriptions',
        }),
        expect.objectContaining({
          path: '/api/qr-scan-drafts/:id',
          methods: ['DELETE'],
          permission: 'canVisit',
          description: 'QRスキャン下書き破棄',
          area: 'prescriptions',
        }),
        expect.objectContaining({
          path: '/api/first-visit-documents',
          methods: ['GET', 'POST'],
          permission: 'canVisit',
          area: 'patients',
        }),
        expect.objectContaining({
          path: '/api/visit-schedules/day-board',
          methods: ['GET'],
          permission: 'canVisit',
          description: '日次訪問予定ボード取得',
          area: 'schedules',
        }),
        expect.objectContaining({
          path: '/api/visit-schedule-proposals',
          methods: ['GET', 'POST', 'PUT'],
          permission: 'canVisit',
          area: 'schedules',
        }),
        expect.objectContaining({
          path: '/api/visits/today-preparation',
          methods: ['GET'],
          permission: 'canVisit',
          description: '本日の訪問準備ボード取得',
          area: 'visits',
        }),
        expect.objectContaining({
          path: '/api/visit-records',
          methods: ['GET', 'POST'],
          permission: 'canVisit',
          area: 'visits',
        }),
        expect.objectContaining({
          path: '/api/visit-records/:id',
          methods: ['GET'],
          permission: 'canViewDashboard',
          area: 'visits',
        }),
        expect.objectContaining({
          path: '/api/visit-records/:id',
          methods: ['PATCH'],
          permission: 'canVisit',
          area: 'visits',
        }),
        expect.objectContaining({
          path: '/api/medication-cycles',
          methods: ['GET', 'POST'],
          permission: 'canDispense',
          area: 'prescriptions',
        }),
        expect.objectContaining({
          path: '/api/dispense-tasks',
          methods: ['GET'],
          permission: 'purpose-based',
          area: 'dispensing',
        }),
        expect.objectContaining({
          path: '/api/dispense-tasks',
          methods: ['POST'],
          permission: 'canDispense',
          area: 'dispensing',
        }),
        expect.objectContaining({
          path: '/api/dispense-tasks/:id/workbench',
          methods: ['GET'],
          permission: 'purpose-based',
          description: '調剤・鑑査ワークベンチ詳細取得',
          area: 'dispensing',
        }),
        expect.objectContaining({
          path: '/api/dispense-tasks/:id/workbench',
          methods: ['POST'],
          permission: 'canDispense',
          description: '調剤ワークベンチ中断登録',
          area: 'dispensing',
        }),
        expect.objectContaining({
          path: '/api/set-plans',
          methods: ['GET', 'POST'],
          permission: 'canSet',
          area: 'dispensing',
        }),
        expect.objectContaining({
          path: '/api/dashboard/dispensing-stats',
          methods: ['GET'],
          permission: 'canViewDashboard',
          area: 'dashboard',
        }),
        expect.objectContaining({
          path: '/api/dashboard/overdue',
          methods: ['GET'],
          permission: 'canViewDashboard',
          description: '期限超過の訪問・報告・タスク件数集計',
          area: 'dashboard',
        }),
        expect.objectContaining({
          path: '/api/dashboard/clerk-support',
          methods: ['GET'],
          permission: 'canViewDashboard',
          area: 'dashboard',
        }),
        expect.objectContaining({
          path: '/api/dashboard/cockpit',
          methods: ['GET'],
          permission: 'canViewDashboard',
          area: 'dashboard',
        }),
        expect.objectContaining({
          path: '/api/dashboard/workflow',
          methods: ['GET'],
          permission: 'canViewDashboard',
          area: 'dashboard',
        }),
        expect.objectContaining({
          path: '/api/dashboard/medication-deadlines',
          methods: ['GET'],
          permission: 'canViewDashboard',
          area: 'dashboard',
        }),
        expect.objectContaining({
          path: '/api/dashboard/monthly-stats',
          methods: ['GET'],
          permission: 'canViewDashboard',
          area: 'dashboard',
        }),
        expect.objectContaining({
          path: '/api/tasks',
          methods: ['GET', 'POST'],
          permission: 'canManageOperationalTasks',
          area: 'dashboard',
        }),
        expect.objectContaining({
          path: '/api/tasks/:id',
          methods: ['PATCH'],
          permission: 'canManageOperationalTasks',
          area: 'dashboard',
        }),
        expect.objectContaining({
          path: '/api/tasks/bulk',
          methods: ['POST'],
          permission: 'canManageOperationalTasks',
          area: 'dashboard',
        }),
        expect.objectContaining({
          path: '/api/staff-workload',
          methods: ['GET'],
          permission: 'canVisit',
          description: 'スタッフ別業務量ボード取得',
          area: 'dashboard',
        }),
        expect.objectContaining({
          path: '/api/management-plans',
          methods: ['GET', 'POST'],
          permission: 'canVisit',
          description: '管理計画書一覧取得・作成',
          area: 'patients',
        }),
        expect.objectContaining({
          path: '/api/management-plans/:id',
          methods: ['GET'],
          permission: 'canViewDashboard',
          description: '管理計画書詳細取得',
          area: 'patients',
        }),
        expect.objectContaining({
          path: '/api/management-plans/:id',
          methods: ['PATCH'],
          permission: 'canVisit',
          description: '管理計画書更新・承認・アーカイブ',
          area: 'patients',
        }),
        expect.objectContaining({
          path: '/api/interventions/:id',
          methods: ['GET'],
          permission: 'canViewDashboard',
          description: '介入記録詳細取得',
          area: 'visits',
        }),
        expect.objectContaining({
          path: '/api/interventions/:id',
          methods: ['PATCH'],
          permission: 'canVisit',
          description: '介入記録更新',
          area: 'visits',
        }),
        expect.objectContaining({
          path: '/api/patient-share-cases',
          methods: ['GET'],
          permission: 'canManagePatientSharing',
          area: 'patients',
        }),
        expect.objectContaining({
          path: '/api/patient-share-cases',
          methods: ['POST'],
          permission: 'canManagePatientSharing',
          area: 'patients',
        }),
        expect.objectContaining({
          path: '/api/patient-share-cases/:id',
          methods: ['PATCH'],
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
          path: '/api/pharmacy-cooperation-message-threads',
          methods: ['GET', 'POST'],
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
          path: '/api/billing-candidates',
          methods: ['GET', 'POST'],
          permission: 'canManageBilling',
          area: 'billing',
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
          path: '/api/pharmacy-invoices/:id',
          methods: ['PATCH'],
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
          path: '/api/pharmacy-contracts/:id/documents',
          methods: ['GET'],
          permission: 'canVisit',
          area: 'masters',
        }),
        expect.objectContaining({
          path: '/api/pharmacy-contracts/:id/documents',
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
          permission: 'canViewDashboard',
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
          permission: 'canViewDashboard',
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

    const response = await GET(createRequest(), emptyRouteContext);

    expect(response.status).toBe(403);
    expectSensitiveNoStore(response);
    await expect(response.json()).resolves.toMatchObject({ code: 'AUTH_FORBIDDEN' });
  });
});
