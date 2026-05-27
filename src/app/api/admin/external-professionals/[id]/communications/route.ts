import { notFound, success } from '@/lib/api/response';
import { withAuthContext, type AuthRouteContext } from '@/lib/auth/context';
import { prisma } from '@/lib/db/client';
import { buildCareCaseAssignmentWhere } from '@/lib/auth/visit-schedule-access';
import type { Prisma } from '@prisma/client';

function buildCommunicationRequestAssignmentWhere(args: {
  caseIds: string[];
  patientIds: string[];
}): Prisma.CommunicationRequestWhereInput {
  return {
    OR: [
      { case_id: { in: args.caseIds } },
      { AND: [{ case_id: null }, { patient_id: { in: args.patientIds } }] },
      { related_entity_type: 'case', related_entity_id: { in: args.caseIds } },
      { related_entity_type: 'patient', related_entity_id: { in: args.patientIds } },
    ],
  };
}

function buildCommunicationEventAssignmentWhere(args: {
  caseIds: string[];
  patientIds: string[];
}): Prisma.CommunicationEventWhereInput {
  return {
    OR: [
      { case_id: { in: args.caseIds } },
      { AND: [{ case_id: null }, { patient_id: { in: args.patientIds } }] },
    ],
  };
}

export const GET = withAuthContext<{ id: string }>(
  async (_req, ctx, routeContext: AuthRouteContext<{ id: string }>) => {
    const { id } = await routeContext.params;
    const assignmentWhere = buildCareCaseAssignmentWhere({ userId: ctx.userId, role: ctx.role });

    const professional = await prisma.externalProfessional.findFirst({
      where: { id, org_id: ctx.orgId },
      select: {
        id: true,
        name: true,
        organization_name: true,
      },
    });
    if (!professional) return notFound('他職種が見つかりません');

    const counterpartNames = [professional.name, professional.organization_name].filter(
      (value): value is string => Boolean(value),
    );
    const assignedLinks = assignmentWhere
      ? await prisma.careTeamLink.findMany({
          where: {
            org_id: ctx.orgId,
            external_professional_id: id,
            case_: assignmentWhere,
          },
          select: {
            case_id: true,
            case_: {
              select: {
                patient_id: true,
              },
            },
          },
        })
      : [];
    const assignedCaseIds = assignedLinks.map((link) => link.case_id);
    const assignedPatientIds = Array.from(
      new Set(assignedLinks.map((link) => link.case_.patient_id)),
    );
    const requestAssignmentWhere = assignmentWhere
      ? buildCommunicationRequestAssignmentWhere({
          caseIds: assignedCaseIds,
          patientIds: assignedPatientIds,
        })
      : null;
    const eventAssignmentWhere = assignmentWhere
      ? buildCommunicationEventAssignmentWhere({
          caseIds: assignedCaseIds,
          patientIds: assignedPatientIds,
        })
      : null;

    const [requests, events] = await Promise.all([
      prisma.communicationRequest.findMany({
        where: {
          org_id: ctx.orgId,
          OR: counterpartNames.map((name) => ({ recipient_name: name })),
          ...(requestAssignmentWhere ? { AND: [requestAssignmentWhere] } : {}),
        },
        orderBy: { requested_at: 'desc' },
        take: 20,
        select: {
          id: true,
          request_type: true,
          recipient_name: true,
          recipient_role: true,
          subject: true,
          status: true,
          requested_at: true,
        },
      }),
      prisma.communicationEvent.findMany({
        where: {
          org_id: ctx.orgId,
          OR: counterpartNames.map((name) => ({ counterpart_name: name })),
          ...(eventAssignmentWhere ? { AND: [eventAssignmentWhere] } : {}),
        },
        orderBy: { occurred_at: 'desc' },
        take: 20,
        select: {
          id: true,
          event_type: true,
          channel: true,
          direction: true,
          counterpart_name: true,
          subject: true,
          occurred_at: true,
        },
      }),
    ]);

    return success({
      data: {
        requests: requests.map((item) => ({
          id: item.id,
          kind: 'request',
          request_type: item.request_type,
          recipient_name: item.recipient_name,
          recipient_role: item.recipient_role,
          subject: item.subject,
          status: item.status,
          occurred_at: item.requested_at.toISOString(),
        })),
        events: events.map((item) => ({
          id: item.id,
          kind: 'event',
          event_type: item.event_type,
          channel: item.channel,
          direction: item.direction,
          counterpart_name: item.counterpart_name,
          subject: item.subject,
          occurred_at: item.occurred_at.toISOString(),
        })),
      },
    });
  },
  {
    permission: 'canReport',
    message: '連絡履歴の閲覧権限がありません',
  },
);
