import { z } from 'zod';

const idSchema = z.string().trim().min(1).max(200);
const textSchema = z.string().trim().min(1).max(2_000);
const nullableTextSchema = z.string().trim().max(2_000).nullable();
const dateTimeSchema = z.string().datetime({ offset: true });

function uniqueById<T extends { id: string }>(items: T[]) {
  return new Set(items.map((item) => item.id)).size === items.length;
}

const careTeamMemberSchema = z
  .object({
    id: idSchema,
    role: textSchema,
    name: textSchema,
    organization_name: nullableTextSchema,
    is_primary: z.boolean(),
  })
  .strip();

export const externalShareCareTeamResponseSchema = z
  .object({
    data: z.array(careTeamMemberSchema).max(500).refine(uniqueById, 'ケアチームIDが重複しています'),
    meta: z
      .object({
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
  .strip()
  .superRefine(({ data, meta }, ctx) => {
    if (meta.case_id !== null && !meta.cases.some((careCase) => careCase.id === meta.case_id)) {
      ctx.addIssue({
        code: 'custom',
        path: ['meta', 'case_id'],
        message: '選択ケースが一覧にありません',
      });
    }
    const primaryRoles = data.filter((member) => member.is_primary).map((member) => member.role);
    if (new Set(primaryRoles).size !== primaryRoles.length) {
      ctx.addIssue({ code: 'custom', path: ['data'], message: '同一役割の主担当が重複しています' });
    }
  });

const contactPartySchema = z
  .object({
    id: idSchema,
    relation: textSchema,
    name: textSchema,
    organization_name: nullableTextSchema,
    is_primary: z.boolean(),
  })
  .strip();

export const externalShareContactsResponseSchema = z
  .object({
    data: z.array(contactPartySchema).max(500).refine(uniqueById, '連絡先IDが重複しています'),
    meta: z
      .object({
        expected_updated_at: dateTimeSchema,
        version_basis: z.literal('patient_updated_at'),
      })
      .strip(),
  })
  .strip()
  .superRefine(({ data }, ctx) => {
    if (data.filter((contact) => contact.is_primary).length > 1) {
      ctx.addIssue({ code: 'custom', path: ['data'], message: '主連絡先が重複しています' });
    }
  });

const replyMetaSchema = z
  .object({
    id: idSchema,
    responder_name: textSchema,
    responded_at: dateTimeSchema,
  })
  .strip();

const communicationStatusSchema = z.enum([
  'draft',
  'sent',
  'received',
  'in_progress',
  'responded',
  'closed',
  'escalated',
  'cancelled',
  'expired',
]);

export function buildExternalShareRequestsResponseSchema(expectedPatientId: string) {
  const requestSchema = z
    .object({
      id: idSchema,
      patient_id: z.literal(expectedPatientId),
      request_type: z.literal('patient_share_reply_request'),
      recipient_name: nullableTextSchema,
      recipient_role: nullableTextSchema,
      related_entity_type: z.literal('patient'),
      related_entity_id: z.literal(expectedPatientId),
      status: communicationStatusSchema,
      subject: textSchema,
      requested_at: dateTimeSchema,
      responses: z.array(replyMetaSchema).max(1).refine(uniqueById, '返信IDが重複しています'),
    })
    .strip();

  return z
    .object({
      data: z.array(requestSchema).max(500).refine(uniqueById, '連携依頼IDが重複しています'),
      meta: z
        .object({
          limit: z.number().int().positive().max(500),
          has_more: z.boolean(),
          next_cursor: idSchema.nullable(),
        })
        .strip(),
    })
    .strip()
    .superRefine(({ data, meta }, ctx) => {
      if (meta.has_more !== (meta.next_cursor !== null)) {
        ctx.addIssue({ code: 'custom', path: ['meta'], message: 'ページング情報が矛盾しています' });
      }
      for (let index = 1; index < data.length; index += 1) {
        const previous = data[index - 1];
        const current = data[index];
        if (previous && current && previous.requested_at < current.requested_at) {
          ctx.addIssue({
            code: 'custom',
            path: ['data', index],
            message: '連携依頼の並び順が不正です',
          });
        }
      }
    });
}

export function buildExternalShareReplyDetailResponseSchema(args: {
  expectedRequestId: string;
  expectedPatientId: string;
}) {
  return z
    .object({
      data: z
        .object({
          id: z.literal(args.expectedRequestId),
          patient_id: z.literal(args.expectedPatientId),
          request_type: z.literal('patient_share_reply_request'),
          related_entity_type: z.literal('patient'),
          related_entity_id: z.literal(args.expectedPatientId),
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
    .strip()
    .superRefine(({ data }, ctx) => {
      for (let index = 1; index < data.responses.length; index += 1) {
        const previous = data.responses[index - 1];
        const current = data.responses[index];
        if (previous && current && previous.responded_at < current.responded_at) {
          ctx.addIssue({
            code: 'custom',
            path: ['data', 'responses', index],
            message: '返信の並び順が不正です',
          });
        }
      }
    });
}

export function buildExternalShareOverviewResponseSchema(expectedPatientId: string) {
  return z
    .object({
      data: z
        .object({
          id: z.literal(expectedPatientId),
          name: nullableTextSchema.optional(),
          external_shares: z
            .array(
              z
                .object({
                  id: idSchema,
                  granted_to_name: textSchema,
                  expires_at: dateTimeSchema,
                  accessed_at: dateTimeSchema.nullable(),
                })
                .strip(),
            )
            .max(500)
            .refine(uniqueById, '外部共有IDが重複しています'),
          self_reports: z
            .array(
              z
                .object({
                  id: idSchema,
                  subject: textSchema,
                  category: nullableTextSchema.optional(),
                  content: z.string().max(20_000).optional(),
                  created_at: dateTimeSchema,
                  status: textSchema,
                })
                .strip(),
            )
            .max(500)
            .refine(uniqueById, '自己申告IDが重複しています'),
          current_medications: z
            .array(
              z
                .object({
                  drug_name: textSchema,
                  dose: nullableTextSchema,
                  frequency: nullableTextSchema,
                })
                .strip(),
            )
            .max(500)
            .optional(),
          visit_schedules: z
            .array(
              z
                .object({ scheduled_date: dateTimeSchema, schedule_status: nullableTextSchema })
                .strip(),
            )
            .max(500)
            .optional(),
          care_reports: z
            .array(
              z
                .object({ report_type: textSchema, created_at: dateTimeSchema, status: textSchema })
                .strip(),
            )
            .max(500)
            .optional(),
        })
        .strip(),
    })
    .strip();
}

const safeTokenSchema = z
  .string()
  .min(20)
  .max(8_192)
  .regex(/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+){2}$/, '共有tokenが不正です');

export const createExternalShareGrantResponseSchema = z
  .object({
    data: z
      .object({
        token: safeTokenSchema,
        expires_at: dateTimeSchema,
        otp: z
          .string()
          .regex(/^\d{6}$/)
          .optional(),
        otp_delivery: z.enum(['sms', 'manual']),
        otp_delivery_destination: z.string().trim().min(1).max(200).nullable(),
      })
      .strip(),
  })
  .strip()
  .superRefine(({ data }, ctx) => {
    if (data.otp_delivery === 'manual' && data.otp === undefined) {
      ctx.addIssue({ code: 'custom', path: ['data', 'otp'], message: '手動配送OTPがありません' });
    }
    if (data.otp_delivery === 'sms' && data.otp !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['data', 'otp'],
        message: 'SMS配送時にOTPを返せません',
      });
    }
    if (data.otp_delivery_destination === null && data.otp_delivery === 'sms') {
      ctx.addIssue({
        code: 'custom',
        path: ['data', 'otp_delivery_destination'],
        message: 'SMS配送先がありません',
      });
    }
  });

export type ExternalShareOverview = z.infer<
  ReturnType<typeof buildExternalShareOverviewResponseSchema>
>['data'];
export type ExternalShareCareTeamResponse = z.infer<typeof externalShareCareTeamResponseSchema>;
export type ExternalShareContactsResponse = z.infer<typeof externalShareContactsResponseSchema>;
export type ExternalShareRequestsResponse = z.infer<
  ReturnType<typeof buildExternalShareRequestsResponseSchema>
>;
export type ExternalShareReplyDetailResponse = z.infer<
  ReturnType<typeof buildExternalShareReplyDetailResponseSchema>
>;
