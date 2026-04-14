import { describe, expect, it, vi } from 'vitest';
import { resolveBillingRuntimeContext } from './billing-runtime-context';

function makeTx(
  configRow: {
    id: string;
    revision_code: string;
    effective_from: Date;
    effective_to: Date | null;
    config: Record<string, unknown> | null;
  } | null,
) {
  return {
    pharmacySiteInsuranceConfig: {
      findFirst: vi.fn().mockResolvedValue(configRow),
    },
  };
}

describe('resolveBillingRuntimeContext', () => {
  it('resolves 2026 medical home comprehensive level 2 to イ for single-building visits', async () => {
    const tx = makeTx({
      id: 'cfg_1',
      revision_code: '2026',
      effective_from: new Date('2026-06-01T00:00:00.000Z'),
      effective_to: null,
      config: { home_comprehensive_level: 'level_2' },
    });

    const context = await resolveBillingRuntimeContext(tx, {
      orgId: 'org_1',
      payerBasis: 'medical',
      asOfDate: new Date('2026-06-15T00:00:00.000Z'),
      siteId: 'site_1',
      buildingPatientCount: 1,
    });

    expect(context.effectiveRevisionCode).toBe('2026');
    expect(context.siteConfigStatus).toBe('resolved');
    expect(context.homeComprehensive).toMatchObject({
      code: 'MED_ADD_HOME_COMPREHENSIVE_2_I',
      points: 100,
      buildingTier: 'single',
    });
  });

  it('marks missing site assignment explicitly', async () => {
    const tx = makeTx(null);

    const context = await resolveBillingRuntimeContext(tx, {
      orgId: 'org_1',
      payerBasis: 'medical',
      asOfDate: new Date('2026-06-15T00:00:00.000Z'),
      siteId: null,
      buildingPatientCount: 1,
    });

    expect(context.siteConfigStatus).toBe('site_unassigned');
    expect(context.warnings[0]).toContain('薬局が未割当');
    expect(context.homeComprehensive).toBeNull();
  });

  it('warns when the effective revision and site config revision do not match', async () => {
    const tx = makeTx({
      id: 'cfg_legacy',
      revision_code: '2024',
      effective_from: new Date('2024-06-01T00:00:00.000Z'),
      effective_to: null,
      config: { home_comprehensive_level: 'level_2' },
    });

    const context = await resolveBillingRuntimeContext(tx, {
      orgId: 'org_1',
      payerBasis: 'medical',
      asOfDate: new Date('2026-06-15T00:00:00.000Z'),
      siteId: 'site_1',
      buildingPatientCount: 3,
    });

    expect(context.effectiveRevisionCode).toBe('2026');
    expect(context.siteConfigStatus).toBe('revision_mismatch');
    expect(context.homeComprehensive).toBeNull();
    expect(context.warnings[0]).toContain('一致していません');
  });
});
