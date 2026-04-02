export type HandoffEntityAction = {
  href: string;
  label: string;
};

export function resolveHandoffEntityAction(input: {
  entity_type: string | null;
  entity_id: string | null;
}): HandoffEntityAction | null {
  if (!input.entity_type || !input.entity_id) {
    return null;
  }

  switch (input.entity_type) {
    case 'patient':
      return {
        href: `/patients/${input.entity_id}`,
        label: '患者を開く',
      };
    case 'visit_record':
      return {
        href: `/visits/handoffs/${input.entity_id}`,
        label: '申し送りを確認',
      };
    case 'care_report':
    case 'tracing_report':
      return {
        href: `/reports/${input.entity_id}`,
        label: '報告を開く',
      };
    case 'conference_note':
      return {
        href: '/conferences',
        label: 'カンファレンスを開く',
      };
    case 'patient_self_report':
      return {
        href: '/external',
        label: '外部共有を開く',
      };
    case 'visit_schedule':
      return {
        href: '/schedules',
        label: 'スケジュールを開く',
      };
    default:
      return null;
  }
}
