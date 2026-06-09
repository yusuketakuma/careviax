export const EVIDENCE_OBJECT_CLASS_TAG = 'phos-object-class';
export const EVIDENCE_UPLOAD_STATUS_TAG = 'phos-upload-status';
export const EVIDENCE_TENANT_ID_TAG = 'phos-tenant-id';

export type EvidenceUploadStatusTag = 'PRESIGNED' | 'VERIFIED';

export function evidenceObjectTagSet(status: EvidenceUploadStatusTag, tenant_id: string) {
  return [
    { Key: EVIDENCE_OBJECT_CLASS_TAG, Value: 'evidence' },
    { Key: EVIDENCE_UPLOAD_STATUS_TAG, Value: status },
    { Key: EVIDENCE_TENANT_ID_TAG, Value: tenant_id },
  ];
}

export function evidenceObjectTaggingHeader(
  status: EvidenceUploadStatusTag,
  tenant_id: string,
): string {
  return evidenceObjectTagSet(status, tenant_id)
    .map(({ Key, Value }) => `${encodeURIComponent(Key)}=${encodeURIComponent(Value)}`)
    .join('&');
}
