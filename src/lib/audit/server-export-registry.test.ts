import { describe, expect, it } from 'vitest';
import {
  buildApprovedServerExportDescriptor,
  getApprovedServerExportDescriptorProblem,
} from './server-export-registry';

describe('server export registry', () => {
  it('builds an approved descriptor for a registered export surface', () => {
    const descriptor = buildApprovedServerExportDescriptor(
      'communication_requests_external_csv',
      '/api/communication-requests/export?profile=external',
    );

    expect(descriptor).toMatchObject({
      surfaceId: 'communication_requests_external_csv',
      endpoint: '/api/communication-requests/export?profile=external',
      auditEvent: 'communication_requests_export',
      maskingProfile: 'communication_requests_external_redacted_csv',
    });
    expect(getApprovedServerExportDescriptorProblem(descriptor)).toBeUndefined();
  });

  it('rejects endpoint paths outside the registered surface prefix', () => {
    const descriptor = buildApprovedServerExportDescriptor(
      'communication_requests_external_csv',
      '/api/billing-candidates/export?format=csv',
    );

    expect(getApprovedServerExportDescriptorProblem(descriptor)).toBe(
      '全件出力のURLが承認済み surface と一致しません',
    );
  });

  it('rejects descriptors whose audit or masking metadata has been altered', () => {
    const descriptor = {
      ...buildApprovedServerExportDescriptor(
        'communication_requests_external_csv',
        '/api/communication-requests/export?profile=external',
      ),
      maskingProfile: 'unsafe_raw_profile',
    };

    expect(getApprovedServerExportDescriptorProblem(descriptor)).toBe(
      '全件出力の監査・マスキング情報が承認済み surface と一致しません',
    );
  });

  it('builds approved descriptors for pharmacy drug stock CSV export purposes', () => {
    const operationsDescriptor = buildApprovedServerExportDescriptor(
      'pharmacy_drug_stocks_operations_csv',
      '/api/pharmacy-drug-stocks/export?site_id=site-1&purpose=operations',
    );
    const pharmacistReviewDescriptor = buildApprovedServerExportDescriptor(
      'pharmacy_drug_stocks_pharmacist_review_csv',
      '/api/pharmacy-drug-stocks/export?site_id=site-1&purpose=pharmacist_review',
    );

    expect(operationsDescriptor).toMatchObject({
      auditEvent: 'pharmacy_drug_stocks_export',
      maskingProfile: 'pharmacy_drug_stocks_operations_csv',
    });
    expect(pharmacistReviewDescriptor).toMatchObject({
      auditEvent: 'pharmacy_drug_stocks_export',
      maskingProfile: 'pharmacy_drug_stocks_pharmacist_review_csv',
    });
    expect(getApprovedServerExportDescriptorProblem(operationsDescriptor)).toBeUndefined();
    expect(getApprovedServerExportDescriptorProblem(pharmacistReviewDescriptor)).toBeUndefined();
  });
});
