export type OperationalTaskPresentation = {
  actionHref: string;
  actionLabel: string;
  queueLabel: string;
};

export type OperationalTaskPresentationInput = {
  task_type: string;
  related_entity_type: string | null;
  related_entity_id: string | null;
};

export function describeOperationalTask(
  task: OperationalTaskPresentationInput,
): OperationalTaskPresentation {
  switch (task.task_type) {
    case 'staff_work_request_visit':
      return {
        actionHref:
          task.related_entity_type === 'visit_schedule' && task.related_entity_id
            ? `/schedules?focus=schedule&schedule_id=${encodeURIComponent(task.related_entity_id)}`
            : '/schedules',
        actionLabel: '訪問依頼を確認',
        queueLabel: '訪問依頼',
      };
    case 'staff_work_request_audit':
      return {
        actionHref:
          task.related_entity_type === 'dispense_task' && task.related_entity_id
            ? `/auditing?taskId=${encodeURIComponent(task.related_entity_id)}`
            : '/auditing',
        actionLabel: '監査依頼を確認',
        queueLabel: '監査依頼',
      };
    case 'staff_work_request_general':
      return {
        actionHref: '/tasks',
        actionLabel: '依頼内容を確認',
        queueLabel: '業務依頼',
      };
    case 'visit_demand':
      return {
        actionHref: '/schedules',
        actionLabel: '候補を確認',
        queueLabel: '訪問候補',
      };
    case 'visit_contact_followup':
      return {
        actionHref: '/schedules',
        actionLabel: '架電を再開',
        queueLabel: '架電',
      };
    case 'visit_preparation':
      return {
        actionHref: '/schedules',
        actionLabel: '準備を完了',
        queueLabel: '訪問準備',
      };
    case 'initial_home_visit_assessment':
      return {
        actionHref: '/patients',
        actionLabel: '患者記録を確認',
        queueLabel: '初回算定',
      };
    case 'management_plan_review':
      return {
        actionHref: '/workflow',
        actionLabel: '計画を見直す',
        queueLabel: '計画書',
      };
    case 'geocode_review':
      return {
        actionHref: '/workflow',
        actionLabel: '住所確認',
        queueLabel: '住所',
      };
    case 'visit_intake_linkage':
      return {
        actionHref: '/workflow',
        actionLabel: '訪問導線を確認',
        queueLabel: '処方受付',
      };
    case 'visit_schedule_override_approval':
      return {
        actionHref: '/schedules',
        actionLabel: '変更承認',
        queueLabel: '例外変更',
      };
    case 'patient_self_report_followup':
      return {
        actionHref: '/external',
        actionLabel: '自己申告を確認',
        queueLabel: '患者連絡',
      };
    case 'emergency_contact_review':
      return {
        actionHref: '/patients',
        actionLabel: '連絡先と文書を確認',
        queueLabel: '初回整備',
      };
    case 'dosage_form_support':
      return {
        actionHref: '/patients',
        actionLabel: '剤形支援を確認',
        queueLabel: '剤形支援',
      };
    case 'inquiry_workbench':
      return {
        actionHref: '/workflow',
        actionLabel: '疑義照会を確認',
        queueLabel: '照会',
      };
    case 'facility_batch_tracker':
      return {
        actionHref: '/schedules',
        actionLabel: '施設訪問を確認',
        queueLabel: '施設訪問',
      };
    case 'mobile_visit_mode':
      return {
        actionHref: '/schedules',
        actionLabel: '同期状況を確認',
        queueLabel: 'モバイル',
      };
    case 'visit_record_retention':
      return {
        actionHref: '/visits',
        actionLabel: '薬歴を確認',
        queueLabel: '保存期限',
      };
    case 'prescription_original_retention':
      return {
        actionHref: '/workflow',
        actionLabel: '原本保全を確認',
        queueLabel: '原本保存',
      };
    case 'fax_original_followup':
      return {
        actionHref:
          task.related_entity_type === 'prescription_intake' && task.related_entity_id
            ? `/prescriptions/${task.related_entity_id}`
            : '/patients',
        actionLabel: '原本回収を記録',
        queueLabel: 'FAX原本',
      };
    case 'community_activity_followup':
      return {
        actionHref: '/external',
        actionLabel: '地域フォローを確認',
        queueLabel: '地域活動',
      };
    case 'report_delivery_followup':
      return {
        actionHref: '/reports',
        actionLabel: '報告送達を確認',
        queueLabel: '報告送達',
      };
    case 'report_response_followup':
      return {
        actionHref: '/reports',
        actionLabel: '未確認報告を確認',
        queueLabel: '報告返信待ち',
      };
    case 'handoff_confirmation':
      return {
        actionHref: '/handoff',
        actionLabel: '申し送りを確認',
        queueLabel: '申し送り',
      };
    case 'tracing_report_followup':
      return {
        actionHref: '/workflow',
        actionLabel: '減数調整を確認',
        queueLabel: 'Tracing',
      };
    case 'residual_reduction_review':
      return {
        actionHref: '/visits',
        actionLabel: '残薬を確認',
        queueLabel: '残薬調整',
      };
    case 'visit_carry_item_review':
      return {
        actionHref: '/schedules',
        actionLabel: '持参物を確認',
        queueLabel: '持参物',
      };
    case 'first_visit_document_delivery':
      return {
        actionHref: '/patients',
        actionLabel: '文書交付を記録',
        queueLabel: '初回文書',
      };
    case 'emergency_coverage_gap':
      return {
        actionHref: '/admin/shifts',
        actionLabel: 'シフトを確認',
        queueLabel: '当番体制',
      };
    case 'conference_action_item':
      return {
        actionHref: '/conferences',
        actionLabel: '会議アクションを確認',
        queueLabel: 'カンファレンス',
      };
    default:
      if (task.related_entity_type === 'visit_schedule') {
        return {
          actionHref: task.related_entity_id
            ? `/schedules?focus=schedule&schedule_id=${encodeURIComponent(task.related_entity_id)}`
            : '/schedules',
          actionLabel: '予定を確認',
          queueLabel: '訪問',
        };
      }
      return {
        actionHref: '/workflow',
        actionLabel: 'ワークフローを開く',
        queueLabel: '運用',
      };
  }
}
