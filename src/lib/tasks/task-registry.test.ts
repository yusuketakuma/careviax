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

  it('registers medication stock task types with patient-scoped action links only', () => {
    const medicationStockTaskTypes = [
      {
        taskType: 'pharmacy.medication_stock_shortage_expected',
        defaultPriority: 'urgent',
        allowedRelatedEntityTypes: [
          'patient',
          'medication_stock_item',
          'medication_stock_event',
          'inbound_medication_stock_signal',
        ],
        actionLabel: '残数不足を確認',
        queueLabel: '残数不足見込み',
      },
      {
        taskType: 'pharmacy.medication_stock_usage_unknown',
        defaultPriority: 'high',
        allowedRelatedEntityTypes: ['patient', 'medication_stock_item'],
        actionLabel: '使用頻度を確認',
        queueLabel: '使用頻度未確認',
      },
      {
        taskType: 'pharmacy.medication_stock_equivalence_review_required',
        defaultPriority: 'high',
        allowedRelatedEntityTypes: [
          'patient',
          'medication_stock_item',
          'canonical_medication_group',
          'inbound_medication_stock_signal',
        ],
        actionLabel: '薬剤名寄せを確認',
        queueLabel: '薬剤名寄せ確認',
      },
      {
        taskType: 'pharmacy.medication_stock_unlinked_prescription_supply',
        defaultPriority: 'high',
        allowedRelatedEntityTypes: ['patient', 'prescription_line', 'prescription_intake'],
        actionLabel: '処方供給を確認',
        queueLabel: '処方供給未紐づけ',
      },
      {
        taskType: 'pharmacy.medication_stock_external_observation_review_required',
        defaultPriority: 'high',
        allowedRelatedEntityTypes: ['patient', 'inbound_medication_stock_signal'],
        actionLabel: '残数報告を確認',
        queueLabel: '他職種残数報告',
      },
    ] as const;

    for (const taskType of medicationStockTaskTypes) {
      expect(getTaskTypeDefinition(taskType.taskType)).toMatchObject({
        module: 'pharmacy',
        taskType: taskType.taskType,
        defaultPriority: taskType.defaultPriority,
        allowedRelatedEntityTypes: taskType.allowedRelatedEntityTypes,
      });

      expect(
        describeRegisteredOperationalTask({
          task_type: taskType.taskType,
          related_entity_type: 'patient',
          related_entity_id: 'patient/1?x=y#frag',
        }),
      ).toMatchObject({
        actionHref: '/patients/patient%2F1%3Fx%3Dy%23frag#medication-stock-events',
        actionLabel: taskType.actionLabel,
        queueLabel: taskType.queueLabel,
      });

      for (const relatedEntityType of taskType.allowedRelatedEntityTypes) {
        if (relatedEntityType === 'patient') {
          continue;
        }

        const presentation = describeRegisteredOperationalTask({
          task_type: taskType.taskType,
          related_entity_type: relatedEntityType,
          related_entity_id: 'mcs_message_1?patient_name=山田太郎&raw_text=湿布',
        });

        expect(presentation).toMatchObject({
          actionHref: `/tasks?status=&task_type=${taskType.taskType}`,
          actionLabel: taskType.actionLabel,
          queueLabel: taskType.queueLabel,
        });
        expect(JSON.stringify(presentation)).not.toContain('mcs_message_1');
        expect(JSON.stringify(presentation)).not.toContain('山田太郎');
        expect(JSON.stringify(presentation)).not.toContain('湿布');
      }
    }
  });

  it('registers inbound interprofessional task types with patient-scoped action links only', () => {
    const inboundTaskTypes = [
      {
        taskType: 'core.inbound_communication_review_required',
        module: 'core',
        defaultPriority: 'high',
        allowedRelatedEntityTypes: ['patient', 'inbound_communication', 'communication_event'],
        actionLabel: '受信情報を確認',
        queueLabel: '他職種受信',
        patientHref: '/patients/patient%2F1%3Fx%3Dy%23frag#inbound-communications',
      },
      {
        taskType: 'pharmacy.inbound_medication_stock_signal_review_required',
        module: 'pharmacy',
        defaultPriority: 'high',
        allowedRelatedEntityTypes: ['patient', 'inbound_medication_stock_signal'],
        actionLabel: '残数シグナルを確認',
        queueLabel: '受信残数シグナル',
        patientHref: '/patients/patient%2F1%3Fx%3Dy%23frag#medication-stock-events',
      },
      {
        taskType: 'pharmacy.inbound_low_stock_unquantified_report',
        module: 'pharmacy',
        defaultPriority: 'high',
        allowedRelatedEntityTypes: ['patient', 'inbound_medication_stock_signal'],
        actionLabel: '不足報告を確認',
        queueLabel: '数量不明の不足報告',
        patientHref: '/patients/patient%2F1%3Fx%3Dy%23frag#medication-stock-events',
      },
      {
        taskType: 'pharmacy.inbound_medication_safety_review_required',
        module: 'pharmacy',
        defaultPriority: 'urgent',
        allowedRelatedEntityTypes: ['patient', 'inbound_communication', 'communication_event'],
        actionLabel: '薬剤安全シグナルを確認',
        queueLabel: '受信薬剤安全',
        patientHref: '/patients/patient%2F1%3Fx%3Dy%23frag#inbound-communications',
      },
      {
        taskType: 'pharmacy.inbound_schedule_request_review_required',
        module: 'pharmacy',
        defaultPriority: 'high',
        allowedRelatedEntityTypes: [
          'patient',
          'inbound_communication',
          'communication_event',
          'visit_schedule',
          'visit_schedule_proposal',
        ],
        actionLabel: '訪問調整を確認',
        queueLabel: '受信訪問調整',
        patientHref: '/patients/patient%2F1%3Fx%3Dy%23frag#inbound-communications',
      },
    ] as const;

    for (const taskType of inboundTaskTypes) {
      expect(getTaskTypeDefinition(taskType.taskType)).toMatchObject({
        module: taskType.module,
        taskType: taskType.taskType,
        defaultPriority: taskType.defaultPriority,
        allowedRelatedEntityTypes: taskType.allowedRelatedEntityTypes,
      });

      expect(
        describeRegisteredOperationalTask({
          task_type: taskType.taskType,
          related_entity_type: 'patient',
          related_entity_id: 'patient/1?x=y#frag',
        }),
      ).toMatchObject({
        actionHref: taskType.patientHref,
        actionLabel: taskType.actionLabel,
        queueLabel: taskType.queueLabel,
      });

      for (const relatedEntityType of taskType.allowedRelatedEntityTypes) {
        if (relatedEntityType === 'patient') {
          continue;
        }

        const presentation = describeRegisteredOperationalTask({
          task_type: taskType.taskType,
          related_entity_type: relatedEntityType,
          related_entity_id: 'mcs_message_1?patient_name=山田太郎&raw_text=湿布',
        });

        expect(presentation).toMatchObject({
          actionHref: `/tasks?status=&task_type=${taskType.taskType}`,
          actionLabel: taskType.actionLabel,
          queueLabel: taskType.queueLabel,
        });
        expect(JSON.stringify(presentation)).not.toContain('mcs_message_1');
        expect(JSON.stringify(presentation)).not.toContain('山田太郎');
        expect(JSON.stringify(presentation)).not.toContain('湿布');
        expect(JSON.stringify(presentation)).not.toContain('raw_text');
      }
    }
  });

  it('rejects unknown task types for creation gates', () => {
    expect(() => assertRegisteredOperationalTaskType('unknown_task_type')).toThrow(
      'Unregistered operational task_type: unknown_task_type',
    );
  });
});
