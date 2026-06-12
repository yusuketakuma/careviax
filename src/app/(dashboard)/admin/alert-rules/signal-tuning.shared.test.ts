import { describe, expect, it } from 'vitest';
import {
  buildSignalTuningState,
  diffSignalTuning,
  SIGNAL_TUNING_ITEMS,
  type SignalTuningAlertType,
} from './signal-tuning.shared';

const RULES = [
  { id: 'rule_renal', alert_type: 'renal_dose', severity: 'critical' as const, is_active: true },
  { id: 'rule_pim', alert_type: 'pim_elderly', severity: 'critical' as const, is_active: false },
  { id: 'rule_warn', alert_type: 'interaction', severity: 'warning' as const, is_active: true },
];

function desiredFromState(overrides: Partial<Record<SignalTuningAlertType, boolean>>) {
  const state = buildSignalTuningState(RULES);
  return {
    ...(Object.fromEntries(
      SIGNAL_TUNING_ITEMS.map((item) => [item.alertType, state[item.alertType].strong]),
    ) as Record<SignalTuningAlertType, boolean>),
    ...overrides,
  };
}

describe('buildSignalTuningState', () => {
  it('treats an active critical rule as strong and ignores warning rules', () => {
    const state = buildSignalTuningState(RULES);
    expect(state.renal_dose).toEqual({ ruleId: 'rule_renal', strong: true });
    expect(state.pim_elderly).toEqual({ ruleId: 'rule_pim', strong: false });
    expect(state.interaction).toEqual({ ruleId: null, strong: false });
  });
});

describe('diffSignalTuning', () => {
  it('creates, activates, and deactivates only the changed items', () => {
    const state = buildSignalTuningState(RULES);
    const diff = diffSignalTuning(
      state,
      desiredFromState({ renal_dose: false, pim_elderly: true, interaction: true }),
    );

    expect(diff).toEqual({
      create: ['interaction'],
      activate: ['rule_pim'],
      deactivate: ['rule_renal'],
    });
  });

  it('returns an empty diff when nothing changes', () => {
    const state = buildSignalTuningState(RULES);
    expect(diffSignalTuning(state, desiredFromState({}))).toEqual({
      create: [],
      activate: [],
      deactivate: [],
    });
  });
});
