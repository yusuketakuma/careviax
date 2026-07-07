import type { PhosModuleId } from '@/core/module-registry';
import { buildAuditTaskHref } from '@/lib/audit/navigation';
import { buildCommunicationRequestsHref } from '@/lib/communications/navigation';
import {
  buildConferencesHref,
  buildExternalHref,
  buildTasksHref,
} from '@/lib/dashboard/home-link-builders';
import { buildPatientHref } from '@/lib/patient/navigation';
import { RISK_DOMAIN_LABELS, type RiskDomain } from '@/lib/risk/risk-finding';
import { buildReportHref } from '@/lib/reports/navigation';
import {
  buildScheduleFocusHref,
  buildScheduleProposalDetailHref,
} from '@/lib/schedules/navigation';
import { buildVisitHref } from '@/lib/visits/navigation';

export type TaskPriority = 'urgent' | 'high' | 'normal' | 'low';

export type TaskLike = {
  task_type: string;
  related_entity_type: string | null;
  related_entity_id: string | null;
};

export type TaskActionPresentation = {
  actionHref: string;
  actionLabel: string;
  queueLabel: string;
};

export type TaskTypeDefinition = {
  taskType: `${Exclude<PhosModuleId, 'core'> | 'core'}.${string}`;
  module: PhosModuleId;
  label: string;
  description: string;
  defaultPriority: TaskPriority;
  allowedRelatedEntityTypes: readonly string[];
  legacyTaskTypes?: readonly string[];
  actionBuilder?: (task: TaskLike) => TaskActionPresentation;
};

export type RiskTaskResolveStrategy = 'active_finding_absent' | 'manual_or_waiver_only';
export type RiskTaskResolvePredicate = 'patient_mcs_sync_success' | 'residence_geocode_valid';

export type RiskTaskResolveCondition = {
  strategy: RiskTaskResolveStrategy;
  requires_related_entity: boolean;
  predicate?: RiskTaskResolvePredicate;
};

export type RiskTaskRegistryEntry = {
  owner_domain: RiskDomain;
  task_type: string;
  default_priority: TaskPriority;
  stale_threshold_days: number;
  patient_safety: boolean;
  billing_close: boolean;
  related_entity_type: string;
  resolve_condition: RiskTaskResolveCondition;
};

function buildRelatedTaskQueueHref(taskType: string, task: TaskLike): string {
  return buildTasksHref({
    status: '',
    taskType,
    relatedEntityType: task.related_entity_type ?? undefined,
    relatedEntityId: task.related_entity_id ?? undefined,
  });
}

function buildPrescriptionIntakeHref(prescriptionIntakeId: string) {
  if (prescriptionIntakeId === '.' || prescriptionIntakeId === '..') {
    throw new RangeError('Prescription intake id cannot be a dot segment');
  }

  return `/prescriptions/${encodeURIComponent(prescriptionIntakeId)}`;
}

function buildScheduleRelatedTaskHref(task: TaskLike): string {
  if (task.related_entity_type === 'visit_schedule' && task.related_entity_id) {
    return buildScheduleFocusHref(task.related_entity_id);
  }
  if (task.related_entity_type === 'visit_schedule_proposal' && task.related_entity_id) {
    return buildScheduleProposalDetailHref(task.related_entity_id);
  }
  return buildRelatedTaskQueueHref(task.task_type, task);
}

function buildMedicationStockTaskPresentation(
  task: TaskLike,
  labels: Pick<TaskActionPresentation, 'actionLabel' | 'queueLabel'>,
): TaskActionPresentation {
  return {
    actionHref:
      task.related_entity_type === 'patient' && task.related_entity_id
        ? buildPatientHref(task.related_entity_id, '#medication-stock-events')
        : buildTasksHref({ status: '', taskType: task.task_type }),
    ...labels,
  };
}

function buildInboundCommunicationTaskPresentation(
  task: TaskLike,
  labels: Pick<TaskActionPresentation, 'actionLabel' | 'queueLabel'>,
  patientAnchor: '#inbound-communications' | '#medication-stock-events' = '#inbound-communications',
): TaskActionPresentation {
  return {
    actionHref:
      task.related_entity_type === 'patient' && task.related_entity_id
        ? buildPatientHref(task.related_entity_id, patientAnchor)
        : buildTasksHref({ status: '', taskType: task.task_type }),
    ...labels,
  };
}

const ACTIVE_FINDING_ABSENT_WITH_ENTITY = {
  strategy: 'active_finding_absent',
  requires_related_entity: true,
} as const satisfies RiskTaskResolveCondition;

const ACTIVE_FINDING_ABSENT_CASE_LEVEL = {
  strategy: 'active_finding_absent',
  requires_related_entity: false,
} as const satisfies RiskTaskResolveCondition;

