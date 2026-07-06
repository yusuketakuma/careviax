import { createHash } from 'node:crypto';
import { unstable_rethrow } from 'next/navigation';
import { NextResponse } from 'next/server';
import { withAuthContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { prisma } from '@/lib/db/client';
import {
  buildCommunicationRequestAssignmentWhere,
  canAccessCareReportCommunication,
} from '@/server/services/communication-request-access';
import { error, forbidden, internalError, validationError } from '@/lib/api/response';
import { withSensitiveNoStore } from '@/lib/api/sensitive-response';
import {
  communicationRequestStatusSchema,
  optionalTrimmedSearchParam,
} from '@/lib/validations/communication-request';
import { recordDataExportAudit } from '@/server/services/export-audit';
import { quotedCsvCell as csvCell } from '@/lib/csv/safe-csv';
import type { ApprovedServerExportSurfaceId } from '@/lib/audit/server-export-registry';

type ExportProfile = 'internal' | 'external';

const EXPORT_SURFACE_BY_PROFILE = {
  external: 'communication_requests_external_csv',
  internal: 'communication_requests_internal_csv',
} as const satisfies Record<ExportProfile, ApprovedServerExportSurfaceId>;

const INTERNAL_HEADER = [
  'id',
  'patient_id',
  'patient_name',
  'request_type',
  'status',
  'subject',
  'recipient_name',
  'recipient_role',
  'related_entity_type',
  'related_entity_id',
  'requested_at',
  'due_date',
  'latest_responder_name',
  'latest_responded_at',
  'fax_ready',
  'nsips_csv_profile',
  'context_snapshot',
  'content',
] as const;

const EXTERNAL_HEADER = [
  'external_row_id',
  'request_type',
  'status',
  'recipient_role',
  'related_entity_type',
  'requested_at',
  'due_date',
  'latest_responded_at',
  'fax_ready',
  'nsips_csv_profile',
  'redaction_profile',
] as const;

const UTF8_BOM = '\uFEFF';
const COMMUNICATION_REQUEST_EXPORT_MAX_ROWS = 1000;

class CommunicationRequestExportAuditError extends Error {
  constructor(readonly originalError: unknown) {
    super('Communication request export audit failed');
  }
}

function hashExportScopeId(value: string) {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

function parseExportProfile(value: string | null): ExportProfile | null {
  if (!value) return 'external';
  if (value === 'internal') return 'internal';
  if (value === 'external') return 'external';
  return null;
}

function filenameFilterToken(value: string) {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return slug || hashExportScopeId(value);
}

function buildFilename(args: {
  status: string | undefined;
  requestType: string | undefined;
  profile: ExportProfile;
}) {
  const suffixes = [
    args.status,
    args.requestType ? `type-${filenameFilterToken(args.requestType)}` : undefined,
    args.profile === 'external' ? 'external' : undefined,
  ].filter((suffix): suffix is string => Boolean(suffix));
  return `communication_requests${suffixes.length > 0 ? `_${suffixes.join('_')}` : ''}.csv`;
}

function buildExportAuditMetadata(args: {
  requestIds: string[];
  patientIds?: Array<string | null>;
  exportSurfaceId: ApprovedServerExportSurfaceId;
}) {
  const requestIds = Array.from(new Set(args.requestIds.filter(Boolean))).sort();
  const patientIds = Array.from(
    new Set((args.patientIds ?? []).filter((id): id is string => Boolean(id))),
  ).sort();
  return {
    export_surface_id: args.exportSurfaceId,
    export_snapshot_id: hashExportScopeId(requestIds.join('\n')),
    exported_request_id_hashes: requestIds.map(hashExportScopeId).slice(0, 100),
    exported_request_count: requestIds.length,
    exported_request_id_hashes_truncated: requestIds.length > 100,
    exported_patient_id_hashes: patientIds.map(hashExportScopeId).slice(0, 100),
    exported_patient_count: patientIds.length,
    exported_patient_id_hashes_truncated: patientIds.length > 100,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function textValue(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function hasFaxChannel(value: unknown) {
  if (!Array.isArray(value)) return false;
  return value.some((item) => textValue(item) === 'fax');
}

function resolveFaxReady(contextSnapshot: unknown) {
  if (!isRecord(contextSnapshot)) return '';
  if (hasFaxChannel(contextSnapshot.recommended_channels)) return 'yes';
  if (textValue(contextSnapshot.preferred_contact_method) === 'fax') return 'yes';
  if (textValue(contextSnapshot.channel) === 'fax') return 'yes';
  if (textValue(contextSnapshot.delivery_channel) === 'fax') return 'yes';
  return '';
}

const authenticatedGET = withAuthContext(
  async (req, ctx) => {
    const { searchParams } = new URL(req.url);
    const statusParam = optionalTrimmedSearchParam(searchParams.get('status'));
    if (searchParams.has('status') && !statusParam) {
      return withSensitiveNoStore(
        validationError('連携依頼ステータスが不正です', {
          status: ['ステータスを指定してください'],
        }),
      );
    }
    const status = statusParam ? communicationRequestStatusSchema.safeParse(statusParam) : null;
    if (status && !status.success) {
      return withSensitiveNoStore(
        validationError('連携依頼ステータスが不正です', {
          status: ['対応していないステータスです'],
        }),
      );
    }
    const profile = parseExportProfile(searchParams.get('profile'));
    if (!profile) {
      return withSensitiveNoStore(
        validationError('エクスポートプロファイルが不正です', {
          profile: ['internal または external を指定してください'],
        }),
      );
    }
    const requestType = optionalTrimmedSearchParam(searchParams.get('request_type'));
    if (searchParams.has('request_type') && !requestType) {
      return withSensitiveNoStore(
        validationError('連携依頼種別が不正です', {
          request_type: ['依頼種別を指定してください'],
        }),
      );
    }
    const canReadCareReportOutput = canAccessCareReportCommunication(ctx.role);
    if (profile === 'internal' && !canReadCareReportOutput) {
      return withSensitiveNoStore(forbidden('内部向け連携依頼エクスポートの権限がありません'));
    }
    if (profile === 'internal' && !status?.data && !requestType) {
      return withSensitiveNoStore(
        validationError('内部向けエクスポートには status または request_type の指定が必要です', {
          status: ['status または request_type を指定してください'],
          request_type: ['status または request_type を指定してください'],
        }),
      );
    }

    let exportResult: { rows: string[][] } | { error: 'too_many_rows' } | null = null;
    try {
      const assignmentWhere = await buildCommunicationRequestAssignmentWhere({
        db: prisma,
        orgId: ctx.orgId,
        accessContext: ctx,
      });

      exportResult = await withOrgContext(
        ctx.orgId,
        async (tx) => {
          const where = {
            org_id: ctx.orgId,
            ...(status ? { status: status.data } : {}),
            ...(requestType ? { request_type: requestType } : {}),
            ...(!canReadCareReportOutput ? { NOT: { related_entity_type: 'care_report' } } : {}),
            ...(assignmentWhere ? { AND: [assignmentWhere] } : {}),
          };

          if (profile === 'external') {
            const requests = await tx.communicationRequest.findMany({
              where,
              orderBy: [{ requested_at: 'desc' }, { id: 'desc' }],
              take: COMMUNICATION_REQUEST_EXPORT_MAX_ROWS + 1,
              select: {
                id: true,
                request_type: true,
                recipient_role: true,
                related_entity_type: true,
                status: true,
                due_date: true,
                requested_at: true,
                context_snapshot: true,
                responses: {
                  orderBy: [{ responded_at: 'desc' }, { id: 'desc' }],
                  take: 1,
                  select: {
                    responded_at: true,
                  },
                },
              },
            });
            if (requests.length > COMMUNICATION_REQUEST_EXPORT_MAX_ROWS) {
              return { error: 'too_many_rows' as const };
            }

            const rows = requests.map((request) => {
              const latestResponse = request.responses[0] ?? null;
              return [
                csvCell(hashExportScopeId(request.id)),
                csvCell(request.request_type),
                csvCell(request.status),
                csvCell(request.recipient_role ?? ''),
                csvCell(request.related_entity_type ?? ''),
                csvCell(request.requested_at.toISOString()),
                csvCell(request.due_date?.toISOString() ?? ''),
                csvCell(latestResponse?.responded_at.toISOString() ?? ''),
                csvCell(resolveFaxReady(request.context_snapshot)),
                csvCell('handoff-external-redacted'),
                csvCell(profile),
              ];
            });
            try {
              await recordDataExportAudit(tx, {
                orgId: ctx.orgId,
                actorId: ctx.userId,
                targetType: 'communication_request',
                format: 'csv',
                recordCount: rows.length,
                filters: {
                  status: status?.data ?? null,
                  request_type: requestType ?? null,
                  profile,
                  redaction_profile: 'external',
                  care_report_rows_excluded: !canReadCareReportOutput,
                },
                metadata: buildExportAuditMetadata({
                  requestIds: requests.map((request) => request.id),
                  exportSurfaceId: EXPORT_SURFACE_BY_PROFILE.external,
                }),
                ipAddress: ctx.ipAddress,
                userAgent: ctx.userAgent,
              });
            } catch (cause) {
              throw new CommunicationRequestExportAuditError(cause);
            }
            return { rows };
          }

          const requests = await tx.communicationRequest.findMany({
            where,
            orderBy: [{ requested_at: 'desc' }, { id: 'desc' }],
            take: COMMUNICATION_REQUEST_EXPORT_MAX_ROWS + 1,
            select: {
              id: true,
              patient_id: true,
              request_type: true,
              recipient_name: true,
              recipient_role: true,
              related_entity_type: true,
              related_entity_id: true,
              status: true,
              subject: true,
              content: true,
              due_date: true,
              requested_at: true,
              context_snapshot: true,
              responses: {
                orderBy: [{ responded_at: 'desc' }, { id: 'desc' }],
                take: 1,
                select: {
                  responder_name: true,
                  responded_at: true,
                },
              },
            },
          });
          if (requests.length > COMMUNICATION_REQUEST_EXPORT_MAX_ROWS) {
            return { error: 'too_many_rows' as const };
          }

          const patientIds = Array.from(
            new Set(
              requests
                .map((request) => request.patient_id)
                .filter((value): value is string => typeof value === 'string' && value.length > 0),
            ),
          );

          const patients =
            patientIds.length === 0
              ? []
              : await tx.patient.findMany({
                  where: {
                    org_id: ctx.orgId,
                    id: { in: patientIds },
                  },
                  select: {
                    id: true,
                    name: true,
                  },
                });

          const patientById = new Map(patients.map((patient) => [patient.id, patient.name]));

          const rows = requests.map((request) => {
            const latestResponse = request.responses[0] ?? null;
            const contextSnapshot =
              request.context_snapshot && typeof request.context_snapshot === 'object'
                ? JSON.stringify(request.context_snapshot)
                : '';
            return [
              csvCell(request.id),
              csvCell(request.patient_id ?? ''),
              csvCell(request.patient_id ? (patientById.get(request.patient_id) ?? '') : ''),
              csvCell(request.request_type),
              csvCell(request.status),
              csvCell(request.subject),
              csvCell(request.recipient_name ?? ''),
              csvCell(request.recipient_role ?? ''),
              csvCell(request.related_entity_type ?? ''),
              csvCell(request.related_entity_id ?? ''),
              csvCell(request.requested_at.toISOString()),
              csvCell(request.due_date?.toISOString() ?? ''),
              csvCell(latestResponse?.responder_name ?? ''),
              csvCell(latestResponse?.responded_at.toISOString() ?? ''),
              csvCell(resolveFaxReady(request.context_snapshot)),
              csvCell('handoff-prep'),
              csvCell(contextSnapshot),
              csvCell(request.content),
            ];
          });
          try {
            await recordDataExportAudit(tx, {
              orgId: ctx.orgId,
              actorId: ctx.userId,
              targetType: 'communication_request',
              format: 'csv',
              recordCount: rows.length,
              filters: {
                status: status?.data ?? null,
                request_type: requestType ?? null,
                profile,
                redaction_profile: 'internal',
                care_report_rows_excluded: !canReadCareReportOutput,
              },
              metadata: buildExportAuditMetadata({
                requestIds: requests.map((request) => request.id),
                patientIds: requests.map((request) => request.patient_id),
                exportSurfaceId: EXPORT_SURFACE_BY_PROFILE.internal,
              }),
              ipAddress: ctx.ipAddress,
              userAgent: ctx.userAgent,
            });
          } catch (cause) {
            throw new CommunicationRequestExportAuditError(cause);
          }
          return { rows };
        },
        { requestContext: ctx },
      );
    } catch (cause) {
      if (!(cause instanceof CommunicationRequestExportAuditError)) {
        return withSensitiveNoStore(
          error('COMMUNICATION_REQUEST_EXPORT_FAILED', '連携依頼のエクスポートに失敗しました', 500),
        );
      }
      return withSensitiveNoStore(
        error(
          'COMMUNICATION_REQUEST_EXPORT_AUDIT_FAILED',
          '連携依頼のエクスポート監査を記録できませんでした',
          500,
        ),
      );
    }
    if (!exportResult || !('rows' in exportResult)) {
      if (exportResult && 'error' in exportResult && exportResult.error === 'too_many_rows') {
        return withSensitiveNoStore(
          validationError('エクスポート対象が多すぎます。条件を絞り込んでください', {
            max_rows: COMMUNICATION_REQUEST_EXPORT_MAX_ROWS,
          }),
        );
      }
      return withSensitiveNoStore(
        error(
          'COMMUNICATION_REQUEST_EXPORT_AUDIT_FAILED',
          '連携依頼のエクスポート監査を記録できませんでした',
          500,
        ),
      );
    }
    const csvRows = exportResult.rows;

    const header = profile === 'external' ? EXTERNAL_HEADER : INTERNAL_HEADER;
    const csv = [header.join(','), ...csvRows.map((row) => row.join(','))].join('\n');

    const filename = buildFilename({ status: status?.data, requestType, profile });

    return withSensitiveNoStore(
      new NextResponse(`${UTF8_BOM}${csv}`, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${filename}"`,
        },
      }),
    );
  },
  {
    permission: 'canReport',
    message: '連携依頼のエクスポート権限がありません',
  },
);

export const GET: typeof authenticatedGET = async (req, routeContext) => {
  try {
    return withSensitiveNoStore(await authenticatedGET(req, routeContext));
  } catch (err) {
    unstable_rethrow(err);
    return withSensitiveNoStore(internalError());
  }
};
