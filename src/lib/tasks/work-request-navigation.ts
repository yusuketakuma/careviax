export type WorkRequestType =
  | 'staff_work_request_visit'
  | 'staff_work_request_audit'
  | 'staff_work_request_general';

type WorkRequestHrefInput = {
  type?: WorkRequestType | null;
  title?: string | null;
  description?: string | null;
  relatedEntityType?: string | null;
  relatedEntityId?: string | null;
  context?: string | null;
};

export function buildWorkRequestHref(input: WorkRequestHrefInput = {}): string {
  const params = new URLSearchParams();
  params.set('work_request', '1');
  params.set('work_request_type', input.type ?? 'staff_work_request_general');
  if (input.relatedEntityType) params.set('related_entity_type', input.relatedEntityType);
  if (input.relatedEntityId) params.set('related_entity_id', input.relatedEntityId);
  if (input.context) params.set('context', input.context);
  return `/tasks?${params.toString()}`;
}