export const RISK_TASK_REGISTRY = {
  patient_foundation: {
    owner_domain: 'patient_foundation',
    task_type: 'risk_patient_foundation',
    default_priority: 'high',
    stale_threshold_days: 7,
    patient_safety: true,
    billing_close: false,
    related_entity_type: 'patient_foundation',
    resolve_condition: ACTIVE_FINDING_ABSENT_CASE_LEVEL,
  },
  consent_plan: {
    owner_domain: 'consent_plan',
    task_type: 'risk_consent_plan',
    default_priority: 'urgent',
    stale_threshold_days: 3,
    patient_safety: true,
    billing_close: true,
    related_entity_type: 'consent_plan',
    resolve_condition: ACTIVE_FINDING_ABSENT_CASE_LEVEL,
  },
  medication: {
    owner_domain: 'medication',
    task_type: 'risk_medication',
    default_priority: 'urgent',
    stale_threshold_days: 1,
    patient_safety: true,
    billing_close: false,
    related_entity_type: 'medication',
    resolve_condition: ACTIVE_FINDING_ABSENT_WITH_ENTITY,
  },
  dispensing: {
    owner_domain: 'dispensing',
    task_type: 'risk_dispensing',
    default_priority: 'urgent',
    stale_threshold_days: 1,
    patient_safety: true,
    billing_close: false,
    related_entity_type: 'dispensing',
    resolve_condition: ACTIVE_FINDING_ABSENT_WITH_ENTITY,
  },
  visit_preparation: {
    owner_domain: 'visit_preparation',
    task_type: 'risk_visit_preparation',
    default_priority: 'urgent',
    stale_threshold_days: 1,
    patient_safety: true,
    billing_close: false,
    related_entity_type: 'visit_preparation',
    resolve_condition: ACTIVE_FINDING_ABSENT_WITH_ENTITY,
  },
  visit_record: {
    owner_domain: 'visit_record',
    task_type: 'risk_visit_record',
    default_priority: 'high',
    stale_threshold_days: 2,
    patient_safety: true,
    billing_close: true,
    related_entity_type: 'visit_record',
    resolve_condition: ACTIVE_FINDING_ABSENT_WITH_ENTITY,
  },
  report_delivery: {
    owner_domain: 'report_delivery',
    task_type: 'risk_report_delivery',
    default_priority: 'high',
    stale_threshold_days: 3,
    patient_safety: false,
    billing_close: true,
    related_entity_type: 'care_report',
    resolve_condition: ACTIVE_FINDING_ABSENT_WITH_ENTITY,
  },
  billing: {
    owner_domain: 'billing',
    task_type: 'risk_billing',
    default_priority: 'high',
    stale_threshold_days: 5,
    patient_safety: false,
    billing_close: true,
    related_entity_type: 'billing_evidence',
    resolve_condition: ACTIVE_FINDING_ABSENT_WITH_ENTITY,
  },
  task_sla: {
    owner_domain: 'task_sla',
    task_type: 'risk_task_sla',
    default_priority: 'high',
    stale_threshold_days: 1,
    patient_safety: false,
    billing_close: false,
    related_entity_type: 'task',
    resolve_condition: {
      strategy: 'manual_or_waiver_only',
      requires_related_entity: true,
    },
  },
  notification: {
    owner_domain: 'notification',
    task_type: 'risk_notification',
    default_priority: 'high',
    stale_threshold_days: 1,
    patient_safety: false,
    billing_close: false,
    related_entity_type: 'notification',
    resolve_condition: ACTIVE_FINDING_ABSENT_WITH_ENTITY,
  },
  privacy_security: {
    owner_domain: 'privacy_security',
    task_type: 'risk_privacy_security',
    default_priority: 'urgent',
    stale_threshold_days: 1,
    patient_safety: false,
    billing_close: false,
    related_entity_type: 'privacy_security',
    resolve_condition: ACTIVE_FINDING_ABSENT_WITH_ENTITY,
  },
  integration: {
    owner_domain: 'integration',
    task_type: 'risk_integration',
    default_priority: 'high',
    stale_threshold_days: 2,
    patient_safety: false,
    billing_close: false,
    related_entity_type: 'integration',
    resolve_condition: {
      ...ACTIVE_FINDING_ABSENT_WITH_ENTITY,
      predicate: 'patient_mcs_sync_success',
    },
  },
  data_quality: {
    owner_domain: 'data_quality',
    task_type: 'risk_data_quality',
    default_priority: 'high',
    stale_threshold_days: 7,
    patient_safety: false,
    billing_close: false,
    related_entity_type: 'data_quality',
    resolve_condition: {
      ...ACTIVE_FINDING_ABSENT_WITH_ENTITY,
      predicate: 'residence_geocode_valid',
    },
  },
} as const satisfies Record<RiskDomain, RiskTaskRegistryEntry>;

const RISK_TASK_MODULE_BY_DOMAIN = {
  patient_foundation: 'core',
  consent_plan: 'core',
  medication: 'pharmacy',
  dispensing: 'pharmacy',
  visit_preparation: 'pharmacy',
  visit_record: 'core',
  report_delivery: 'core',
  billing: 'pharmacy',
  task_sla: 'core',
  notification: 'core',
  privacy_security: 'core',
  integration: 'core',
  data_quality: 'core',
} as const satisfies Record<RiskDomain, PhosModuleId>;

function defineTaskType<const TDefinition extends TaskTypeDefinition>(
  definition: TDefinition,
): Readonly<TDefinition> {
  return Object.freeze(definition);
}

function coreTask(
  taskType: TaskTypeDefinition['taskType'],
  args: Omit<TaskTypeDefinition, 'module' | 'taskType'>,
) {
  return defineTaskType({ ...args, module: 'core', taskType });
}

function pharmacyTask(
  taskType: TaskTypeDefinition['taskType'],
  args: Omit<TaskTypeDefinition, 'module' | 'taskType'>,
) {
  return defineTaskType({ ...args, module: 'pharmacy', taskType });
}

const ANY_RELATED_ENTITY = [
  'audit_task',
  'billing_candidate',
  'billing_evidence',
  'care_report',
  'case',
  'communication_request',
  'conference_note',
  'consent_record',
  'dispense_task',
  'external_share',
  'facility',
  'management_plan',
  'medication_cycle',
  'patient',
  'patient_self_report',
  'prescription_intake',
  'privacy_security',
  'set_plan',
  'task',
  'tracing_report',
  'visit_record',
  'visit_schedule',
  'visit_schedule_proposal',
] as const;

