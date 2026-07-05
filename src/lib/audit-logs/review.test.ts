import { describe, expect, it } from 'vitest';
import {
  buildAuditLogRiskTierWhere,
  classifyAuditLogRedactionState,
  classifyAuditLogRisk,
  enrichAuditLogForReview,
} from './review';

describe('audit log review registry', () => {
  it('classifies exports, patient views, external shares, billing decisions, and destructive actions as high risk', () => {
    expect(
      classifyAuditLogRisk({
        action: 'export',
        target_type: 'audit_log',
      }),
    ).toMatchObject({
      risk_tier: 'high',
      risk_reasons: expect.arrayContaining(['data_output', 'audit_export']),
    });

    expect(
      classifyAuditLogRisk({
        action: 'consent_records_viewed',
        target_type: 'patient',
      }),
    ).toMatchObject({
      risk_tier: 'high',
      risk_reasons: expect.arrayContaining(['patient_data_access']),
    });

    expect(
      classifyAuditLogRisk({
        action: 'patient_share_case_activated',
        target_type: 'PatientShareCase',
      }),
    ).toMatchObject({
      risk_tier: 'high',
      risk_reasons: expect.arrayContaining(['external_share']),
    });

    expect(
      classifyAuditLogRisk({
        action: 'pharmacy_invoice_cancelled',
        target_type: 'PharmacyInvoice',
      }),
    ).toMatchObject({
      risk_tier: 'high',
      risk_reasons: expect.arrayContaining(['billing_decision', 'destructive_or_revocation']),
    });
  });

  it('keeps audit log viewing out of the actionable high-risk review queue', () => {
    expect(
      classifyAuditLogRisk({
        action: 'audit_log_viewed',
        target_type: 'audit_log',
      }),
    ).toEqual({
      risk_tier: 'standard',
      risk_label: '通常',
      risk_reasons: [],
    });

    expect(buildAuditLogRiskTierWhere('high')).not.toMatchObject({
      OR: expect.arrayContaining([
        { action: { in: expect.arrayContaining(['audit_log_viewed']) } },
      ]),
    });
  });

  it('classifies direct visit schedule updates as high-risk schedule changes', () => {
    expect(
      classifyAuditLogRisk({
        action: 'visit_schedule_updated',
        target_type: 'visit_schedule',
      }),
    ).toMatchObject({
      risk_tier: 'high',
      risk_reasons: expect.arrayContaining(['high_risk_action']),
    });
  });

  it('leaves low-impact settings updates in the standard tier', () => {
    expect(
      classifyAuditLogRisk({
        action: 'update',
        target_type: 'setting',
      }),
    ).toEqual({
      risk_tier: 'standard',
      risk_label: '通常',
      risk_reasons: [],
    });
  });

  it('does not classify patient target rows as high risk unless the action is high risk', () => {
    expect(
      classifyAuditLogRisk({
        action: 'create',
        target_type: 'patient',
      }),
    ).toMatchObject({
      risk_tier: 'standard',
    });

    expect(buildAuditLogRiskTierWhere('high')).not.toMatchObject({
      OR: expect.arrayContaining([{ target_type: expect.anything() }]),
    });
  });

  it('reports redaction state after response minimization', () => {
    expect(
      classifyAuditLogRedactionState({
        action: 'visit_schedule_proposal_rejected',
        target_type: 'VisitScheduleProposal',
        changes: { reject_reason_redacted: true },
      }),
    ).toBe('redacted');

    expect(
      classifyAuditLogRedactionState({
        action: 'file_download',
        target_type: 'file_asset',
        changes: { metadata: { file_id: 'file_1' } },
      }),
    ).toBe('minimized');

    expect(
      classifyAuditLogRedactionState({
        action: 'update',
        target_type: 'setting',
        changes: { status: 'active' },
      }),
    ).toBe('not_applicable');
  });

  it('enriches rows without changing the original business fields', () => {
    const enriched = enrichAuditLogForReview({
      id: 'audit_1',
      action: 'export',
      target_type: 'audit_log',
      changes: { filters: {}, metadata: {} },
    });

    expect(enriched).toMatchObject({
      id: 'audit_1',
      action: 'export',
      risk_tier: 'high',
      risk_label: '高リスク',
      redaction_state: 'minimized',
      review_state: 'pending',
      reviewed_at: null,
      reviewed_by: null,
    });
  });

  it('adds persisted review state when a review row is present', () => {
    const enriched = enrichAuditLogForReview(
      {
        id: 'audit_1',
        action: 'export',
        target_type: 'audit_log',
      },
      {
        audit_log_id: 'audit_1',
        review_state: 'reviewed',
        reviewed_at: new Date('2026-04-10T00:00:00.000Z'),
        reviewed_by: 'admin_1',
      },
    );

    expect(enriched).toMatchObject({
      review_state: 'reviewed',
      reviewed_at: '2026-04-10T00:00:00.000Z',
      reviewed_by: 'admin_1',
    });
  });

  it('builds a database filter for high and standard risk tiers', () => {
    expect(buildAuditLogRiskTierWhere('high')).toMatchObject({
      OR: expect.arrayContaining([
        { action: { in: expect.arrayContaining(['export', 'file_download']) } },
      ]),
    });

    expect(buildAuditLogRiskTierWhere('standard')).toMatchObject({
      NOT: expect.objectContaining({
        OR: expect.any(Array),
      }),
    });
  });
});
