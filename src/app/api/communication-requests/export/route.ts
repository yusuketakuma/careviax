import { NextResponse } from 'next/server';
import { withAuthContext } from '@/lib/auth/context';
import { withOrgContext } from '@/lib/db/rls';
import { prisma } from '@/lib/db/client';
import { buildCommunicationRequestAssignmentWhere } from '@/server/services/communication-request-access';
import { validationError } from '@/lib/api/response';
import { communicationRequestStatusSchema } from '@/lib/validations/communication-request';

function csvCell(value: string | number | null | undefined) {
  if (value == null) return '';
  return `"${String(value).replace(/"/g, '""')}"`;
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
    const requestType = searchParams.get('request_type') ?? undefined;
    const assignmentWhere = await buildCommunicationRequestAssignmentWhere({
      db: prisma,
      orgId: ctx.orgId,
      accessContext: ctx,
    });

    const rows = await withOrgContext(ctx.orgId, async (tx) => {
      const requests = await tx.communicationRequest.findMany({
        where: {
          org_id: ctx.orgId,
          ...(status ? { status: status.data } : {}),
          ...(requestType ? { request_type: requestType } : {}),
          ...(assignmentWhere ? { AND: [assignmentWhere] } : {}),
        },
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
        return {
          id: request.id,
          patient_id: request.patient_id ?? '',
          patient_name: request.patient_id ? (patientById.get(request.patient_id) ?? '') : '',
          request_type: request.request_type,
          status: request.status,
          subject: request.subject,
          recipient_name: request.recipient_name ?? '',
          recipient_role: request.recipient_role ?? '',
          related_entity_type: request.related_entity_type ?? '',
          related_entity_id: request.related_entity_id ?? '',
          requested_at: request.requested_at.toISOString(),
          due_date: request.due_date?.toISOString() ?? '',
          latest_responder_name: latestResponse?.responder_name ?? '',
          latest_responded_at: latestResponse?.responded_at.toISOString() ?? '',
          fax_ready: request.recipient_role?.includes('FAX') ? 'yes' : '',
          nsips_csv_profile: 'handoff-prep',
          context_snapshot: contextSnapshot,
          content: request.content,
        };
      });
    });

    const header = [
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
    ].join(',');

    const csv = [
      header,
      ...rows.map((row) =>
        [
          csvCell(row.id),
          csvCell(row.patient_id),
          csvCell(row.patient_name),
          csvCell(row.request_type),
          csvCell(row.status),
          csvCell(row.subject),
          csvCell(row.recipient_name),
          csvCell(row.recipient_role),
          csvCell(row.related_entity_type),
          csvCell(row.related_entity_id),
          csvCell(row.requested_at),
          csvCell(row.due_date),
          csvCell(row.latest_responder_name),
          csvCell(row.latest_responded_at),
          csvCell(row.fax_ready),
          csvCell(row.nsips_csv_profile),
          csvCell(row.context_snapshot),
          csvCell(row.content),
        ].join(','),
      ),
    ].join('\n');

    const filename = status
      ? `communication_requests_${status.data}.csv`
      : 'communication_requests.csv';

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
