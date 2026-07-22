import { readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  API_ROUTE_TEMPLATES,
  RATE_LIMIT_READ_MAX,
  canonicalizeRateLimitPath,
  checkRateLimit,
} from './rate-limit';
import { resetRateLimitTestState } from './rate-limit.test-helpers';

function collectRouteFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const fullPath = join(dir, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) return collectRouteFiles(fullPath);
    return entry === 'route.ts' ? [fullPath] : [];
  });
}

function routeFileToTemplate(filePath: string) {
  const apiDir = join(process.cwd(), 'src', 'app', 'api');
  const routePath = relative(apiDir, filePath)
    .split(sep)
    .slice(0, -1)
    .map((segment) => {
      if (/^\[\.\.\.[^\]]+\]$/.test(segment)) return ':path*';
      if (segment === '[token]') return ':token';
      if (segment === '[jobType]') return ':jobType';
      if (/^\[[^\]]+\]$/.test(segment)) return ':id';
      return segment;
    })
    .join('/');
  return `/api/${routePath}`;
}

describe('rate-limit route canonicalization', () => {
  beforeEach(resetRateLimitTestState);

  it('keeps the rate-limit route template catalog in sync with App Router API files', () => {
    const apiDir = join(process.cwd(), 'src', 'app', 'api');
    const routeTemplates = collectRouteFiles(apiDir).map(routeFileToTemplate).sort();

    expect([...API_ROUTE_TEMPLATES].sort()).toEqual(routeTemplates);
  });

  it('keeps the rate-limit route template catalog unique', () => {
    expect(new Set(API_ROUTE_TEMPLATES).size).toBe(API_ROUTE_TEMPLATES.length);
  });

  it('scopes the default limiter by canonical route as well as identifier', async () => {
    // Use POST (write budget = 60) so the limit is reached within the loop.
    for (let index = 0; index < 60; index += 1) {
      await expect(checkRateLimit('203.0.113.10', '/api/patients', 'POST')).resolves.toMatchObject({
        allowed: true,
      });
    }

    // 61st write request exceeds the write budget
    await expect(checkRateLimit('203.0.113.10', '/api/patients', 'POST')).resolves.toMatchObject({
      allowed: false,
    });
    // Different canonical route has its own independent bucket
    await expect(
      checkRateLimit('203.0.113.10', '/api/visit-schedules', 'POST'),
    ).resolves.toMatchObject({
      allowed: true,
    });
  });

  it('canonicalizes dynamic route segments while preserving static siblings', () => {
    expect(canonicalizeRateLimitPath('/api/patients/patient_1')).toBe('/api/patients/:id');
    expect(canonicalizeRateLimitPath('/api/patients/patient_2/movement-timeline')).toBe(
      '/api/patients/:id/movement-timeline',
    );
    expect(canonicalizeRateLimitPath('/api/patients/patient_2/timeline/event_1')).toBe(
      '/api/patients/:id/timeline/:id',
    );
    expect(canonicalizeRateLimitPath('/api/patients/patient_2/medication-stock')).toBe(
      '/api/patients/:id/medication-stock',
    );
    expect(canonicalizeRateLimitPath('/api/patients/patient_1/insurance/insurance_1')).toBe(
      '/api/patients/:id/insurance/:id',
    );
    expect(canonicalizeRateLimitPath('/api/visit-schedules/schedule_1/reschedule')).toBe(
      '/api/visit-schedules/:id/reschedule',
    );
    expect(
      canonicalizeRateLimitPath('/api/visit-records/visit_record_1/medication-stock-observations'),
    ).toBe('/api/visit-records/:id/medication-stock-observations');
    expect(canonicalizeRateLimitPath('/api/care-reports/report_1/print-audit')).toBe(
      '/api/care-reports/:id/print-audit',
    );
    expect(canonicalizeRateLimitPath('/api/external-access/token_1/self-report')).toBe(
      '/api/external-access/:token/self-report',
    );
    expect(canonicalizeRateLimitPath('/api/patient-share-cases/share_case_1')).toBe(
      '/api/patient-share-cases/:id',
    );
    expect(canonicalizeRateLimitPath('/api/patient-share-cases/share_case_1/activate')).toBe(
      '/api/patient-share-cases/:id/activate',
    );
    expect(canonicalizeRateLimitPath('/api/patient-share-cases/share_case_1/patient-link')).toBe(
      '/api/patient-share-cases/:id/patient-link',
    );
    expect(
      canonicalizeRateLimitPath('/api/patient-share-cases/share_case_1/correction-requests'),
    ).toBe('/api/patient-share-cases/:id/correction-requests');
    expect(canonicalizeRateLimitPath('/api/pharmacy-cooperation-message-threads')).toBe(
      '/api/pharmacy-cooperation-message-threads',
    );
    expect(canonicalizeRateLimitPath('/api/pharmacy-visit-requests/request_1/decision')).toBe(
      '/api/pharmacy-visit-requests/:id/decision',
    );
    expect(canonicalizeRateLimitPath('/api/pharmacy-contracts/contract_1/versions')).toBe(
      '/api/pharmacy-contracts/:id/versions',
    );
    expect(canonicalizeRateLimitPath('/api/pharmacy-partnerships/partnership_1/activate')).toBe(
      '/api/pharmacy-partnerships/:id/activate',
    );
    expect(canonicalizeRateLimitPath('/api/partner-visit-records/record_1/submit')).toBe(
      '/api/partner-visit-records/:id/submit',
    );
    expect(canonicalizeRateLimitPath('/api/partner-visit-records/record_1/review')).toBe(
      '/api/partner-visit-records/:id/review',
    );
    expect(
      canonicalizeRateLimitPath('/api/partner-visit-records/record_1/physician-report-draft'),
    ).toBe('/api/partner-visit-records/:id/physician-report-draft');
    expect(canonicalizeRateLimitPath('/api/admin/data-explorer/Patient/patient_1')).toBe(
      '/api/admin/data-explorer/:id/:id',
    );
    expect(canonicalizeRateLimitPath('/api/jobs/daily-medication-check')).toBe(
      '/api/jobs/:jobType',
    );
    expect(canonicalizeRateLimitPath('/api/patients/export')).toBe('/api/patients/export');
    expect(canonicalizeRateLimitPath('/api/patients/medications/bulk-export')).toBe(
      '/api/patients/medications/bulk-export',
    );
    expect(canonicalizeRateLimitPath('/api/drug-masters/batch')).toBe('/api/drug-masters/batch');
    expect(canonicalizeRateLimitPath('/api/pharmacy-drug-stocks/impact')).toBe(
      '/api/pharmacy-drug-stocks/impact',
    );
    expect(canonicalizeRateLimitPath('/api/pharmacy-drug-stocks/safety-follow-up')).toBe(
      '/api/pharmacy-drug-stocks/safety-follow-up',
    );
    expect(canonicalizeRateLimitPath('/api/pharmacy-drug-stock-templates/template_1/apply')).toBe(
      '/api/pharmacy-drug-stock-templates/:id/apply',
    );
    expect(canonicalizeRateLimitPath('/api/pharmacy-operating-hours')).toBe(
      '/api/pharmacy-operating-hours',
    );
    expect(canonicalizeRateLimitPath('/api/drug-masters/drug_1/generic-recommendations')).toBe(
      '/api/drug-masters/:id/generic-recommendations',
    );
    expect(canonicalizeRateLimitPath('/api/drug-masters/drug_1/ingredient-group')).toBe(
      '/api/drug-masters/:id/ingredient-group',
    );
  });

  it('requires at least one segment for catch-all API route templates', () => {
    expect(canonicalizeRateLimitPath('/api/auth/callback/credentials')).toBe('/api/auth/:path*');
    expect(canonicalizeRateLimitPath('/api/auth')).toBe('/api/__unknown__');
  });

  it('canonicalizes path variants and unknown API paths to bounded buckets', () => {
    expect(canonicalizeRateLimitPath('/api/patients/patient_1/?tab=overview')).toBe(
      '/api/patients/:id',
    );
    expect(canonicalizeRateLimitPath('/api//patients//patient_1')).toBe('/api/patients/:id');
    expect(canonicalizeRateLimitPath('/api/not-real-a')).toBe('/api/__unknown__');
    expect(canonicalizeRateLimitPath('/settings')).toBe('/settings');
  });

  it('uses the standalone movement timeline read bucket', async () => {
    for (let index = 0; index < RATE_LIMIT_READ_MAX; index += 1) {
      await expect(
        checkRateLimit('203.0.113.20', '/api/patients/patient_1/movement-timeline', 'GET'),
      ).resolves.toMatchObject({ allowed: true });
    }

    await expect(
      checkRateLimit('203.0.113.20', '/api/patients/patient_1/movement-timeline', 'GET'),
    ).resolves.toMatchObject({ allowed: false });
  });

  it('shares write budget across different ids for the same dynamic route', async () => {
    for (let index = 0; index < 60; index += 1) {
      await expect(
        checkRateLimit('203.0.113.10', `/api/patients/patient_${index}`, 'PATCH'),
      ).resolves.toMatchObject({
        allowed: true,
      });
    }

    await expect(
      checkRateLimit('203.0.113.10', '/api/patients/patient_final', 'PATCH'),
    ).resolves.toMatchObject({
      allowed: false,
      reason: 'quota_exceeded',
    });

    await expect(
      checkRateLimit('203.0.113.10', '/api/patients/export', 'POST'),
    ).resolves.toMatchObject({
      allowed: true,
    });
  });

  it('shares write budget across nested dynamic route ids', async () => {
    for (let index = 0; index < 60; index += 1) {
      await expect(
        checkRateLimit(
          '203.0.113.10',
          `/api/patients/patient_1/insurance/insurance_${index}`,
          'PATCH',
        ),
      ).resolves.toMatchObject({
        allowed: true,
      });
    }

    await expect(
      checkRateLimit('203.0.113.10', '/api/patients/patient_1/insurance/insurance_final', 'PATCH'),
    ).resolves.toMatchObject({
      allowed: false,
      reason: 'quota_exceeded',
    });
  });

  it('canonicalizes patient home operations separately from unknown API paths', async () => {
    for (let index = 0; index < 300; index += 1) {
      await expect(
        checkRateLimit('203.0.113.10', `/api/not-real-${index}`, 'GET'),
      ).resolves.toMatchObject({
        allowed: true,
      });
    }

    await expect(
      checkRateLimit('203.0.113.10', '/api/patients/patient_1/home-operations', 'GET'),
    ).resolves.toMatchObject({
      allowed: true,
    });
  });

  it('shares read budget across unknown API paths to prevent scan key churn', async () => {
    for (let index = 0; index < 300; index += 1) {
      await expect(
        checkRateLimit('203.0.113.10', `/api/not-real-${index}`, 'GET'),
      ).resolves.toMatchObject({
        allowed: true,
      });
    }

    await expect(
      checkRateLimit('203.0.113.10', '/api/another-not-real-path', 'GET'),
    ).resolves.toMatchObject({
      allowed: false,
      reason: 'quota_exceeded',
    });
  });
});
