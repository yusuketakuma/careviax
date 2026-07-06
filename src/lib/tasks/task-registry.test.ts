import { describe, expect, it } from 'vitest';
import {
  assertRegisteredOperationalTaskType,
  describeRegisteredOperationalTask,
  getCanonicalTaskType,
  getTaskTypeDefinition,
  hasModulePrefixedTaskType,
  isLegacyTaskType,
  isRegisteredTaskType,
} from './task-registry';

describe('task-registry', () => {
  it('maps legacy task types to module-prefixed canonical definitions', () => {
    expect(isRegisteredTaskType('visit_preparation')).toBe(true);
    expect(isLegacyTaskType('visit_preparation')).toBe(true);
    expect(getCanonicalTaskType('visit_preparation')).toBe('pharmacy.visit_preparation');
    expect(getTaskTypeDefinition('visit_preparation')).toMatchObject({
      module: 'pharmacy',
      taskType: 'pharmacy.visit_preparation',
    });
  });

  it('accepts canonical module-prefixed task types', () => {
    expect(isRegisteredTaskType('core.visit_demand')).toBe(true);
    expect(isLegacyTaskType('core.visit_demand')).toBe(false);
    expect(hasModulePrefixedTaskType('core.visit_demand')).toBe(true);
    expect(getCanonicalTaskType('core.visit_demand')).toBe('core.visit_demand');
  });

  it('keeps action href generation in registered task definitions', () => {
    expect(
      describeRegisteredOperationalTask({
        task_type: 'fax_original_followup',
        related_entity_type: 'prescription_intake',
        related_entity_id: 'intake/1?x=y#frag',
      }),
    ).toMatchObject({
      actionHref: '/prescriptions/intake%2F1%3Fx%3Dy%23frag',
      actionLabel: '原本回収を記録',
      queueLabel: 'FAX原本',
    });
  });

  it('rejects unknown task types for creation gates', () => {
    expect(() => assertRegisteredOperationalTaskType('unknown_task_type')).toThrow(
      'Unregistered operational task_type: unknown_task_type',
    );
  });
});
