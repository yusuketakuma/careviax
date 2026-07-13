import { describe, expect, it } from 'vitest';
import { evaluateTaskRelatedEntityContract } from './task-related-entity';

describe('task related-entity contract', () => {
  it.each([
    ['staff_work_request_audit', 'pharmacy.staff_work_request_audit'],
    ['pharmacy.staff_work_request_audit', 'pharmacy.staff_work_request_audit'],
  ])('accepts an allowed tuple for %s', (taskType, canonicalTaskType) => {
    expect(
      evaluateTaskRelatedEntityContract({
        taskType,
        relatedEntityType: 'dispense_task',
        relatedEntityId: 'dispense_1',
      }),
    ).toEqual({ valid: true, reason: 'allowed', canonicalTaskType });
  });

  it.each([
    ['omitted', {}],
    ['null', { relatedEntityType: null, relatedEntityId: null }],
  ] as const)(
    'keeps entity-specific task types available for context-free creation when the tuple is %s',
    (_label, relatedEntity) => {
      expect(
        evaluateTaskRelatedEntityContract({
          taskType: 'staff_work_request_audit',
          ...relatedEntity,
        }),
      ).toEqual({
        valid: true,
        reason: 'not_provided',
        canonicalTaskType: 'pharmacy.staff_work_request_audit',
      });
    },
  );

  it.each([
    [{ relatedEntityType: 'dispense_task' }, 'related_entity_id'],
    [{ relatedEntityId: 'dispense_1' }, 'related_entity_type'],
  ] as const)('rejects an incomplete tuple %#', (relatedEntity, field) => {
    expect(
      evaluateTaskRelatedEntityContract({
        taskType: 'staff_work_request_audit',
        ...relatedEntity,
      }),
    ).toMatchObject({ valid: false, reason: 'incomplete_pair', field });
  });

  it.each([
    ['   ', 'dispense_1', 'blank_related_entity_type', 'related_entity_type'],
    ['dispense_task', '   ', 'blank_related_entity_id', 'related_entity_id'],
  ] as const)(
    'rejects blank tuple members %#',
    (relatedEntityType, relatedEntityId, reason, field) => {
      expect(
        evaluateTaskRelatedEntityContract({
          taskType: 'staff_work_request_audit',
          relatedEntityType,
          relatedEntityId,
        }),
      ).toMatchObject({ valid: false, reason, field });
    },
  );

  it.each(['staff_work_request_audit', 'pharmacy.staff_work_request_audit'])(
    'rejects a related entity outside the %s registry allowlist',
    (taskType) => {
      expect(
        evaluateTaskRelatedEntityContract({
          taskType,
          relatedEntityType: 'visit_schedule',
          relatedEntityId: 'visit_1',
        }),
      ).toMatchObject({
        valid: false,
        reason: 'unsupported_related_entity_type',
        field: 'related_entity_type',
      });
    },
  );

  it('fails closed for an unregistered task type', () => {
    expect(evaluateTaskRelatedEntityContract({ taskType: 'unknown_task_type' })).toEqual({
      valid: false,
      reason: 'unregistered_task_type',
      canonicalTaskType: null,
      field: 'related_entity_type',
    });
  });
});