const TASK_TYPE_DEFINITION_SEEDS = [
  coreTask('core.general', {
    legacyTaskTypes: ['general'],
    label: '運用',
    description: '汎用の運用タスク。',
    defaultPriority: 'normal',
    allowedRelatedEntityTypes: ANY_RELATED_ENTITY,
  }),
  coreTask('core.staff_work_request_visit', {
    legacyTaskTypes: ['staff_work_request_visit'],
    label: '訪問依頼',
    description: 'スタッフ間の訪問依頼。',
    defaultPriority: 'normal',
    allowedRelatedEntityTypes: ['visit_schedule'],
    actionBuilder: (task) => ({
      actionHref:
        task.related_entity_type === 'visit_schedule' && task.related_entity_id
          ? buildScheduleFocusHref(task.related_entity_id)
          : '/schedules',
      actionLabel: '訪問依頼を確認',
      queueLabel: '訪問依頼',
    }),
  }),
  pharmacyTask('pharmacy.staff_work_request_audit', {
    legacyTaskTypes: ['staff_work_request_audit'],
    label: '監査依頼',
    description: '薬局監査工程へのスタッフ依頼。',
    defaultPriority: 'normal',
    allowedRelatedEntityTypes: ['dispense_task'],
    actionBuilder: (task) => ({
      actionHref:
        task.related_entity_type === 'dispense_task' && task.related_entity_id
          ? buildAuditTaskHref(task.related_entity_id)
          : '/audit',
      actionLabel: '監査依頼を確認',
      queueLabel: '監査依頼',
    }),
  }),
  coreTask('core.staff_work_request_general', {
    legacyTaskTypes: ['staff_work_request_general'],
    label: '業務依頼',
    description: 'スタッフ間の一般業務依頼。',
    defaultPriority: 'normal',
    allowedRelatedEntityTypes: ANY_RELATED_ENTITY,
    actionBuilder: () => ({
      actionHref: '/tasks',
      actionLabel: '依頼内容を確認',
      queueLabel: '業務依頼',
    }),
  }),
  coreTask('core.inbound_communication_review_required', {
    label: '他職種受信確認',
    description: '他職種から薬局へ届いた受信情報を確認する。',
    defaultPriority: 'high',
    allowedRelatedEntityTypes: ['patient', 'inbound_communication', 'communication_event'],
    actionBuilder: (task) =>
      buildInboundCommunicationTaskPresentation(task, {
        actionLabel: '受信情報を確認',
        queueLabel: '他職種受信',
      }),
  }),
  coreTask('core.visit_demand', {
    legacyTaskTypes: ['visit_demand'],
    label: '訪問候補',
    description: '訪問候補または訪問需要の確認。',
    defaultPriority: 'normal',
    allowedRelatedEntityTypes: ['visit_schedule', 'visit_schedule_proposal'],
    actionBuilder: (task) => ({
      actionHref: buildScheduleRelatedTaskHref(task),
      actionLabel: '候補を確認',
      queueLabel: '訪問候補',
    }),
  }),
  coreTask('core.visit_contact_followup', {
    legacyTaskTypes: ['visit_contact_followup'],
    label: '架電',
    description: '訪問調整の患者連絡フォロー。',
    defaultPriority: 'normal',
    allowedRelatedEntityTypes: ['visit_schedule', 'visit_schedule_proposal'],
    actionBuilder: (task) => ({
      actionHref: buildScheduleRelatedTaskHref(task),
      actionLabel: '架電を再開',
      queueLabel: '架電',
    }),
  }),
  pharmacyTask('pharmacy.visit_preparation', {
    legacyTaskTypes: ['visit_preparation'],
    label: '訪問準備',
    description: '薬局訪問準備の未完了項目。',
    defaultPriority: 'normal',
    allowedRelatedEntityTypes: ['visit_schedule'],
    actionBuilder: (task) => ({
      actionHref: buildScheduleRelatedTaskHref(task),
      actionLabel: '準備を完了',
      queueLabel: '訪問準備',
    }),
  }),
  coreTask('core.initial_home_visit_assessment', {
    legacyTaskTypes: ['initial_home_visit_assessment'],
    label: '初回算定',
    description: '初回在宅訪問評価の確認。',
    defaultPriority: 'high',
    allowedRelatedEntityTypes: ['patient'],
    actionBuilder: (task) => ({
      actionHref:
        task.related_entity_type === 'patient' && task.related_entity_id
          ? buildPatientHref(task.related_entity_id)
          : '/patients',
      actionLabel: '患者記録を確認',
      queueLabel: '初回算定',
    }),
  }),
  coreTask('core.management_plan_review', {
    legacyTaskTypes: ['management_plan_review'],
    label: '計画書',
    description: '管理計画書の見直し。',
    defaultPriority: 'high',
    allowedRelatedEntityTypes: ['patient', 'management_plan'],
    actionBuilder: (task) => ({
      actionHref:
        task.related_entity_type === 'patient' && task.related_entity_id
          ? buildPatientHref(task.related_entity_id, '#patient-documents')
          : buildRelatedTaskQueueHref(task.task_type, task),
      actionLabel: '計画を見直す',
      queueLabel: '計画書',
    }),
  }),
  coreTask('core.geocode_review', {
    legacyTaskTypes: ['geocode_review'],
    label: '住所',
    description: '患者住所またはジオコード品質の確認。',
    defaultPriority: 'high',
    allowedRelatedEntityTypes: ['patient'],
    actionBuilder: (task) => ({
      actionHref:
        task.related_entity_type === 'patient' && task.related_entity_id
          ? buildPatientHref(task.related_entity_id, '/edit?section=visit#intake.address')
          : buildRelatedTaskQueueHref(task.task_type, task),
      actionLabel: '住所確認',
      queueLabel: '住所',
    }),
  }),
  pharmacyTask('pharmacy.visit_intake_linkage', {
    legacyTaskTypes: ['visit_intake_linkage'],
    label: '処方受付',
    description: '処方受付から訪問導線への接続確認。',
    defaultPriority: 'normal',
    allowedRelatedEntityTypes: ['prescription_intake'],
    actionBuilder: (task) => ({
      actionHref:
        task.related_entity_type === 'prescription_intake' && task.related_entity_id
          ? buildPrescriptionIntakeHref(task.related_entity_id)
          : buildRelatedTaskQueueHref(task.task_type, task),
      actionLabel: '訪問導線を確認',
      queueLabel: '処方受付',
    }),
  }),
  coreTask('core.visit_schedule_override_approval', {
    legacyTaskTypes: ['visit_schedule_override_approval'],
    label: '例外変更',
    description: '訪問予定の例外変更承認。',
    defaultPriority: 'high',
    allowedRelatedEntityTypes: ['visit_schedule', 'visit_schedule_proposal'],
    actionBuilder: (task) => ({
      actionHref: buildScheduleRelatedTaskHref(task),
      actionLabel: '変更承認',
      queueLabel: '例外変更',
    }),
  }),
  coreTask('core.patient_self_report_followup', {
    legacyTaskTypes: ['patient_self_report_followup'],
    label: '患者連絡',
    description: '患者自己申告へのフォロー。',
    defaultPriority: 'normal',
    allowedRelatedEntityTypes: ['patient', 'patient_self_report'],
    actionBuilder: (task) => ({
      actionHref:
        task.related_entity_type === 'patient' && task.related_entity_id
          ? buildPatientHref(task.related_entity_id, '/collaboration')
          : buildExternalHref({ focus: 'self_reports' }),
      actionLabel: '自己申告を確認',
      queueLabel: '患者連絡',
    }),
  }),
  coreTask('core.emergency_contact_review', {
    legacyTaskTypes: ['emergency_contact_review'],
    label: '初回整備',
    description: '緊急連絡先と初回文書の確認。',
    defaultPriority: 'high',
    allowedRelatedEntityTypes: ['patient'],
    actionBuilder: (task) => ({
      actionHref:
        task.related_entity_type === 'patient' && task.related_entity_id
          ? buildPatientHref(
              task.related_entity_id,
              '/edit?section=visit#intake.emergency_contact.name',
            )
          : '/patients',
      actionLabel: '連絡先と文書を確認',
      queueLabel: '初回整備',
    }),
  }),
  coreTask('core.patient_foundation_review', {
    legacyTaskTypes: ['patient_foundation_review'],
    label: '正本確認',
    description: '患者基盤情報の整備。',
    defaultPriority: 'high',
    allowedRelatedEntityTypes: ['patient'],
    actionBuilder: (task) => ({
      actionHref:
        task.related_entity_type === 'patient' && task.related_entity_id
          ? buildPatientHref(task.related_entity_id, '#patient-foundation')
          : '/patients?foundation_gap=1',
      actionLabel: '患者基盤を整備',
      queueLabel: '正本確認',
    }),
  }),
  pharmacyTask('pharmacy.dosage_form_support', {
    legacyTaskTypes: ['dosage_form_support'],
    label: '剤形支援',
    description: '薬剤の剤形支援確認。',
    defaultPriority: 'normal',
    allowedRelatedEntityTypes: ['patient'],
    actionBuilder: (task) => ({
      actionHref:
        task.related_entity_type === 'patient' && task.related_entity_id
          ? buildPatientHref(task.related_entity_id, '/safety-check')
          : buildExternalHref({ focus: 'self_reports' }),
      actionLabel: '剤形支援を確認',
      queueLabel: '剤形支援',
    }),
  }),
  pharmacyTask('pharmacy.inquiry_workbench', {
    legacyTaskTypes: ['inquiry_workbench'],
    label: '照会',
    description: '疑義照会ワークベンチの確認。',
    defaultPriority: 'high',
    allowedRelatedEntityTypes: ['prescription_intake'],
    actionBuilder: (task) => ({
      actionHref:
        task.related_entity_type === 'prescription_intake' && task.related_entity_id
          ? buildPrescriptionIntakeHref(task.related_entity_id)
          : buildRelatedTaskQueueHref(task.task_type, task),
      actionLabel: '疑義照会を確認',
      queueLabel: '照会',
    }),
  }),
  coreTask('core.facility_batch_tracker', {
    legacyTaskTypes: ['facility_batch_tracker'],
    label: '施設訪問',
    description: '施設一括訪問の確認。',
    defaultPriority: 'normal',
    allowedRelatedEntityTypes: ['visit_schedule'],
    actionBuilder: (task) => ({
      actionHref: buildScheduleRelatedTaskHref(task),
      actionLabel: '施設訪問を確認',
      queueLabel: '施設訪問',
    }),
  }),
  coreTask('core.mobile_visit_mode', {
    legacyTaskTypes: ['mobile_visit_mode'],
    label: 'モバイル',
    description: '訪問モードまたは同期状態の確認。',
    defaultPriority: 'normal',
    allowedRelatedEntityTypes: ['visit_schedule'],
    actionBuilder: (task) => ({
      actionHref: buildScheduleRelatedTaskHref(task),
      actionLabel: '同期状況を確認',
      queueLabel: 'モバイル',
    }),
  }),
  coreTask('core.visit_record_retention', {
    legacyTaskTypes: ['visit_record_retention'],
    label: '保存期限',
    description: '訪問記録の保持・保存期限確認。',
    defaultPriority: 'normal',
    allowedRelatedEntityTypes: ['visit_record'],
    actionBuilder: (task) => ({
      actionHref:
        task.related_entity_type === 'visit_record' && task.related_entity_id
          ? buildVisitHref(task.related_entity_id)
          : '/visits',
      actionLabel: '薬歴を確認',
      queueLabel: '保存期限',
    }),
  }),
  coreTask('core.visit_followup', {
    legacyTaskTypes: ['visit_followup'],
    label: '次回訪問',
    description: '訪問記録後の次回訪問候補または患者連絡確認。',
    defaultPriority: 'high',
    allowedRelatedEntityTypes: ['visit_record', 'visit_schedule', 'visit_schedule_proposal'],
    actionBuilder: (task) => ({
      actionHref:
        task.related_entity_type === 'visit_record' && task.related_entity_id
          ? buildVisitHref(task.related_entity_id)
          : buildRelatedTaskQueueHref(task.task_type, task),
      actionLabel: '次回訪問を確認',
      queueLabel: '次回訪問',
    }),
  }),
  pharmacyTask('pharmacy.prescription_original_retention', {
    legacyTaskTypes: ['prescription_original_retention'],
    label: '原本保存',
    description: '処方箋原本の保全確認。',
    defaultPriority: 'normal',
    allowedRelatedEntityTypes: ['prescription_intake'],
    actionBuilder: (task) => ({
      actionHref:
        task.related_entity_type === 'prescription_intake' && task.related_entity_id
          ? buildPrescriptionIntakeHref(task.related_entity_id)
          : '/workflow',
      actionLabel: '原本保全を確認',
      queueLabel: '原本保存',
    }),
  }),
  pharmacyTask('pharmacy.fax_original_followup', {
    legacyTaskTypes: ['fax_original_followup'],
    label: 'FAX原本',
    description: 'FAX処方箋の原本回収確認。',
    defaultPriority: 'normal',
    allowedRelatedEntityTypes: ['prescription_intake'],
    actionBuilder: (task) => ({
      actionHref:
        task.related_entity_type === 'prescription_intake' && task.related_entity_id
          ? buildPrescriptionIntakeHref(task.related_entity_id)
          : '/patients',
      actionLabel: '原本回収を記録',
      queueLabel: 'FAX原本',
    }),
  }),
  coreTask('core.community_activity_followup', {
    legacyTaskTypes: ['community_activity_followup'],
    label: '地域活動',
    description: '地域活動フォロー。',
    defaultPriority: 'normal',
    allowedRelatedEntityTypes: ['community_activity'],
    actionBuilder: () => ({
      actionHref: buildExternalHref({ focus: 'activities' }),
      actionLabel: '地域フォローを確認',
      queueLabel: '地域活動',
    }),
  }),
  coreTask('core.report_delivery_followup', {
    legacyTaskTypes: ['report_delivery_followup'],
    label: '報告送達',
    description: '報告書送達の確認。',
    defaultPriority: 'high',
    allowedRelatedEntityTypes: ['care_report'],
    actionBuilder: (task) => ({
      actionHref:
        task.related_entity_type === 'care_report' && task.related_entity_id
          ? buildReportHref(task.related_entity_id)
          : '/reports',
      actionLabel: '報告送達を確認',
      queueLabel: '報告送達',
    }),
  }),
  coreTask('core.report_response_followup', {
    legacyTaskTypes: ['report_response_followup', 'care_report_followup'],
    label: '報告返信待ち',
    description: '未確認報告または返信待ちの確認。',
    defaultPriority: 'normal',
    allowedRelatedEntityTypes: ['care_report', 'patient'],
    actionBuilder: (task) => ({
      actionHref:
        task.related_entity_type === 'care_report' && task.related_entity_id
          ? buildReportHref(task.related_entity_id)
          : '/reports',
      actionLabel: '未確認報告を確認',
      queueLabel: '報告返信待ち',
    }),
  }),
  coreTask('core.communication_request_followup', {
    legacyTaskTypes: ['communication_request_followup'],
    label: '連携返信待ち',
    description: '多職種連携依頼の返信待ち確認。',
    defaultPriority: 'normal',
    allowedRelatedEntityTypes: ['patient', 'communication_request'],
    actionBuilder: (task) => ({
      actionHref: buildCommunicationRequestsHref({
        status: 'sent',
        patientId:
          task.related_entity_type === 'patient' && task.related_entity_id
            ? task.related_entity_id
            : null,
      }),
      actionLabel: '連携依頼を確認',
      queueLabel: '連携返信待ち',
    }),
  }),
  coreTask('core.handoff_confirmation', {
    legacyTaskTypes: ['handoff_confirmation'],
    label: '申し送り',
    description: '申し送り確認。',
    defaultPriority: 'normal',
    allowedRelatedEntityTypes: ['visit_record'],
    actionBuilder: () => ({
      actionHref: '/handoff',
      actionLabel: '申し送りを確認',
      queueLabel: '申し送り',
    }),
  }),
  coreTask('core.handoff_supervision_review', {
    legacyTaskTypes: ['handoff_supervision_review'],
    label: '申し送り上長確認',
    description: '申し送りの上長確認。',
    defaultPriority: 'high',
    allowedRelatedEntityTypes: ['visit_record'],
    actionBuilder: () => ({
      actionHref: '/handoff',
      actionLabel: '上長確認を行う',
      queueLabel: '申し送り上長確認',
    }),
  }),
  pharmacyTask('pharmacy.tracing_report_followup', {
    legacyTaskTypes: ['tracing_report_followup'],
    label: '服薬情報提供書',
    description: '服薬情報提供書に関する連携依頼確認。',
    defaultPriority: 'normal',
    allowedRelatedEntityTypes: ['tracing_report'],
    actionBuilder: (task) => ({
      actionHref: buildCommunicationRequestsHref({
        requestType: 'tracing_report',
        relatedEntityType:
          task.related_entity_type === 'tracing_report' && task.related_entity_id
            ? 'tracing_report'
            : null,
        relatedEntityId:
          task.related_entity_type === 'tracing_report' && task.related_entity_id
            ? task.related_entity_id
            : null,
      }),
      actionLabel: '関連依頼を確認',
      queueLabel: '服薬情報提供書',
    }),
  }),
  pharmacyTask('pharmacy.residual_reduction_review', {
    legacyTaskTypes: ['residual_reduction_review'],
    label: '残薬調整',
    description: '残薬調整レビュー。',
    defaultPriority: 'normal',
    allowedRelatedEntityTypes: ['visit_record'],
    actionBuilder: (task) => ({
      actionHref:
        task.related_entity_type === 'visit_record' && task.related_entity_id
          ? buildVisitHref(task.related_entity_id)
          : '/visits',
      actionLabel: '残薬を確認',
      queueLabel: '残薬調整',
    }),
  }),
  pharmacyTask('pharmacy.medication_stock_shortage_expected', {
    label: '残数不足見込み',
    description: '外用薬・頓服薬の不足見込みを確認する。',
    defaultPriority: 'urgent',
    allowedRelatedEntityTypes: [
      'patient',
      'medication_stock_item',
      'medication_stock_event',
      'inbound_medication_stock_signal',
    ],
    actionBuilder: (task) =>
      buildMedicationStockTaskPresentation(task, {
        actionLabel: '残数不足を確認',
        queueLabel: '残数不足見込み',
      }),
  }),
  pharmacyTask('pharmacy.medication_stock_usage_unknown', {
    label: '使用頻度未確認',
    description: '外用薬・頓服薬の使用頻度不明を確認する。',
    defaultPriority: 'high',
    allowedRelatedEntityTypes: ['patient', 'medication_stock_item'],
    actionBuilder: (task) =>
      buildMedicationStockTaskPresentation(task, {
        actionLabel: '使用頻度を確認',
        queueLabel: '使用頻度未確認',
      }),
  }),
  pharmacyTask('pharmacy.medication_stock_equivalence_review_required', {
    label: '薬剤名寄せ確認',
    description: '外用薬・頓服薬の薬剤マスタ照合または名寄せ確認を行う。',
    defaultPriority: 'high',
    allowedRelatedEntityTypes: [
      'patient',
      'medication_stock_item',
      'canonical_medication_group',
      'inbound_medication_stock_signal',
    ],
    actionBuilder: (task) =>
      buildMedicationStockTaskPresentation(task, {
        actionLabel: '薬剤名寄せを確認',
        queueLabel: '薬剤名寄せ確認',
      }),
  }),
  pharmacyTask('pharmacy.medication_stock_unlinked_prescription_supply', {
    label: '処方供給未紐づけ',
    description: '処方供給量を外用薬・頓服薬残数台帳へ紐づける。',
    defaultPriority: 'high',
    allowedRelatedEntityTypes: ['patient', 'prescription_line', 'prescription_intake'],
    actionBuilder: (task) =>
      buildMedicationStockTaskPresentation(task, {
        actionLabel: '処方供給を確認',
        queueLabel: '処方供給未紐づけ',
      }),
  }),
  pharmacyTask('pharmacy.medication_stock_external_observation_review_required', {
    label: '他職種残数報告',
    description: '他職種・患者家族・協力薬局由来の外用薬・頓服薬残数報告を薬剤師が確認する。',
    defaultPriority: 'high',
    allowedRelatedEntityTypes: ['patient', 'inbound_medication_stock_signal'],
    actionBuilder: (task) =>
      buildMedicationStockTaskPresentation(task, {
        actionLabel: '残数報告を確認',
        queueLabel: '他職種残数報告',
      }),
  }),
  pharmacyTask('pharmacy.inbound_medication_stock_signal_review_required', {
    label: '受信残数シグナル',
    description: '他職種受信情報から抽出された残数・使用量シグナルを確認する。',
    defaultPriority: 'high',
    allowedRelatedEntityTypes: ['patient', 'inbound_medication_stock_signal'],
    actionBuilder: (task) =>
      buildInboundCommunicationTaskPresentation(
        task,
        {
          actionLabel: '残数シグナルを確認',
          queueLabel: '受信残数シグナル',
        },
        '#medication-stock-events',
      ),
  }),
  pharmacyTask('pharmacy.inbound_low_stock_unquantified_report', {
    label: '数量不明の不足報告',
    description: '数量が不明な外用薬・頓服薬の不足報告を確認する。',
    defaultPriority: 'high',
    allowedRelatedEntityTypes: ['patient', 'inbound_medication_stock_signal'],
    actionBuilder: (task) =>
      buildInboundCommunicationTaskPresentation(
        task,
        {
          actionLabel: '不足報告を確認',
          queueLabel: '数量不明の不足報告',
        },
        '#medication-stock-events',
      ),
  }),
  pharmacyTask('pharmacy.inbound_medication_safety_review_required', {
    label: '受信薬剤安全確認',
    description: '他職種受信情報に含まれる薬剤安全シグナルを薬剤師が確認する。',
    defaultPriority: 'urgent',
    allowedRelatedEntityTypes: ['patient', 'inbound_communication', 'communication_event'],
    actionBuilder: (task) =>
      buildInboundCommunicationTaskPresentation(task, {
        actionLabel: '薬剤安全シグナルを確認',
        queueLabel: '受信薬剤安全',
      }),
  }),
  pharmacyTask('pharmacy.inbound_schedule_request_review_required', {
    label: '受信訪問調整',
    description: '他職種受信情報に含まれる訪問希望・日程変更希望を確認する。',
    defaultPriority: 'high',
    allowedRelatedEntityTypes: [
      'patient',
      'inbound_communication',
      'communication_event',
      'visit_schedule',
      'visit_schedule_proposal',
    ],
    actionBuilder: (task) =>
      buildInboundCommunicationTaskPresentation(task, {
        actionLabel: '訪問調整を確認',
        queueLabel: '受信訪問調整',
      }),
  }),
  coreTask('core.visit_carry_item_review', {
    legacyTaskTypes: ['visit_carry_item_review'],
    label: '持参物',
    description: '訪問持参物の確認。',
    defaultPriority: 'high',
    allowedRelatedEntityTypes: ['visit_schedule'],
    actionBuilder: (task) => ({
      actionHref: buildScheduleRelatedTaskHref(task),
      actionLabel: '持参物を確認',
      queueLabel: '持参物',
    }),
  }),
  coreTask('core.first_visit_document_delivery', {
    legacyTaskTypes: ['first_visit_document_delivery'],
    label: '初回文書',
    description: '初回訪問文書の交付記録。',
    defaultPriority: 'normal',
    allowedRelatedEntityTypes: ['patient'],
    actionBuilder: (task) => ({
      actionHref:
        task.related_entity_type === 'patient' && task.related_entity_id
          ? buildPatientHref(task.related_entity_id, '#patient-documents')
          : buildRelatedTaskQueueHref(task.task_type, task),
      actionLabel: '文書交付を記録',
      queueLabel: '初回文書',
    }),
  }),
  coreTask('core.emergency_coverage_gap', {
    legacyTaskTypes: ['emergency_coverage_gap'],
    label: '当番体制',
    description: '緊急当番体制の不足確認。',
    defaultPriority: 'urgent',
    allowedRelatedEntityTypes: ['pharmacist_shift'],
    actionBuilder: () => ({
      actionHref: '/admin/shifts',
      actionLabel: 'シフトを確認',
      queueLabel: '当番体制',
    }),
  }),
  coreTask('core.conference_action_item', {
    legacyTaskTypes: ['conference_action_item'],
    label: 'カンファレンス',
    description: 'カンファレンスのアクション項目。',
    defaultPriority: 'normal',
    allowedRelatedEntityTypes: ['conference_note'],
    actionBuilder: () => ({
      actionHref: buildConferencesHref({ focus: 'notes' }),
      actionLabel: '会議アクションを確認',
      queueLabel: 'カンファレンス',
    }),
  }),
  coreTask('core.conference_schedule_adjustment', {
    legacyTaskTypes: ['conference_schedule_adjustment'],
    label: '予定調整',
    description: 'カンファレンス起点の予定調整。',
    defaultPriority: 'normal',
    allowedRelatedEntityTypes: ['conference_note', 'visit_schedule'],
  }),
  coreTask('core.conference_immediate_action', {
    legacyTaskTypes: ['conference_immediate_action'],
    label: '即時対応',
    description: 'カンファレンスで発生した即時対応。',
    defaultPriority: 'urgent',
    allowedRelatedEntityTypes: ['conference_note'],
  }),
  coreTask('core.conference_risk_mitigation', {
    legacyTaskTypes: ['conference_risk_mitigation'],
    label: 'リスク低減',
    description: 'カンファレンスで確認したリスク低減対応。',
    defaultPriority: 'high',
    allowedRelatedEntityTypes: ['conference_note'],
  }),
  coreTask('core.conference_case_status_review', {
    legacyTaskTypes: ['conference_case_status_review'],
    label: 'ケース確認',
    description: 'カンファレンス後のケース状態確認。',
    defaultPriority: 'normal',
    allowedRelatedEntityTypes: ['conference_note', 'case'],
  }),
  coreTask('core.conference_quality_improvement', {
    legacyTaskTypes: ['conference_quality_improvement'],
    label: '品質改善',
    description: 'カンファレンスで出た品質改善項目。',
    defaultPriority: 'normal',
    allowedRelatedEntityTypes: ['conference_note'],
  }),
  coreTask('core.facility_standard_expiry', {
    legacyTaskTypes: ['facility_standard_expiry'],
    label: '施設基準期限',
    description: '施設基準の期限確認。',
    defaultPriority: 'high',
    allowedRelatedEntityTypes: ['facility'],
  }),
  coreTask('core.consent_expiry', {
    legacyTaskTypes: ['consent_expiry', 'visit_consent_renewal'],
    label: '同意期限',
    description: '同意期限または更新タスク。',
    defaultPriority: 'urgent',
    allowedRelatedEntityTypes: ['patient', 'consent_record'],
  }),
  coreTask('core.public_subsidy_expiry', {
    legacyTaskTypes: ['public_subsidy_expiry'],
    label: '公費期限',
    description: '公費・助成期限の確認。',
    defaultPriority: 'high',
    allowedRelatedEntityTypes: ['patient'],
  }),
  pharmacyTask('pharmacy.pca_pump_rental_overdue', {
    legacyTaskTypes: ['pca_pump_rental_overdue'],
    label: 'PCA返却',
    description: 'PCAポンプ貸与期限超過の確認。',
    defaultPriority: 'high',
    allowedRelatedEntityTypes: ['patient', 'medication_cycle'],
  }),
  pharmacyTask('pharmacy.pca_pump_return_inspection_pending', {
    legacyTaskTypes: ['pca_pump_return_inspection_pending'],
    label: 'PCA点検',
    description: 'PCAポンプ返却点検待ち。',
    defaultPriority: 'normal',
    allowedRelatedEntityTypes: ['patient', 'medication_cycle'],
  }),
  coreTask('core.management_plan_missing', {
    legacyTaskTypes: ['management_plan_missing'],
    label: '計画書未整備',
    description: '管理計画書の未整備対応。',
    defaultPriority: 'urgent',
    allowedRelatedEntityTypes: ['patient', 'management_plan'],
  }),
  pharmacyTask('pharmacy.prescription_original_management', {
    legacyTaskTypes: ['prescription_original_management'],
    label: '処方箋原本管理',
    description: '処方箋原本の管理対応。',
    defaultPriority: 'normal',
    allowedRelatedEntityTypes: ['prescription_intake'],
  }),
  coreTask('core.patient_mcs_profile', {
    legacyTaskTypes: ['patient_mcs_profile'],
    label: 'MCS連携',
    description: '患者MCSプロフィールの同期確認。',
    defaultPriority: 'normal',
    allowedRelatedEntityTypes: ['patient'],
  }),
  coreTask('core.patient_billing_payment_profile', {
    legacyTaskTypes: ['patient_billing_payment_profile'],
    label: '集金プロファイル',
    description: '患者集金プロファイルの確認。',
    defaultPriority: 'normal',
    allowedRelatedEntityTypes: ['patient'],
  }),
  coreTask('core.patient_change_review', {
    legacyTaskTypes: ['patient_change_review'],
    label: '患者変更確認',
    description: '患者基盤情報変更の確認。',
    defaultPriority: 'normal',
    allowedRelatedEntityTypes: ['patient'],
  }),
  coreTask('core.billing_evidence_review', {
    legacyTaskTypes: ['billing_evidence_review'],
    label: '算定根拠確認',
    description: '算定根拠の確認。',
    defaultPriority: 'high',
    allowedRelatedEntityTypes: ['billing_evidence', 'billing_candidate', 'patient'],
  }),
  coreTask('core.consent_revocation_review', {
    legacyTaskTypes: ['consent_revocation_review'],
    label: '同意撤回確認',
    description: '同意撤回後の影響確認。',
    defaultPriority: 'urgent',
    allowedRelatedEntityTypes: ['consent_record', 'patient'],
  }),
  coreTask('core.visit_schedule_reproposal_needed', {
    legacyTaskTypes: ['visit_schedule_reproposal_needed'],
    label: '再提案',
    description: '訪問予定の再提案が必要。',
    defaultPriority: 'high',
    allowedRelatedEntityTypes: ['visit_schedule_proposal', 'visit_schedule'],
  }),
] as const satisfies readonly TaskTypeDefinition[];

