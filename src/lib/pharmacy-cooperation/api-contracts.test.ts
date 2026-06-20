import { describe, expect, it } from 'vitest';
import {
  partnerPharmacyRowSchema,
  partnerPharmacySummarySchema,
  pharmacyContractRowSchema,
  pharmacyPartnershipRowSchema,
  pharmacySiteRowSchema,
} from './api-contracts';

describe('pharmacy-cooperation api contracts', () => {
  it('validates shared partner pharmacy summaries', () => {
    expect(
      partnerPharmacySummarySchema.parse({
        id: 'partner_pharmacy_1',
        name: '協力薬局',
        status: 'active',
      }),
    ).toEqual({
      id: 'partner_pharmacy_1',
      name: '協力薬局',
      status: 'active',
    });
    expect(
      partnerPharmacySummarySchema.safeParse({
        id: 'partner_pharmacy_1',
        name: '協力薬局',
      }).success,
    ).toBe(false);
  });

  it('validates pharmacy site rows used by setup lists', () => {
    expect(
      pharmacySiteRowSchema.parse({
        id: 'site_1',
        name: '基幹薬局',
        address: null,
      }),
    ).toEqual({
      id: 'site_1',
      name: '基幹薬局',
      address: null,
    });
    expect(
      pharmacySiteRowSchema.safeParse({
        id: 'site_1',
        address: '東京都',
      }).success,
    ).toBe(false);
  });

  it('validates full partner pharmacy rows used by setup lists and creates', () => {
    expect(
      partnerPharmacyRowSchema.safeParse({
        id: 'partner_pharmacy_1',
        pharmacy_code: null,
        name: '協力薬局',
        tel: null,
        status: 'active',
        updated_at: '2026-06-19T10:30:00.000Z',
      }).success,
    ).toBe(true);
    expect(
      partnerPharmacyRowSchema.safeParse({
        id: 'partner_pharmacy_1',
        name: '協力薬局',
        status: 'active',
      }).success,
    ).toBe(false);
  });

  it('validates pharmacy partnership rows shared by setup mutations and lists', () => {
    expect(
      pharmacyPartnershipRowSchema.safeParse({
        id: 'partnership_1',
        status: 'active',
        base_site_id: 'site_1',
        partner_pharmacy_id: 'partner_pharmacy_1',
        effective_from: '2026-06-01T00:00:00.000Z',
        effective_to: null,
        base_site: { id: 'site_1', name: '基幹薬局' },
        partner_pharmacy: {
          id: 'partner_pharmacy_1',
          name: '協力薬局',
          status: 'active',
        },
      }).success,
    ).toBe(true);
    expect(
      pharmacyPartnershipRowSchema.safeParse({
        id: 'partnership_1',
        status: 'active',
        base_site_id: 'site_1',
        partner_pharmacy_id: 'partner_pharmacy_1',
        effective_from: '2026-06-01T00:00:00.000Z',
        effective_to: null,
        base_site: { id: 'site_1', name: '基幹薬局' },
        partner_pharmacy: { id: 'partner_pharmacy_1', name: '協力薬局' },
      }).success,
    ).toBe(false);
  });

  it('validates full pharmacy contract rows and strips route-only extras', () => {
    const parsed = pharmacyContractRowSchema.parse({
      id: 'contract_1',
      status: 'active',
      effective_from: '2026-06-01T00:00:00.000Z',
      effective_to: null,
      has_payment_due_rule: false,
      partnership: {
        id: 'partnership_1',
        status: 'active',
        base_site: { id: 'site_1', name: '基幹薬局' },
        partner_pharmacy: {
          id: 'partner_pharmacy_1',
          name: '協力薬局',
          status: 'active',
        },
      },
      latest_version: {
        version_no: 1,
        status: 'active',
        has_terms_snapshot: true,
        active_fee_rule: {
          billing_model: 'fixed_per_visit',
          unit_price: 5500,
          tax_category: 'tax_pending',
          has_addon_rules: false,
        },
      },
    });

    expect(parsed).toEqual({
      id: 'contract_1',
      status: 'active',
      effective_from: '2026-06-01T00:00:00.000Z',
      effective_to: null,
      partnership: {
        id: 'partnership_1',
        status: 'active',
        base_site: { id: 'site_1', name: '基幹薬局' },
        partner_pharmacy: {
          id: 'partner_pharmacy_1',
          name: '協力薬局',
          status: 'active',
        },
      },
      latest_version: {
        version_no: 1,
        status: 'active',
        active_fee_rule: {
          billing_model: 'fixed_per_visit',
          unit_price: 5500,
          tax_category: 'tax_pending',
        },
      },
    });
  });
});
