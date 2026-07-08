import { describe, expect, it } from 'vitest';
import { normalizeProposalGenerationDiagnostics } from './diagnostics';

describe('normalizeProposalGenerationDiagnostics', () => {
  it('keeps sanitized medication stock review candidate diagnostics and drops raw stock fields', () => {
    const result = normalizeProposalGenerationDiagnostics(
      {
        review_candidates: [
          {
            code: 'review_required_candidate',
            reason_code: 'medication_stock_shortage_risk',
            pharmacist_id: 'pharmacist_1',
            site_id: 'site_1',
            proposed_date: '2026-03-28',
            stock_risk_levels: ['urgent', 'shortage_expected', 'unknown', 'urgent'],
            affected_snapshot_count: 2,
            nearest_stockout_date: '2026-03-29',
            minimum_days_until_stockout: 0,
            stock_item_id: 'stock_item_secret',
            current_quantity: '999',
            unit: 'tablet',
            risk_reason_code: 'raw_reason_secret',
            idempotency_hash: 'hash_secret',
            request_fingerprint: 'fingerprint_secret',
            drug_name: 'アムロジピン',
          },
        ],
      },
      { mode: 'response' },
    );

    expect(result.review_candidates).toEqual([
      {
        code: 'review_required_candidate',
        reason_code: 'medication_stock_shortage_risk',
        pharmacist_id: 'pharmacist_1',
        site_id: 'site_1',
        proposed_date: '2026-03-28',
        stock_risk_levels: ['urgent', 'shortage_expected'],
        affected_snapshot_count: 2,
        nearest_stockout_date: '2026-03-29',
        minimum_days_until_stockout: 0,
      },
    ]);
    expect(JSON.stringify(result)).not.toContain('stock_item_secret');
    expect(JSON.stringify(result)).not.toContain('999');
    expect(JSON.stringify(result)).not.toContain('tablet');
    expect(JSON.stringify(result)).not.toContain('raw_reason_secret');
    expect(JSON.stringify(result)).not.toContain('hash_secret');
    expect(JSON.stringify(result)).not.toContain('fingerprint_secret');
    expect(JSON.stringify(result)).not.toContain('アムロジピン');
  });

  it('rejects malformed medication stock review candidate diagnostics', () => {
    const result = normalizeProposalGenerationDiagnostics(
      {
        review_candidates: [
          {
            code: 'review_required_candidate',
            reason_code: 'medication_stock_shortage_risk',
            site_id: 'site_1',
            proposed_date: '2026-03-28',
            stock_risk_levels: ['urgent'],
            affected_snapshot_count: 101,
          },
          {
            code: 'review_required_candidate',
            reason_code: 'medication_stock_shortage_risk',
            site_id: 'site_1',
            proposed_date: '2026-03-28',
            stock_risk_levels: ['unknown'],
            affected_snapshot_count: 1,
          },
          {
            code: 'review_required_candidate',
            reason_code: 'medication_stock_shortage_risk',
            site_id: 'site_1',
            proposed_date: '2026/03/28',
            stock_risk_levels: ['urgent'],
            affected_snapshot_count: 1,
          },
        ],
      },
      { mode: 'audit' },
    );

    expect(result.review_candidates).toEqual([]);
  });
});