const RISK_TASK_TYPE_DEFINITIONS = Object.values(RISK_TASK_REGISTRY).map((entry) =>
  defineTaskType({
    taskType: `${RISK_TASK_MODULE_BY_DOMAIN[entry.owner_domain]}.${entry.task_type}`,
    module: RISK_TASK_MODULE_BY_DOMAIN[entry.owner_domain],
    legacyTaskTypes: [entry.task_type],
    label: buildRiskTaskTitle(entry.owner_domain),
    description: buildRiskTaskDescription(entry.owner_domain),
    defaultPriority: entry.default_priority,
    allowedRelatedEntityTypes: [entry.related_entity_type],
  }),
) satisfies readonly TaskTypeDefinition[];

export const TASK_TYPE_REGISTRY = [
  ...TASK_TYPE_DEFINITION_SEEDS,
  ...RISK_TASK_TYPE_DEFINITIONS,
] as const satisfies readonly TaskTypeDefinition[];

const TASK_TYPE_DEFINITION_BY_TYPE = new Map<string, TaskTypeDefinition>();

for (const definition of TASK_TYPE_REGISTRY) {
  const knownTypes = [definition.taskType, ...(definition.legacyTaskTypes ?? [])];
  for (const taskType of knownTypes) {
    if (TASK_TYPE_DEFINITION_BY_TYPE.has(taskType)) {
      throw new Error(`Duplicate operational task_type registry entry: ${taskType}`);
    }
    TASK_TYPE_DEFINITION_BY_TYPE.set(taskType, definition);
  }
}

