import { NextResponse } from 'next/server';
import { withAuthContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { prisma } from '@/lib/db/client';
import { buildCommunicationRequestAssignmentWhere } from '@/server/services/communication-request-access';
import { validationError } from '@/lib/api/response';
import { communicationRequestStatusSchema } from '@/lib/validations/communication-request';

type ExportProfile = 'internal' | 'external';

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
  'id',
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

function csvCell(value: string | number | null | undefined) {
  if (value == null) return '';
  return `"${String(value).replace(/"/g, '""')}"`;
}

function parseExportProfile(value: string | null): ExportProfile | null {
  if (!value || value === 'internal') return 'internal';
  if (value === 'external') return 'external';
  return null;
}

function buildFilename(status: string | undefined, profile: ExportProfile) {
  const statusSuffix = status ? `_${status}` : '';
  const profileSuffix = profile === 'external' ? '_external' : '';
  return `communication_requests${statusSuffix}${profileSuffix}.csv`;
}

export const GET = withAuthContext(
  async (req, ctx) => {
    const { searchParams } = new URL(req.url);
    const statusParam = searchParams.get('status') ?? undefined;
    const status = statusParam ? communicationRequestStatusSchema.safeParse(statusParam) : null;
    if (status && !status.success) {
      return validationError('連携依頼ステータスが不正です', {
        status: ['対応していないステータスです'],
      });
    }
    const profile = parseExportProfile(searchParams.get('profile'));
    if (!profile) {
      return validationError('エクスポートプロファイルが不正です', {
        profile: ['internal または external を指定してください'],
      });
    }
    const requestType = searchParams.get('request_type') ?? undefined;
    const assignmentWhere = await buildCommunicationRequestAssignmentWhere({
      db: prisma,
      orgId: ctx.orgId,
      accessContext: ctx,
    });

    const csvRows = await withOrgContext(ctx.orgId, async (tx) => {
      const where = {
        org_id: ctx.orgId,
        ...(status ? { status: status.data } : {}),
        ...(requestType ? { request_type: requestType } : {}),
        ...(assignmentWhere ? { AND: [assignmentWhere] } : {}),
      };

      if (profile === 'external') {
        const requests = await tx.communicationRequest.findMany({
          where,
          orderBy: [{ requested_at: 'desc' }],
          select: {
            id: true,
            request_type: true,
            recipient_role: true,
            related_entity_type: true,
            status: true,
            due_date: true,
            requested_at: true,
            responses: {
              orderBy: [{ responded_at: 'desc' }],
              take: 1,
              select: {
                responded_at: true,
              },
            },
          },
        });

        return requests.map((request) => {
          const latestResponse = request.responses[0] ?? null;
          return [
            csvCell(request.id),
            csvCell(request.request_type),
            csvCell(request.status),
            csvCell(request.recipient_role ?? ''),
            csvCell(request.related_entity_type ?? ''),
            csvCell(request.requested_at.toISOString()),
            csvCell(request.due_date?.toISOString() ?? ''),
            csvCell(latestResponse?.responded_at.toISOString() ?? ''),
            csvCell(request.recipient_role?.includes('FAX') ? 'yes' : ''),
            csvCell('handoff-external-redacted'),
            csvCell(profile),
          ];
        });
      }

      const requests = await tx.communicationRequest.findMany({
        where,
        orderBy: [{ requested_at: 'desc' }],
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
            orderBy: [{ responded_at: 'desc' }],
            take: 1,
            select: {
              responder_name: true,
              responded_at: true,
            },
          },
        },
      });

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

      return requests.map((request) => {
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
          csvCell(request.recipient_role?.includes('FAX') ? 'yes' : ''),
          csvCell('handoff-prep'),
          csvCell(contextSnapshot),
          csvCell(request.content),
        ];
      });
    });

    const header = profile === 'external' ? EXTERNAL_HEADER : INTERNAL_HEADER;
    const csv = [header.join(','), ...csvRows.map((row) => row.join(','))].join('\n');

    const filename = buildFilename(status?.data, profile);

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  },
  {
    permission: 'canReport',
    message: '連携依頼のエクスポート権限がありません',
  },
);
