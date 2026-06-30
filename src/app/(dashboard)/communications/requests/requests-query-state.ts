type SearchParamRecord = Record<string, string | string[] | undefined> | null | undefined;

type CommunicationRequestsInitialState = {
  initialStatus?: string | null;
  initialPatientId?: string | null;
  initialRequestId?: string | null;
  initialRelatedEntityType?: string | null;
  initialRelatedEntityId?: string | null;
  initialContext?: string | null;
};

function readString(value: string | string[] | undefined) {
  return typeof value === 'string' ? value : null;
}

export function readCommunicationRequestsState(
  params: SearchParamRecord,
): CommunicationRequestsInitialState {
  return {
    initialStatus: readString(params?.status),
    initialPatientId: readString(params?.patient_id),
    initialRequestId: readString(params?.request_id),
    initialRelatedEntityType: readString(params?.related_entity_type),
    initialRelatedEntityId: readString(params?.related_entity_id),
    initialContext: readString(params?.context),
  };
}
