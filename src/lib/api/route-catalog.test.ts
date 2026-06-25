import { describe, expect, it } from 'vitest';
import { API_ROUTE_TEMPLATES } from './rate-limit';
import { routeCatalog } from './route-catalog';

describe('routeCatalog', () => {
  it('keeps path and method entries unique', () => {
    const keys = routeCatalog.flatMap((entry) =>
      entry.methods.map((method) => `${method.toUpperCase()} ${entry.path}`),
    );

    expect(new Set(keys).size).toBe(keys.length);
  });

  it('keeps entries operationally useful', () => {
    for (const entry of routeCatalog) {
      expect(entry.path).toMatch(/^\/api\//);
      expect(entry.methods.length).toBeGreaterThan(0);
      expect(entry.methods.every((method) => /^[A-Z]+$/.test(method))).toBe(true);
      expect(entry.description.trim().length).toBeGreaterThan(0);
    }
  });

  it('includes the catalog route itself', () => {
    expect(routeCatalog).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: '/api/meta/route-catalog',
          methods: ['GET'],
          permission: 'canAdmin',
          area: 'system',
        }),
      ]),
    );
  });

  it('documents high-risk communication, medication, and visit routes with exact runtime methods', () => {
    expect(routeCatalog).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: '/api/communication-events',
          methods: ['GET', 'POST'],
          permission: 'canReport',
          area: 'reports',
        }),
        expect.objectContaining({
          path: '/api/medication-issues',
          methods: ['GET', 'POST'],
          permission: 'canVisit',
          area: 'prescriptions',
        }),
        expect.objectContaining({
          path: '/api/medication-issues/:id',
          methods: ['PATCH'],
          permission: 'canVisit',
          area: 'prescriptions',
        }),
        expect.objectContaining({
          path: '/api/medication-profiles',
          methods: ['GET', 'POST'],
          permission: 'canVisit',
          area: 'prescriptions',
        }),
        expect.objectContaining({
          path: '/api/residual-medications',
          methods: ['GET', 'POST'],
          permission: 'canVisit',
          area: 'visits',
        }),
        expect.objectContaining({
          path: '/api/visit-records/:id/handoff',
          methods: ['GET', 'PUT'],
          permission: 'canVisit',
          area: 'visits',
        }),
        expect.objectContaining({
          path: '/api/visit-records/:id/reflected-fields',
          methods: ['GET'],
          permission: 'canVisit',
          area: 'visits',
        }),
      ]),
    );
  });

  it('keeps high-risk catalog entries aligned with concrete route templates', () => {
    const templatePaths = new Set(API_ROUTE_TEMPLATES);
    const catalogPaths = new Set(routeCatalog.map((entry) => entry.path));

    for (const path of [
      '/api/audit-logs/export',
      '/api/billing-candidates/export',
      '/api/visit-billing-candidates',
      '/api/visit-billing-candidates/summary',
      '/api/pharmacy-invoices',
      '/api/pharmacy-invoices/:id',
      '/api/pharmacy-invoices/:id/pdf',
      '/api/care-reports/:id',
      '/api/care-reports/:id/pdf',
      '/api/care-reports/:id/print-audit',
      '/api/communication-requests/export',
      '/api/external-access',
      '/api/external-access/:token',
      '/api/external-access/:token/self-report',
      '/api/patient-self-reports',
      '/api/patient-self-reports/:id',
      '/api/communication-events',
      '/api/partner-pharmacies',
      '/api/patient-share-cases',
      '/api/patient-share-cases/:id',
      '/api/patient-share-cases/:id/activate',
      '/api/patient-share-cases/:id/consents',
      '/api/patient-share-cases/:id/consents/:id/revoke',
      '/api/patient-share-cases/:id/correction-requests',
      '/api/patient-share-cases/:id/patient-link',
      '/api/pharmacy-cooperation-message-threads',
      '/api/patients/check-duplicate',
      '/api/patients/:id/prescriptions',
      '/api/patients/:id/prescriptions/export',
      '/api/interventions',
      '/api/residual-medications',
      '/api/visit-schedule-proposals',
      '/api/visit-records/:id/handoff',
      '/api/visit-records/:id/reflected-fields',
      '/api/medication-issues',
      '/api/medication-issues/:id',
      '/api/medication-profiles',
      '/api/referrals',
      '/api/partner-visit-records',
      '/api/partner-visit-records/:id/physician-report-draft',
      '/api/partner-visit-records/:id/review',
      '/api/partner-visit-records/:id/submit',
      '/api/pharmacy-contracts',
      '/api/pharmacy-contracts/:id/documents',
      '/api/pharmacy-contracts/:id/versions',
      '/api/pharmacy-partnerships',
      '/api/pharmacy-partnerships/:id/activate',
      '/api/pharmacy-visit-requests',
      '/api/pharmacy-visit-requests/:id/decision',
      '/api/pharmacy-drug-stocks/export',
      '/api/pharmacy-drug-stocks/template',
      '/api/tasks',
      '/api/tasks/:id',
      '/api/tasks/bulk',
    ] as const) {
      expect(catalogPaths.has(path)).toBe(true);
      expect(templatePaths.has(path)).toBe(true);
    }
  });
});
