import { describe, expect, it } from 'vitest';
import {
  ActionCode,
  ButtonState,
  CapacityScope,
  CapacityStatus,
  CardType,
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
