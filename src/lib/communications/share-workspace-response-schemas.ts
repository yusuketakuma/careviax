import { z } from 'zod';
import { COMMUNICATION_REQUEST_STATUSES } from './request-status';

const idSchema = z.string().trim().min(1).max(200);
const textSchema = z.string().trim().min(1).max(2_000);
const nullableTextSchema = z.string().trim().max(2_000).nullable();
const dateTimeSchema = z.string().datetime({ offset: true });

function uniqueById<T extends { id: string }>(items: readonly T[]) {
  return new Set(items.map((item) => item.id)).size === items.length;
}

const careTeamMemberProviderSchema = z
  .object({
    id: idSchema,
    role: textSchema,
    name: textSchema,
    organization_name: nullableTextSchema,
    is_primary: z.boolean(),
  })
  .strip();

export function buildShareCareTeamResponseSchema(args: {
  expectedPatientId: string;
  expectedCaseId?: string | null;
}) {
  return z
    .object({
      data: z
        .array(careTeamMemberProviderSchema)
        .max(500)
        .refine(uniqueById, 'ケアチームIDが重複しています'),
      meta: z
        .object({
          patient_id: z.literal(args.expectedPatientId),
          case_id: idSchema.nullable(),
          cases: z
            .array(
              z
                .object({
                  id: idSchema,
                  status: textSchema,
                })
                .strip(),
            )
            .max(500)
            .refine(uniqueById, 'ケースIDが重複しています'),
        })
        .strip(),
    })
    .strict()
    .superRefine(({ data, meta }, ctx) => {
      if (meta.case_id !== null && !meta.cases.some((careCase) => careCase.id === meta.case_id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['meta', 'case_id'],
          message: '選択ケースが一覧にありません',
        });
      }
      if (args.expectedCaseId !== undefined && meta.case_id !== args.expectedCaseId) {
        ctx.addIssue({
          code: 'custom',
          path: ['meta', 'case_id'],
          message: '要求したケースと選択ケースが一致しません',
        });
      }
      const primaryRoles = data.filter((member) => member.is_primary).map((member) => member.role);
      if (new Set(primaryRoles).size !== primaryRoles.length) {
        ctx.addIssue({
          code: 'custom',
          path: ['data'],
          message: '同一役割の主担当が重複しています',
        });
      }
    })
    .transform(({ data }) => ({
      data: data.map(({ id, ...member }) => {
        void id;
        return member;
      }),
    }));
}

const contactPartyProviderSchema = z
  .object({
    id: idSchema,
    relation: textSchema,
    name: textSchema,
    organization_name: nullableTextSchema,
    is_primary: z.boolean(),
  })
  .strip();

export function buildShareContactsResponseSchema(expectedPatientId: string) {
  return z
    .object({
      data: z
        .array(contactPartyProviderSchema)
        .max(500)
        .refine(uniqueById, '連絡先IDが重複しています'),
      meta: z
        .object({
          patient_id: z.literal(expectedPatientId),
          expected_updated_at: dateTimeSchema,
          version_basis: z.literal('patient_updated_at'),
        })
        .strip(),
    })
    .strict()
    .superRefine(({ data }, ctx) => {
      if (data.filter((contact) => contact.is_primary).length > 1) {
        ctx.addIssue({ code: 'custom', path: ['data'], message: '主連絡先が重複しています' });
      }
    })
    .transform(({ data }) => ({
      data: data.map(({ id, ...contact }) => {
        void id;
        return contact;
      }),
    }));
}

const replyMetaSchema = z
  .object({
    id: idSchema,
    responder_name: textSchema,
    responded_at: dateTimeSchema,
  })
  .strip();

const communicationStatusSchema = z.enum(COMMUNICATION_REQUEST_STATUSES);

export type ShareCommunicationRequestScope = {
  expectedPatientId: string;
  expectedRequestType: 'care_report_reply_request' | 'patient_share_reply_request';
  expectedRelatedEntityType: 'care_report' | 'patient';
  expectedRelatedEntityId: string;
};

export function buildShareCommunicationRequestItemSchema(scope: ShareCommunicationRequestScope) {
  return z
    .object({
      id: idSchema,
      patient_id: z.literal(scope.expectedPatientId),
      request_type: z.literal(scope.expectedRequestType),
      recipient_name: nullableTextSchema,
      recipient_role: nullableTextSchema,
      related_entity_type: z.literal(scope.expectedRelatedEntityType),
      related_entity_id: z.literal(scope.expectedRelatedEntityId),
      status: communicationStatusSchema,
      subject: textSchema,
      requested_at: dateTimeSchema,
      responses: z.array(replyMetaSchema).max(1).refine(uniqueById, '返信IDが重複しています'),
    })
    .strip()
    .transform(({ id, recipient_role, status, requested_at, responses }) => ({
      id,
      recipient_role,
      status,
      requested_at,
      responses: responses.map(({ responded_at }) => ({ responded_at })),
    }));
}

export function buildShareReplyDetailResponseSchema(
  scope: ShareCommunicationRequestScope & { expectedRequestId: string },
) {
  return z
    .object({
      data: z
        .object({
          id: z.literal(scope.expectedRequestId),
          patient_id: z.literal(scope.expectedPatientId),
          request_type: z.literal(scope.expectedRequestType),
          related_entity_type: z.literal(scope.expectedRelatedEntityType),
          related_entity_id: z.literal(scope.expectedRelatedEntityId),
          responses: z
            .array(
              z
                .object({
                  id: idSchema,
                  responder_name: textSchema,
                  content: z.string().trim().min(1).max(20_000),
                  responded_at: dateTimeSchema,
                })
                .strip(),
            )
            .max(500)
            .refine(uniqueById, '返信IDが重複しています'),
        })
        .strip(),
    })
    .strict()
    .superRefine(({ data }, ctx) => {
      for (let index = 1; index < data.responses.length; index += 1) {
        const previous = data.responses[index - 1];
        const current = data.responses[index];
        if (
          previous &&
          current &&
          (Date.parse(previous.responded_at) < Date.parse(current.responded_at) ||
            (Date.parse(previous.responded_at) === Date.parse(current.responded_at) &&
              previous.id < current.id))
        ) {
          ctx.addIssue({
            code: 'custom',
            path: ['data', 'responses', index],
            message: '返信の並び順が不正です',
          });
        }
      }
    })
    .transform(({ data }) => ({ data: { id: data.id, responses: data.responses.slice(0, 1) } }));
}

export type ShareCareTeamResponse = z.infer<ReturnType<typeof buildShareCareTeamResponseSchema>>;
export type ShareContactsResponse = z.infer<ReturnType<typeof buildShareContactsResponseSchema>>;
export type ShareCommunicationRequest = z.infer<
  ReturnType<typeof buildShareCommunicationRequestItemSchema>
>;
export type ShareReplyDetailResponse = z.infer<
  ReturnType<typeof buildShareReplyDetailResponseSchema>
>;
