import { z } from 'zod';
import { communicationChannelSchema } from '@/lib/validations/communication-channel';

export type CareReportSendRecipient = {
  channel: z.infer<typeof communicationChannelSchema>;
  recipient_name: string;
  recipient_contact: string;
  recipient_role: string;
};

export type CareReportSendFormErrors = Partial<
  Record<keyof CareReportSendRecipient | 'expected_updated_at' | 'safety_ack', string>
>;

const RECIPIENT_ROLE_ALIASES: Record<string, string> = {
  doctor: 'physician',
  prescriber: 'physician',
  visiting_nurse: 'nurse',
  facility: 'facility_staff',
};

const ALLOWED_RECIPIENT_ROLES = new Set([
  'physician',
  'care_manager',
  'nurse',
  'facility_staff',
  'family',
]);

export function normalizeCareReportRecipientRole(value: string) {
  const normalized = value.trim();
  return RECIPIENT_ROLE_ALIASES[normalized] ?? normalized;
}

export const careReportRecipientSchema = z
  .object({
    channel: communicationChannelSchema,
    recipient_name: z.string().trim().min(1, '送付先氏名は必須です'),
    recipient_contact: z.string().trim().min(1, '送付先連絡先は必須です'),
    recipient_role: z
      .string()
      .trim()
      .min(1, '送付先区分は必須です')
      .transform(normalizeCareReportRecipientRole)
      .refine((value) => ALLOWED_RECIPIENT_ROLES.has(value), '送付先区分が不正です'),
  })
  .superRefine((value, ctx) => {
    if (
      (value.channel === 'email' || value.channel === 'ses') &&
      !z.string().email().safeParse(value.recipient_contact).success
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'メール送信時は送付先連絡先にメールアドレスを指定してください',
        path: ['recipient_contact'],
      });
    }
  });

const reportVersionSchema = z
  .string({ error: '報告書の版情報は必須です' })
  .datetime('報告書の版情報が不正です');

export const careReportSingleSendSchema = careReportRecipientSchema.and(
  z.object({
    expected_updated_at: reportVersionSchema,
    safety_ack: z.literal(true),
  }),
);

export const careReportBulkSendSchema = z.object({
  recipients: z.array(careReportRecipientSchema).min(1, '送付先を1件以上選択してください'),
  expected_updated_at: reportVersionSchema,
  safety_ack: z.literal(true),
});

export function normalizeCareReportSendPayload(
  payload: Record<string, unknown>,
):
  | { ok: true; recipients: CareReportSendRecipient[]; expectedUpdatedAt: Date }
  | { ok: false; details: Record<string, string[] | undefined> } {
  if ('recipients' in payload) {
    const parsed = careReportBulkSendSchema.safeParse(payload);
    if (!parsed.success) {
      return { ok: false, details: parsed.error.flatten().fieldErrors };
    }
    return {
      ok: true,
      recipients: parsed.data.recipients,
      expectedUpdatedAt: new Date(parsed.data.expected_updated_at),
    };
  }

  const parsed = careReportSingleSendSchema.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, details: parsed.error.flatten().fieldErrors };
  }
  return {
    ok: true,
    expectedUpdatedAt: new Date(parsed.data.expected_updated_at),
    recipients: [
      {
        channel: parsed.data.channel,
        recipient_name: parsed.data.recipient_name,
        recipient_contact: parsed.data.recipient_contact,
        recipient_role: parsed.data.recipient_role,
      },
    ],
  };
}

export function validateCareReportSendRecipientForm(input: {
  channel: string;
  recipient_name: string;
  recipient_contact: string;
  recipient_role: string;
}):
  | { ok: true; recipient: CareReportSendRecipient }
  | { ok: false; errors: CareReportSendFormErrors } {
  const parsed = careReportRecipientSchema.safeParse(input);
  if (parsed.success) return { ok: true, recipient: parsed.data };

  const fieldErrors = parsed.error.flatten().fieldErrors;
  return {
    ok: false,
    errors: {
      channel: fieldErrors.channel?.[0],
      recipient_name: fieldErrors.recipient_name?.[0],
      recipient_contact: fieldErrors.recipient_contact?.[0],
      recipient_role: fieldErrors.recipient_role?.[0],
    },
  };
}
