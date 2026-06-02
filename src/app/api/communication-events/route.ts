import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError } from '@/lib/api/response';
import { parsePaginationParams } from '@/lib/api/pagination';
import { prisma } from '@/lib/db/client';
import { readJsonObjectRequestBody } from '@/lib/api/request-body';
import { z } from 'zod';
import { learnContactProfileFromCommunication } from '@/lib/contact-profiles';
import {
  buildCommunicationEventAssignmentWhere,
  canAccessCommunicationRequestRecord,
} from '@/server/services/communication-request-access';
import type { Prisma } from '@prisma/client';

const createCommunicationEventSchema = z.object({
  patient_id: z.string().optional(),
  case_id: z.string().optional(),
  event_type: z.string().min(1, 'イベントタイプは必須です'),
  channel: z.enum(['email', 'fax', 'phone', 'in_person', 'postal', 'ses']),
  direction: z.enum(['outbound', 'inbound']),
  counterpart_name: z.string().optional(),
  counterpart_contact: z.string().optional(),
  subject: z.string().optional(),
  content: z.string().optional(),
  occurred_at: z.string().datetime().optional(),
});

export const GET = withAuth(
  async (req: AuthenticatedRequest) => {
    const { searchParams } = new URL(req.url);
    const { cursor, limit } = parsePaginationParams(searchParams);

    const patientId = searchParams.get('patient_id') ?? undefined;
    const eventType = searchParams.get('event_type') ?? undefined;

    const assignmentWhere = await buildCommunicationEventAssignmentWhere({
      db: prisma,
      orgId: req.orgId,
      accessContext: req,
    });

    const where: Prisma.CommunicationEventWhereInput = {
      org_id: req.orgId,
      ...(patientId ? { patient_id: patientId } : {}),
      ...(eventType ? { event_type: eventType } : {}),
      ...(assignmentWhere ? { AND: [assignmentWhere] } : {}),
    };

    const events = await prisma.communicationEvent.findMany({
      where,
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { occurred_at: 'desc' },
      select: {
        id: true,
        org_id: true,
        patient_id: true,
        case_id: true,
        event_type: true,
        channel: true,
        direction: true,
        counterpart_name: true,
        counterpart_contact: true,
        subject: true,
        content: true,
        occurred_at: true,
        created_at: true,
        updated_at: true,
      },
    });

    const hasMore = events.length > limit;
    const data = hasMore ? events.slice(0, limit) : events;
    const nextCursor = hasMore ? data[data.length - 1]?.id : undefined;

    return success({ data, hasMore, nextCursor });
  },
  {
    permission: 'canReport',
    message: '連携イベントの閲覧権限がありません',
  },
);

export const POST = withAuth(
  async (req: AuthenticatedRequest) => {
    const payload = await readJsonObjectRequestBody(req);
    if (!payload) return validationError('リクエストボディが不正です');

    const parsed = createCommunicationEventSchema.safeParse(payload);
    if (!parsed.success) {
      return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
    }

    const { occurred_at, ...rest } = parsed.data;

    if (
      !(await canAccessCommunicationRequestRecord({
        db: prisma,
        orgId: req.orgId,
        patientId: rest.patient_id,
        caseId: rest.case_id,
        accessContext: req,
      }))
    ) {
      return validationError('患者またはケースの割当権限がありません');
    }

    const event = await withOrgContext(req.orgId, async (tx) => {
      const created = await tx.communicationEvent.create({
        data: {
          org_id: req.orgId,
          ...(occurred_at ? { occurred_at: new Date(occurred_at) } : {}),
          ...rest,
        },
      });

      await learnContactProfileFromCommunication(tx, {
        orgId: req.orgId,
        counterpartName: created.counterpart_name,
        counterpartContact: created.counterpart_contact,
        channel: created.channel,
        occurredAt: created.occurred_at,
        markSuccess: created.direction === 'outbound',
      });

      return created;
    });

    return success({ data: event }, 201);
  },
  {
    permission: 'canReport',
    message: '連携イベントの作成権限がありません',
  },
);
