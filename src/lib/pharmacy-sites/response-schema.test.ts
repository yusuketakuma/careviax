import { describe, expect, it } from 'vitest';
import {
  buildPharmacySiteInsuranceConfigsResponseSchema,
  pharmacySiteAdminResponseSchema,
} from './response-schema';

function buildSite() {
  return {
    id: 'site_1',
    name: '本店',
    address: '東京都千代田区1-1',
    phone: null,
    fax: null,
    lat: 35.6,
    lng: 139.7,
    is_health_support_pharmacy: true,
    is_regional_support: false,
    is_specialized_pharmacy: false,
    dispensing_fee_category: null,
  };
}

function buildConfig() {
  return {
    id: 'config_1',
    org_id: 'org_1',
    site_id: 'site_1',
    insurance_type: 'medical',
    revision_code: '2026',
    revision_label: '令和8年度改定',
    effective_from: '2026-06-01',
    effective_to: null,
    config: { home_visit: true },
    created_at: '2026-01-01T00:00:00.000Z',
  };
}

describe('pharmacy site admin response schemas', () => {
  it('keeps the consumed site projection and strips coordinates', () => {
    expect(pharmacySiteAdminResponseSchema.parse({ data: [buildSite()] })).toEqual({
      data: [
        {
          id: 'site_1',
          name: '本店',
          address: '東京都千代田区1-1',
          phone: null,
          fax: null,
          is_health_support_pharmacy: true,
          is_regional_support: false,
          is_specialized_pharmacy: false,
          dispensing_fee_category: null,
        },
      ],
    });
  });

  it('keeps the consumed insurance config projection and strips persistence metadata', () => {
    expect(
      buildPharmacySiteInsuranceConfigsResponseSchema('site_1').parse({ data: [buildConfig()] }),
    ).toEqual({
      data: [
        {
          id: 'config_1',
          site_id: 'site_1',
          insurance_type: 'medical',
          revision_code: '2026',
          revision_label: '令和8年度改定',
          effective_from: '2026-06-01',
          effective_to: null,
          config: { home_visit: true },
        },
      ],
    });
  });

  it.each([
    ['legacy site root', () => [buildSite()], pharmacySiteAdminResponseSchema],
    [
      'duplicate site identity',
      () => ({ data: [buildSite(), buildSite()] }),
      pharmacySiteAdminResponseSchema,
    ],
    [
      'cross-site insurance config',
      () => ({ data: [{ ...buildConfig(), site_id: 'site_2' }] }),
      buildPharmacySiteInsuranceConfigsResponseSchema('site_1'),
    ],
    [
      'duplicate insurance revision',
      () => ({ data: [buildConfig(), { ...buildConfig(), id: 'config_2' }] }),
      buildPharmacySiteInsuranceConfigsResponseSchema('site_1'),
    ],
    [
      'invalid insurance period',
      () => ({ data: [{ ...buildConfig(), effective_to: '2026-05-31' }] }),
      buildPharmacySiteInsuranceConfigsResponseSchema('site_1'),
    ],
  ])('rejects %s', (_label, payloadFactory, schema) => {
    expect(schema.safeParse(payloadFactory()).success).toBe(false);
  });
});
