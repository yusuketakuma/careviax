import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureHomeCareBillingSsot, type HomeCareBillingSsotTx } from './seeder';

const sourceOfTruthMatrixUpsertMock = vi.fn();
const billingRuleUpsertMock = vi.fn();
const billingRuleDeleteManyMock = vi.fn();

function makeTx(): HomeCareBillingSsotTx {
  return {
    sourceOfTruthMatrix: {
      upsert: sourceOfTruthMatrixUpsertMock,
    },
    billingRule: {
      upsert: billingRuleUpsertMock,
      deleteMany: billingRuleDeleteManyMock,
    },
  };
}

describe('ensureHomeCareBillingSsot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sourceOfTruthMatrixUpsertMock.mockResolvedValue({});
    billingRuleUpsertMock.mockResolvedValue({});
    billingRuleDeleteManyMock.mockResolvedValue({ count: 0 });
  });

  it('upserts billing rules with normalized JSON payloads', async () => {
    await ensureHomeCareBillingSsot(
      makeTx(),
      'org_1',
      [
        {
          revision: {
            code: '2026',
            label: '令和8年度改定',
            effectiveFrom: new Date('2026-06-01T00:00:00.000Z'),
            effectiveTo: null,
            source: 'https://example.com/source',
            status: 'confirmed',
          },
          rules: [
            {
              ssot_key: 'medical:test',
              rule_type: 'addition',
              service_type: 'medical_home_visit',
              payer_basis: 'medical',
              provider_scope: 'pharmacy',
              selection_mode: 'auto',
              calculation_unit: 'point',
              display_order: 10,
              name: 'テスト加算',
              code: 'TEST_ADD',
              amount: 100,
              conditions: { building_tier: 'single' },
              evidence_requirements: { requires_visit_documentation: true },
              source_url: 'https://example.com/source',
              source_note: 'official',
            },
          ],
        },
      ],
    );

    expect(billingRuleUpsertMock).toHaveBeenCalledWith({
      where: {
        org_id_ssot_key: {
          org_id: 'org_1',
          ssot_key: 'medical:test',
        },
      },
      create: expect.objectContaining({
        org_id: 'org_1',
        ssot_key: 'medical:test',
        conditions: { building_tier: 'single' },
        evidence_requirements: { requires_visit_documentation: true },
        is_system: true,
        is_active: true,
      }),
      update: expect.objectContaining({
        conditions: { building_tier: 'single' },
        evidence_requirements: { requires_visit_documentation: true },
        is_system: true,
      }),
    });
  });
});
