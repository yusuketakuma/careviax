import { describe, expect, it } from 'vitest';
import {
  BlockerSeverity,
  CurrentStep,
  DisplayStatus,
  UserRole,
} from '@/phos/contracts/phos_contracts';
import type { BlockerView } from '@/phos/contracts/phos_contracts';
import { resolveDisplayStatus } from './resolveDisplayStatus';

const pharmacistWarning: BlockerView = {
  blocker_code: 'PHARMACIST_REVIEW',
  severity: BlockerSeverity.WARNING,
  owner_role: UserRole.PHARMACIST,
  message_key: 'blocker.pharmacist_review',
  active: true,
};

const base = {
  canceled_at: null,
  current_step: CurrentStep.INTAKE,
  blockers: [] as BlockerView[],
  has_open_rejected_audit: false,
  has_active_in_progress_task: false,
  primary_action_authorized: false,
};

describe('resolveDisplayStatus', () => {
  it('resolves canceled_at to CANCELED', () => {
    expect(resolveDisplayStatus({ ...base, canceled_at: '2026-06-08T00:00:00.000Z' })).toBe(
      DisplayStatus.CANCELED,
    );
  });

  it('resolves CLOSED step to CLOSED', () => {
    expect(resolveDisplayStatus({ ...base, current_step: CurrentStep.CLOSED })).toBe(
      DisplayStatus.CLOSED,
    );
  });

  it('resolves active CRITICAL blockers to BLOCKED', () => {
    expect(
      resolveDisplayStatus({
        ...base,
        blockers: [{ ...pharmacistWarning, severity: BlockerSeverity.CRITICAL }],
      }),
    ).toBe(DisplayStatus.BLOCKED);
  });

  it('resolves rejected audit to REJECTED', () => {
    expect(resolveDisplayStatus({ ...base, has_open_rejected_audit: true })).toBe(
      DisplayStatus.REJECTED,
    );
  });

  it('resolves active task to IN_PROGRESS', () => {
    expect(resolveDisplayStatus({ ...base, has_active_in_progress_task: true })).toBe(
      DisplayStatus.IN_PROGRESS,
    );
  });

  it('resolves pharmacist non-blocking blocker to REVIEW_REQUIRED', () => {
    expect(resolveDisplayStatus({ ...base, blockers: [pharmacistWarning] })).toBe(
      DisplayStatus.REVIEW_REQUIRED,
    );
  });

  it('resolves executable authorized step to READY', () => {
    expect(resolveDisplayStatus({ ...base, primary_action_authorized: true })).toBe(
      DisplayStatus.READY,
    );
  });
});
