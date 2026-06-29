import { describe, expect, it } from 'vitest';
import {
  CARE_REPORT_SEND_CHANNELS,
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

  it.each(CARE_REPORT_SEND_CHANNELS)('accepts %s for direct care-report sends', (channel) => {
    const recipientContact =
      channel === 'email' || channel === 'ses' ? 'doctor@example.com' : '連絡先';

    expect(
      normalizeCareReportSendPayload({
        channel,
        recipient_name: '山田 医師',
        recipient_contact: recipientContact,
        recipient_role: 'physician',
        expected_updated_at: '2026-05-12T00:00:00.000Z',
        safety_ack: true,
      }),
    ).toMatchObject({
      ok: true,
      recipients: [
        {
          channel,
          recipient_contact: recipientContact,
        },
      ],
    });
  });

  it('rejects PH-OS share from the direct care-report send payload', () => {
    const result = normalizeCareReportSendPayload({
      channel: 'ph_os_share',
      recipient_name: '山田 医師',
      recipient_contact: 'doctor@example.com',
      recipient_role: 'physician',
      expected_updated_at: '2026-05-12T00:00:00.000Z',
      safety_ack: true,
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('direct send payload should reject PH-OS share');
    expect(result.details.channel?.[0]).toEqual(expect.any(String));
  });

  it('rejects PH-OS share inside bulk direct care-report send recipients', () => {
    const result = normalizeCareReportSendPayload({
      recipients: [
        {
          channel: 'ph_os_share',
          recipient_name: '山田 医師',
          recipient_contact: 'doctor@example.com',
          recipient_role: 'physician',
        },
      ],
      expected_updated_at: '2026-05-12T00:00:00.000Z',
      safety_ack: true,
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('bulk direct send payload should reject PH-OS share');
    expect(result.details.recipients?.[0]).toEqual(expect.any(String));
  });

  it('rejects PH-OS share from the client-side direct send form', () => {
    const result = validateCareReportSendRecipientForm({
      channel: 'ph_os_share',
      recipient_name: '山田 医師',
      recipient_contact: 'doctor@example.com',
      recipient_role: 'physician',
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('direct send form should reject PH-OS share');
    expect(result.errors.channel).toEqual(expect.any(String));
  });
});
