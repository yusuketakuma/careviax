import { describe, expect, it } from 'vitest';
import {
  ActionCode,
  ButtonState,
  CapacityScope,
  CapacityStatus,
  CardType,
  type ClaimCandidateMutationResponse,
  type ClaimCandidateSearchResponse,
  type FeeRuleSearchResponse,
  CurrentStep,
  DisplayStatus,
  HandoffStatus,
  HandoffUrgency,
  ReportDeliveryStatus,
  RejectReason,
  UserRole,
  VisitArrivalOutcome,
  VisitStatus,
  VisitStep,
} from './phos_contracts';
import { PhosActionLabel, PhosDisabledReason, PhosRejectReasonLabel } from './phos_copy.ja';
import { ACTION_KIND_BY_CODE } from '@/phos/domain/actions/actionTransitionMatrix';

describe('PH-OS canonical contracts', () => {
  it('contains required core enum values', () => {
    expect(UserRole.PHARMACIST).toBe('PHARMACIST');
    expect(UserRole.PHARMACY_CLERK).toBe('PHARMACY_CLERK');
    expect(CardType.PRESCRIPTION).toBe('PRESCRIPTION');
    expect(CurrentStep.VISIT_IN_PROGRESS).toBe('VISIT_IN_PROGRESS');
    expect(ButtonState.RESOLVABLE_BLOCK).toBe('RESOLVABLE_BLOCK');
    expect(VisitStep.ARRIVAL_CONFIRM).toBe('ARRIVAL_CONFIRM');
    expect(VisitArrivalOutcome.CANCELED).toBe('CANCELED');
    expect(VisitStatus.IN_PROGRESS).toBe('IN_PROGRESS');
    expect(HandoffStatus.RETURNED).toBe('RETURNED');
    expect(HandoffUrgency.URGENT).toBe('URGENT');
    expect(ReportDeliveryStatus.WAITING_REPLY).toBe('WAITING_REPLY');
    expect(CapacityScope.PHARMACY).toBe('PHARMACY');
    expect(CapacityStatus.OVER_CAPACITY).toBe('OVER_CAPACITY');
  });

  it('defines canonical claim candidate and fee rule response contracts', () => {
    const claimSearch = {
      items: [
        {
          candidate_id: 'claim_1',
          card_id: 'card_1',
          patient_name: '患者 山田太郎',
          fee_code: 'M001',
          fee_label: '在宅患者訪問薬剤管理指導料',
          billing_month: '2026-06-01',
          status: 'MISSING_EVIDENCE',
          status_label: '根拠不足',
          missing_evidence_keys: ['management_plan'],
          evidence_requirements: [
            {
              evidence_key: 'management_plan',
              label: '薬学的管理指導計画',
              required: true,
              source_kind: 'EVIDENCE_FILE',
            },
          ],
          rule_version_id: 'rv_2026',
          priority_rank: 10,
          source_refs: [{ kind: 'RULE_DOCUMENT', ref_id: 'rule_doc_1', label: '2026改定' }],
          created_at: '2026-06-09T00:00:00.000Z',
          updated_at: '2026-06-09T00:00:00.000Z',
          server_version: 1,
        },
      ],
      server_time: '2026-06-09T00:00:00.000Z',
    } satisfies ClaimCandidateSearchResponse;
    const mutation = {
      candidate: { ...claimSearch.items[0], status: 'EXCLUDED', status_label: '除外済み' },
      side_effects: [{ type: 'CLAIM_RECALCULATED', card_id: 'card_1' }],
      server_version: 2,
    } satisfies ClaimCandidateMutationResponse;
    const feeRules = {
      items: [
        {
          rule_id: 'rule_1',
          rule_version_id: 'rv_2026',
          fee_code: 'M001',
          fee_label: '在宅患者訪問薬剤管理指導料',
          tenant_scope: 'SYSTEM',
          revision_code: '2026',
          active_from: '2026-04-01',
          condition: { op: 'EXISTS', field: 'visit_record_id' },
          evidence_requirements: [],
          source_refs: [{ kind: 'RULE_DOCUMENT', ref_id: 'rule_doc_1', label: '2026改定' }],
        },
      ],
      server_time: '2026-06-09T00:00:00.000Z',
    } satisfies FeeRuleSearchResponse;

    expect(claimSearch.items[0].status).toBe('MISSING_EVIDENCE');
    expect(mutation.side_effects[0]).toEqual({ type: 'CLAIM_RECALCULATED', card_id: 'card_1' });
    expect(feeRules.items[0].tenant_scope).toBe('SYSTEM');
  });

  it('uses CANCELED and never the prohibited double-L spelling in canonical enum values', () => {
    const prohibitedCanceledSpelling = ['CANCEL', 'LED'].join('');
    const enumValues = [
      ...Object.values(UserRole),
      ...Object.values(CardType),
      ...Object.values(CurrentStep),
      ...Object.values(DisplayStatus),
      ...Object.values(ActionCode),
      ...Object.values(ButtonState),
      ...Object.values(VisitStep),
      ...Object.values(VisitArrivalOutcome),
      ...Object.values(VisitStatus),
      ...Object.values(HandoffStatus),
      ...Object.values(HandoffUrgency),
      ...Object.values(ReportDeliveryStatus),
      ...Object.values(CapacityScope),
      ...Object.values(CapacityStatus),
    ];

    expect(DisplayStatus.CANCELED).toBe('CANCELED');
    expect(enumValues).not.toContain(prohibitedCanceledSpelling);
  });

  it('classifies every ActionCode in the transition matrix', () => {
    expect(Object.keys(ACTION_KIND_BY_CODE).sort()).toEqual(Object.values(ActionCode).sort());
  });

  it('has action labels and reason labels for canonical action fixtures', () => {
    expect(PhosActionLabel[ActionCode.COMPLETE_VISIT]).toBeTruthy();
    expect(PhosActionLabel[ActionCode.CREATE_HANDOFF_TO_PHARMACIST]).toBeTruthy();
    expect(PhosDisabledReason.OFFLINE_NOT_ALLOWED).toBeTruthy();
    expect(PhosRejectReasonLabel[RejectReason.WRONG_DRUG]).toBeTruthy();
  });
});
