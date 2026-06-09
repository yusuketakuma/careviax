export const EVIDENCE_OBJECT_CLASS_TAG = 'phos-object-class';
export const EVIDENCE_UPLOAD_STATUS_TAG = 'phos-upload-status';

export type EvidenceUploadStatusTag = 'PRESIGNED' | 'VERIFIED';

export function evidenceObjectTagSet(status: EvidenceUploadStatusTag) {
  return [
    { Key: EVIDENCE_OBJECT_CLASS_TAG, Value: 'evidence' },
    { Key: EVIDENCE_UPLOAD_STATUS_TAG, Value: status },
  ];
}

export function evidenceObjectTaggingHeader(status: EvidenceUploadStatusTag): string {
  return evidenceObjectTagSet(status)
    .map(({ Key, Value }) => `${encodeURIComponent(Key)}=${encodeURIComponent(Value)}`)
    .join('&');
}
