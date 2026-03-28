import { withAuth, type AuthenticatedRequest } from '@/lib/auth/middleware';
import { withOrgContext } from '@/lib/db/rls';
import { success, validationError } from '@/lib/api/response';
import { parsePaginationParams } from '@/lib/api/pagination';
import { prisma } from '@/lib/db/client';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';

const createCommunicationRequestSchema = z.object({
  patient_id: z.string().optional(),
  case_id: z.string().optional(),
  request_type: z.string().min(1, '依頼タイプは必須です'),
  template_key: z.string().optional(),
  recipient_name: z.string().optional(),
  recipient_role: z.string().optional(),
  related_entity_type: z.string().optional(),
  related_entity_id: z.string().optional(),
  context_snapshot: z.record(z.string(), z.unknown()).optional(),
  status: z
    .enum([
      'draft',
      'sent',
      'received',
      'in_progress',
      'responded',
      'closed',
      'escalated',
      'cancelled',
      'expired',
    ])
    .optional(),
  subject: z.string().min(1, '件名は必須です'),
  content: z.string().min(1, '内容は必須です'),
  due_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, '日付形式が不正です（YYYY-MM-DD）')
    .optional(),
});

export const GET = withAuth(async (req: AuthenticatedRequest) => {
  const { searchParams } = new URL(req.url);
  const { cursor, limit } = parsePaginationParams(searchParams);

  const status = searchParams.get('status') ?? undefined;
  const patientId = searchParams.get('patient_id') ?? undefined;
  const relatedEntityType = searchParams.get('related_entity_type') ?? undefined;
  const relatedEntityId = searchParams.get('related_entity_id') ?? undefined;

  const where = {
    org_id: req.orgId,
    ...(status
      ? {
          status: status as
            | 'draft'
            | 'sent'
            | 'received'
            | 'in_progress'
            | 'responded'
            | 'closed'
            | 'escalated'
            | 'cancelled'
            | 'expired',
        }
      : {}),
    ...(patientId ? { patient_id: patientId } : {}),
    ...(relatedEntityType ? { related_entity_type: relatedEntityType } : {}),
    ...(relatedEntityId ? { related_entity_id: relatedEntityId } : {}),
  };

  const requests = await prisma.communicationRequest.findMany({
    where,
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    orderBy: { requested_at: 'desc' },
    select: {
      id: true,
      org_id: true,
      patient_id: true,
      case_id: true,
      request_type: true,
      template_key: true,
      recipient_name: true,
      recipient_role: true,
      related_entity_type: true,
      related_entity_id: true,
      context_snapshot: true,
      status: true,
      subject: true,
      content: true,
      requested_by: true,
      requested_at: true,
      due_date: true,
      created_at: true,
      updated_at: true,
      responses: {
        orderBy: { responded_at: 'desc' },
        take: 1,
        select: {
          id: true,
          responder_name: true,
          responded_at: true,
        },
      },
    },
  });

  const hasMore = requests.length > limit;
  const data = hasMore ? requests.slice(0, limit) : requests;
  const nextCursor = hasMore ? data[data.length - 1]?.id : undefined;

  return success({ data, hasMore, nextCursor });
}, {
  permission: 'canReport',
  message: '連携依頼の閲覧権限がありません',
});

export const POST = withAuth(async (req: AuthenticatedRequest) => {
  const body = await req.json().catch(() => null);
  if (!body) return validationError('リクエストボディが不正です');

  const parsed = createCommunicationRequestSchema.safeParse(body);
  if (!parsed.success) {
    return validationError('入力値が不正です', parsed.error.flatten().fieldErrors);
  }

  const { patient_id, case_id, request_type, subject, content, due_date } =
    parsed.data;
  const {
    template_key,
    recipient_name,
    recipient_role,
    related_entity_type,
    related_entity_id,
    context_snapshot,
    status,
  } = parsed.data;

  const result = await withOrgContext(req.orgId, async (tx) => {
    return tx.communicationRequest.create({
      data: {
        org_id: req.orgId,
        patient_id: patient_id ?? null,
        case_id: case_id ?? null,
        request_type,
        template_key: template_key ?? null,
        recipient_name: recipient_name ?? null,
        recipient_role: recipient_role ?? null,
        related_entity_type: related_entity_type ?? null,
        related_entity_id: related_entity_id ?? null,
        context_snapshot: (context_snapshot as Prisma.InputJsonValue) ?? undefined,
        status: status ?? 'draft',
        subject,
        content,
        requested_by: req.userId,
        due_date: due_date ? new Date(due_date) : null,
      },
    });
  });

  return success({ data: result }, 201);
}, {
  permission: 'canReport',
  message: '連携依頼の作成権限がありません',
});
