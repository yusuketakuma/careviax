export type RecoveryEvidenceUnsafeLabel =
  | 'aws_arn'
  | 'aws_account_id'
  | 'signed_url_or_token'
  | 'database_url_or_password'
  | 'api_key_or_bearer_token'
  | 'aws_access_key_id'
  | 'kms_key_identifier'
  | 'url_with_credentials'
  | 'rds_endpoint'
  | 'internal_endpoint'
  | 'security_group_id'
  | 'subnet_id'
  | 'vpc_id'
  | 'raw_s3_uri'
  | 'raw_s3_https_url'
  | 'raw_s3_key'
  | 'snapshot_or_recovery_identifier'
  | 'phone_number'
  | 'postal_or_address_value'
  | 'patient_named_value'
  | 'patient_identifier';

const UNSAFE_EVIDENCE_PATTERNS: Array<{
  label: RecoveryEvidenceUnsafeLabel;
  pattern: RegExp;
}> = [
  { label: 'aws_arn', pattern: /\barn:aws[a-z-]*:[^\s|)]+/gi },
  { label: 'aws_account_id', pattern: /(?<!\d)\d{12}(?!\d)/g },
  {
    label: 'signed_url_or_token',
    pattern:
      /\b(?:X-Amz-Signature|X-Amz-Credential|X-Amz-Security-Token|token|access_token|refresh_token|signature)=\S*/gi,
  },
  {
    label: 'database_url_or_password',
    pattern:
      /\b(?:DATABASE_URL|DIRECT_URL|PGPASSWORD|AWS_SECRET_ACCESS_KEY|AWS_SESSION_TOKEN|password|passwd|db_password|secret|client_secret)\s*[=:]\s*\S*/gi,
  },
  {
    label: 'api_key_or_bearer_token',
    pattern:
      /\b(?:Authorization\s*[:=]\s*Bearer\s+\S+|Bearer\s+[A-Za-z0-9._~+/-]{20,}=*|api[_-]?key\s*[=:]\s*\S+|sk-[A-Za-z0-9_-]{16,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})\b/gi,
  },
  { label: 'aws_access_key_id', pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g },
  {
    label: 'kms_key_identifier',
    pattern: /\b(?:key\/[0-9a-f]{8}-[0-9a-f-]{27,}|kms-key-[A-Za-z0-9-]+)\b/gi,
  },
  {
    label: 'url_with_credentials',
    pattern: /\b[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^@\s]+@[^\s|)]+/gi,
  },
  { label: 'rds_endpoint', pattern: /\b[a-z0-9.-]+\.rds\.amazonaws\.com\b/gi },
  { label: 'internal_endpoint', pattern: /\b[a-z0-9.-]+\.(?:internal|local)\b/gi },
  { label: 'security_group_id', pattern: /\bsg-[0-9a-f]{8,}\b/gi },
  { label: 'subnet_id', pattern: /\bsubnet-[0-9a-f]{8,}\b/gi },
  { label: 'vpc_id', pattern: /\bvpc-[0-9a-f]{8,}\b/gi },
  { label: 'raw_s3_uri', pattern: /\bs3:\/\/[^\s|)]+/gi },
  {
    label: 'raw_s3_https_url',
    pattern:
      /\bhttps?:\/\/(?:[a-z0-9.-]+\.s3[.-][a-z0-9-]+\.amazonaws\.com|s3[.-][a-z0-9-]+\.amazonaws\.com|s3\.amazonaws\.com)\/[^\s|)]+/gi,
  },
  {
    label: 'raw_s3_key',
    pattern:
      /\b(?:(?:s3|object|storage)[_-]?key\s*[=:：]\s*\S+|(?:patients?|prescriptions?|reports?|care-reports?|visit-photos?|attachments?|file-assets?|audit-logs?|exports?|bulk-exports?)\/[A-Za-z0-9._~+/-]+)/gi,
  },
  {
    label: 'snapshot_or_recovery_identifier',
    pattern:
      /\b(?:RecoveryPointArn|DBSnapshotIdentifier|DbiResourceId|DBInstanceIdentifier|snapshot_id|recovery_point_id)\s*[=:]\s*\S+|\b(?:snap|rds|cluster-snapshot)-[A-Za-z0-9-]+\b/gi,
  },
  {
    label: 'phone_number',
    pattern:
      /(?<!\d)(?:\+81[-\s]?\d{1,4}[-\s]?\d{1,4}[-\s]?\d{3,4}|0\d{1,4}[-\s]?\d{1,4}[-\s]?\d{3,4}|0\d{9,10})(?!\d)/g,
  },
  { label: 'postal_or_address_value', pattern: /(?:住所|所在地|郵便番号)\s*[:：]\s*\S+/g },
  { label: 'patient_named_value', pattern: /(?:患者名|患者)\s*[:：]?\s*\S+/g },
  {
    label: 'patient_identifier',
    pattern:
      /\b(?:patient[_ -]?id|patient[_ -]?name|mrn|medical[_ -]?record[_ -]?number)\s*[=:：]\s*\S+/gi,
  },
];

export function findUnsafeRecoveryEvidenceLabels(value: string) {
  return UNSAFE_EVIDENCE_PATTERNS.filter(({ pattern }) => {
    pattern.lastIndex = 0;
    return pattern.test(value);
  }).map(({ label }) => label);
}

export function assertSafeRecoveryEvidenceValue(value: string, field: string) {
  const labels = findUnsafeRecoveryEvidenceLabels(value);
  if (labels.length > 0) {
    throw new Error(
      `${field} に復旧証跡へ保存できない値が含まれています: ${Array.from(new Set(labels)).join(', ')}`,
    );
  }
}

export function redactRecoveryEvidenceText(value: string) {
  let redacted = value;
  for (const { label, pattern } of UNSAFE_EVIDENCE_PATTERNS) {
    pattern.lastIndex = 0;
    redacted = redacted.replace(pattern, `[redacted:${label}]`);
  }
  return redacted.replace(/\s+/g, ' ').trim().replaceAll('|', '/');
}
