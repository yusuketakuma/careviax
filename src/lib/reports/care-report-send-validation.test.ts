import { describe, expect, it } from 'vitest';
import {
  normalizeCareReportSendPayload,
  validateCareReportSendRecipientForm,
} from './care-report-send-validation';

describe('care-report-send-validation', () => {
  it('normalizes recipient role aliases through the shared send schema', () => {
    expect(
      normalizeCareReportSendPayload({
        channel: 'fax',
        recipient_name: '山田 医師',
        recipient_contact: '03-1111-2222',
        recipient_role: 'doctor',
        expected_updated_at: '2026-05-12T00:00:00.000Z',
        safety_ack: true,
      }),
    ).toEqual({
      ok: true,
      expectedUpdatedAt: new Date('2026-05-12T00:00:00.000Z'),
      recipients: [
        {
          channel: 'fax',
          recipient_name: '山田 医師',
          recipient_contact: '03-1111-2222',
          recipient_role: 'physician',
        },
      ],
    });
  });

  it('requires the current report version for send payloads', () => {
    expect(
      normalizeCareReportSendPayload({
        channel: 'fax',
        recipient_name: '山田 医師',
        recipient_contact: '03-1111-2222',
        recipient_role: 'doctor',
        safety_ack: true,
      }),
    ).toEqual({
      ok: false,
      details: {
        expected_updated_at: ['報告書の版情報は必須です'],
      },
    });
  });

  it('uses the API email validation message for client-side form validation', () => {
    expect(
      validateCareReportSendRecipientForm({
        channel: 'email',
        recipient_name: '山田 医師',
        recipient_contact: 'not-an-email',
        recipient_role: 'physician',
      }),
    ).toEqual({
      ok: false,
      errors: {
        channel: undefined,
        recipient_name: undefined,
        recipient_contact: 'メール送信時は送付先連絡先にメールアドレスを指定してください',
        recipient_role: undefined,
      },
    });
  });
});
