export type CommunicationEntityLink = {
  href: string;
  label: string;
};

type CommunicationFilterInput = {
  status?: string | null;
  patientId?: string | null;
  relatedEntityType?: string | null;
  relatedEntityId?: string | null;
};

export function buildCommunicationRequestsHref(input: CommunicationFilterInput) {
  const params = new URLSearchParams();
  if (input.status) params.set('status', input.status);
  if (input.patientId) params.set('patient_id', input.patientId);
  if (input.relatedEntityType) params.set('related_entity_type', input.relatedEntityType);
  if (input.relatedEntityId) params.set('related_entity_id', input.relatedEntityId);

  const query = params.toString();
  return query ? `/communications/requests?${query}` : '/communications/requests';
}

export function resolveCommunicationEntityLink(input: {
  entityType: string | null;
  entityId: string | null;
}): CommunicationEntityLink | null {
  if (!input.entityType || !input.entityId) {
    return null;
  }

  switch (input.entityType) {
    case 'patient':
      return {
        href: `/patients/${input.entityId}`,
        label: '患者詳細',
      };
    case 'care_report':
      return {
        href: `/reports/${input.entityId}`,
        label: '報告書詳細',
      };
    case 'tracing_report':
      return {
        href: '/reports#tracing-reports',
        label: 'トレーシング一覧',
      };
    case 'visit_record':
      return {
        href: `/visits/${input.entityId}`,
        label: '訪問詳細',
      };
    case 'visit_schedule':
      return {
        href: '/schedules',
        label: 'スケジュール',
      };
    case 'conference_note':
      return {
        href: '/conferences',
        label: 'カンファレンス',
      };
    case 'patient_self_report':
      return {
        href: '/external',
        label: '外部共有',
      };
    default:
      return null;
  }
}
