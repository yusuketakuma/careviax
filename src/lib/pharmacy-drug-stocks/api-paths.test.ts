import { describe, expect, it } from 'vitest';

import {
  buildPharmacyDrugStockExportApiPath,
  buildPharmacyDrugStockRequestApiPath,
  buildPharmacyDrugStockRequestsApiPath,
  buildPharmacyDrugStockTemplateApiPath,
  buildPharmacyDrugStockTemplateApplyApiPath,
  buildPharmacyDrugStockTemplateCsvApiPath,
  buildPharmacyDrugStockTemplatesApiPath,
  buildPharmacyDrugStocksApiPath,
} from './api-paths';

describe('pharmacy drug stock API path helpers', () => {
  it('builds collection and CSV paths while preserving empty-query shape', () => {
    expect(buildPharmacyDrugStocksApiPath()).toBe('/api/pharmacy-drug-stocks');
    expect(buildPharmacyDrugStockRequestsApiPath(new URLSearchParams())).toBe(
      '/api/pharmacy-drug-stock-requests?',
    );
    expect(buildPharmacyDrugStockTemplatesApiPath(new URLSearchParams())).toBe(
      '/api/pharmacy-drug-stock-templates?',
    );

    const exportParams = new URLSearchParams({ site_id: 'site_1', purpose: 'audit' });
    expect(buildPharmacyDrugStockExportApiPath(exportParams)).toBe(
      '/api/pharmacy-drug-stocks/export?site_id=site_1&purpose=audit',
    );
    expect(buildPharmacyDrugStockTemplateCsvApiPath('site_id=site_1')).toBe(
      '/api/pharmacy-drug-stocks/template?site_id=site_1',
    );
  });

  it('encodes hostile request and template ids', () => {
    const requestId = 'request/a b?x=y#z';
    const templateId = 'template/a b?x=y#z';

    expect(buildPharmacyDrugStockRequestApiPath(requestId)).toBe(
      `/api/pharmacy-drug-stock-requests/${encodeURIComponent(requestId)}`,
    );
    expect(buildPharmacyDrugStockTemplateApiPath(templateId)).toBe(
      `/api/pharmacy-drug-stock-templates/${encodeURIComponent(templateId)}`,
    );
    expect(buildPharmacyDrugStockTemplateApplyApiPath(templateId)).toBe(
      `/api/pharmacy-drug-stock-templates/${encodeURIComponent(templateId)}/apply`,
    );
  });

  it('rejects dot segments before fetch can rewrite the route', () => {
    expect(() => buildPharmacyDrugStockRequestApiPath('.')).toThrow(RangeError);
    expect(() => buildPharmacyDrugStockTemplateApiPath('..')).toThrow(RangeError);
    expect(() => buildPharmacyDrugStockTemplateApplyApiPath('.')).toThrow(RangeError);
  });
});
