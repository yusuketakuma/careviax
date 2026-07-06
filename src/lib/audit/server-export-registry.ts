export const APPROVED_SERVER_EXPORT_SURFACES = {
  audit_logs_csv: {
    endpointPrefix: '/api/audit-logs/export',
    auditEvent: 'audit_logs_export',
    maskingProfile: 'audit_logs_redacted_csv',
    description: '監査ログを残し、redaction_state を含む最小化済みの検索条件全件を出力します。',
  },
  billing_candidates_csv: {
    endpointPrefix: '/api/billing-candidates/export',
    auditEvent: 'billing_candidates_export',
    maskingProfile: 'billing_candidates_claims_csv',
    description: '監査ログを残し、請求候補の検索条件全件を請求出力用プロファイルで出力します。',
  },
  communication_requests_external_csv: {
    endpointPrefix: '/api/communication-requests/export',
    auditEvent: 'communication_requests_export',
    maskingProfile: 'communication_requests_external_redacted_csv',
    description: '監査ログを残し、外部共有向けに PHI を抑制した検索条件全件を出力します。',
  },
} as const;

export type ApprovedServerExportSurfaceId = keyof typeof APPROVED_SERVER_EXPORT_SURFACES;

export type ApprovedServerExportDescriptor = {
  surfaceId: ApprovedServerExportSurfaceId;
  endpoint: `/api/${string}`;
  auditEvent: string;
  maskingProfile: string;
  description: string;
  label?: string;
  disabledReason?: string;
};

function normalizeEndpoint(endpoint: string) {
  const trimmed = endpoint.trim();
  if (!trimmed) return null;
  if (!trimmed.startsWith('/api/') || trimmed.startsWith('//')) return null;
  if (/[\r\n\t]/.test(trimmed)) return null;
  return trimmed;
}

export function buildApprovedServerExportDescriptor(
  surfaceId: ApprovedServerExportSurfaceId,
  endpoint: `/api/${string}`,
  options?: { label?: string; disabledReason?: string },
): ApprovedServerExportDescriptor {
  const surface = APPROVED_SERVER_EXPORT_SURFACES[surfaceId];
  return {
    surfaceId,
    endpoint,
    auditEvent: surface.auditEvent,
    maskingProfile: surface.maskingProfile,
    description: surface.description,
    label: options?.label,
    disabledReason: options?.disabledReason,
  };
}

export function getApprovedServerExportDescriptorProblem(
  descriptor: ApprovedServerExportDescriptor | undefined,
) {
  if (!descriptor) return undefined;
  const surface = APPROVED_SERVER_EXPORT_SURFACES[descriptor.surfaceId];
  if (!surface) return '全件出力の承認済み surface が未登録です';
  const endpoint = normalizeEndpoint(descriptor.endpoint);
  if (!endpoint) return '全件出力のURLが安全な同一アプリ内APIパスではありません';
  if (endpoint !== surface.endpointPrefix && !endpoint.startsWith(`${surface.endpointPrefix}?`)) {
    return '全件出力のURLが承認済み surface と一致しません';
  }
  if (
    descriptor.auditEvent !== surface.auditEvent ||
    descriptor.maskingProfile !== surface.maskingProfile ||
    descriptor.description !== surface.description
  ) {
    return '全件出力の監査・マスキング情報が承認済み surface と一致しません';
  }
  return undefined;
}
