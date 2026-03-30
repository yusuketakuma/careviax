import { notFound, success } from '@/lib/api/response';
import { withAuthContext, type AuthRouteContext } from '@/lib/auth/context';
import { prisma } from '@/lib/db/client';

export const GET = withAuthContext<{ id: string }>(async (_req, ctx, routeContext: AuthRouteContext<{ id: string }>) => {
  const { id } = await routeContext.params;

  const professional = await prisma.externalProfessional.findFirst({
    where: { id, org_id: ctx.orgId },
    select: {
      id: true,
      name: true,
      organization_name: true,
    },
  });
  if (!professional) return notFound('他職種が見つかりません');

  const counterpartNames = [
    professional.name,
    professional.organization_name,
  ].filter((value): value is string => Boolean(value));

  const [requests, events] = await Promise.all([
    prisma.communicationRequest.findMany({
      where: {
        org_id: ctx.orgId,
        OR: counterpartNames.map((name) => ({ recipient_name: name })),
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
}, {
  permission: 'canReport',
  message: '連絡履歴の閲覧権限がありません',
});