export function hasModulePrefixedTaskType(taskType: string): boolean {
  return /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/.test(taskType);
}

export function getTaskTypeDefinition(taskType: string): TaskTypeDefinition | null {
  return TASK_TYPE_DEFINITION_BY_TYPE.get(taskType) ?? null;
}

export function isRegisteredTaskType(taskType: string): boolean {
  return getTaskTypeDefinition(taskType) !== null;
}

export function isLegacyTaskType(taskType: string): boolean {
  const definition = getTaskTypeDefinition(taskType);
  return Boolean(definition && definition.taskType !== taskType);
}

export function getCanonicalTaskType(taskType: string): string | null {
  return getTaskTypeDefinition(taskType)?.taskType ?? null;
}

export function assertRegisteredOperationalTaskType(taskType: string): string {
  if (!getTaskTypeDefinition(taskType)) {
    throw new Error(`Unregistered operational task_type: ${taskType}`);
  }
  return taskType;
}

export function describeRegisteredOperationalTask(task: TaskLike): TaskActionPresentation | null {
  const definition = getTaskTypeDefinition(task.task_type);
  return definition?.actionBuilder?.(task) ?? null;
}

export function getRiskTaskRegistryEntry(domain: RiskDomain): RiskTaskRegistryEntry {
  return RISK_TASK_REGISTRY[domain];
}

export function buildRiskTaskTitle(domain: RiskDomain) {
  return `${RISK_DOMAIN_LABELS[domain]}の対応`;
}

export function buildRiskTaskDescription(domain: RiskDomain) {
  return `${RISK_DOMAIN_LABELS[domain]}の未解決リスクを確認し、対応状況を更新してください。`;
}
