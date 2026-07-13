import { z } from 'zod';
import { buildPatientArchiveSummary } from '@/lib/patient/archive-summary';

const idSchema = z.string().trim().min(1).max(200);
const textSchema = z.string().trim().min(1).max(2_000);
const nullableTextSchema = z.string().trim().max(2_000).nullable();
const dateTimeSchema = z.string().datetime({ offset: true });

function uniqueById<T extends { id: string }>(items: T[]) {
  return new Set(items.map((item) => item.id)).size === items.length;
}

export function buildExternalShareOverviewResponseSchema(expectedPatientId: string) {
  return z
    .object({
      data: z
        .object({
          id: z.literal(expectedPatientId),
          name: nullableTextSchema.optional(),
          archived_at: dateTimeSchema.nullable(),
          patient_share_permissions: z
            .object({
              can_create_external_share: z.boolean(),
              can_create_reply_request: z.boolean(),
            })
            .strip(),
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
                .object({
                  report_type: textSchema,
                  created_at: dateTimeSchema,
                  status: textSchema,
                  has_pdf: z.boolean(),
                })
                .strip(),
            )
            .max(500)
            .optional(),
        })
        .strip(),
    })
    .strip()
    .transform(({ data }) => {
      const { archived_at, ...overview } = data;
      return {
        data: {
          ...overview,
          archive: buildPatientArchiveSummary(archived_at),
        },
      };
    });
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
