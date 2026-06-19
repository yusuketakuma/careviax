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

  it('keeps high-risk catalog entries aligned with concrete route templates', () => {
    const templatePaths = new Set(API_ROUTE_TEMPLATES);
    const catalogPaths = new Set(routeCatalog.map((entry) => entry.path));

    for (const path of [
      '/api/audit-logs/export',
      '/api/billing-candidates/export',
      '/api/visit-billing-candidates',
      '/api/visit-billing-candidates/summary',
      '/api/pharmacy-invoices',
      '/api/pharmacy-invoices/:id/pdf',
      '/api/care-reports/:id',
      '/api/care-reports/:id/pdf',
      '/api/care-reports/:id/print-audit',
      '/api/communication-requests/export',
      '/api/external-access',
      '/api/external-access/:token',
      '/api/external-access/:token/self-report',
      '/api/partner-pharmacies',
      '/api/patient-share-cases',
      '/api/patient-share-cases/:id/activate',
      '/api/patient-share-cases/:id/consents',
      '/api/patient-share-cases/:id/consents/:id/revoke',
      '/api/patient-share-cases/:id/correction-requests',
      '/api/patient-share-cases/:id/patient-link',
      '/api/patients/:id/prescriptions/export',
      '/api/partner-visit-records',
      '/api/partner-visit-records/:id/physician-report-draft',
      '/api/partner-visit-records/:id/review',
      '/api/partner-visit-records/:id/submit',
      '/api/pharmacy-contracts',
      '/api/pharmacy-contracts/:id/versions',
      '/api/pharmacy-partnerships',
      '/api/pharmacy-partnerships/:id/activate',
      '/api/pharmacy-visit-requests',
      '/api/pharmacy-visit-requests/:id/decision',
      '/api/pharmacy-drug-stocks/export',
      '/api/pharmacy-drug-stocks/template',
    ] as const) {
      expect(catalogPaths.has(path)).toBe(true);
      expect(templatePaths.has(path)).toBe(true);
    }
  });
});
