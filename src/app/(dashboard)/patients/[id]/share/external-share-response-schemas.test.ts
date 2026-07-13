import { describe, expect, it } from 'vitest';
import {
  buildExternalShareOverviewResponseSchema,
  createExternalShareGrantResponseSchema,
} from './external-share-response-schemas';

const at = (day: number) => `2026-07-${String(day).padStart(2, '0')}T00:00:00.000Z`;

describe('external share response schemas', () => {
  it('projects the patient overview and rejects cross-patient or duplicate PHI records', () => {
    const schema = buildExternalShareOverviewResponseSchema('patient_1');
    const payload = {
      data: {
        id: 'patient_1',
        name: '佐藤 花子',
        archived_at: null,
        patient_share_permissions: {
          can_create_external_share: true,
          can_create_reply_request: true,
          can_create_followup_task: true,
        },
        external_shares: [
          {
            id: 'grant_1',
            granted_to_name: '田中ケアマネ',
            expires_at: at(20),
            accessed_at: null,
            token_hash: 'must-not-enter-client-state',
          },
        ],
        self_reports: [
          {
            id: 'report_1',
            subject: '疼痛',
            content: '確認希望',
            created_at: at(10),
            status: 'open',
          },
        ],
        current_medications: [],
        visit_schedules: [],
        care_reports: [
          {
            report_type: 'care_manager_report',
            created_at: at(9),
            status: 'sent',
            has_pdf: true,
            pdf_url: '/api/files/file_1/download',
          },
        ],
        org_id: 'must-be-stripped',
      },
    };

    const parsed = schema.parse(payload);
    expect(parsed.data).not.toHaveProperty('org_id');
    expect(parsed.data).not.toHaveProperty('archived_at');
    expect(parsed.data.archive).toEqual({
      status: 'active',
      archived: false,
      archived_at: null,
    });
    expect(parsed.data.patient_share_permissions).toEqual({
      can_create_external_share: true,
      can_create_reply_request: true,
      can_create_followup_task: true,
    });
    expect(parsed.data.external_shares[0]).not.toHaveProperty('token_hash');
    expect(parsed.data.care_reports?.[0]).toMatchObject({ has_pdf: true });
    expect(parsed.data.care_reports?.[0]).not.toHaveProperty('pdf_url');
    expect(
      schema.safeParse({ ...payload, data: { ...payload.data, id: 'patient_2' } }).success,
    ).toBe(false);
    expect(
      schema.parse({
        ...payload,
        data: { ...payload.data, archived_at: at(12), archived_by: 'must-be-stripped' },
      }).data,
    ).toMatchObject({
      archive: { status: 'archived', archived: true, archived_at: at(12) },
    });
    expect(
      schema.safeParse({
        ...payload,
        data: { ...payload.data, archived_at: 'not-a-date' },
      }).success,
    ).toBe(false);
    const missingArchiveState: Partial<typeof payload.data> = { ...payload.data };
    delete missingArchiveState.archived_at;
    expect(schema.safeParse({ ...payload, data: missingArchiveState }).success).toBe(false);
    const missingPermissions: Partial<typeof payload.data> = { ...payload.data };
    delete missingPermissions.patient_share_permissions;
    expect(schema.safeParse({ ...payload, data: missingPermissions }).success).toBe(false);
    expect(
      schema.safeParse({
        ...payload,
        data: {
          ...payload.data,
          patient_share_permissions: {
            can_create_external_share: true,
            can_create_reply_request: true,
          },
        },
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        ...payload,
        data: {
          ...payload.data,
          external_shares: [payload.data.external_shares[0], payload.data.external_shares[0]],
        },
      }).success,
    ).toBe(false);
  });

  it('accepts SMS without exposing OTP and requires OTP for manual delivery', () => {
    const token = `${'a'.repeat(24)}.${'b'.repeat(24)}.${'c'.repeat(24)}`;
    expect(
      createExternalShareGrantResponseSchema.safeParse({
        data: {
          token,
          expires_at: at(20),
          otp_delivery: 'sms',
          otp_delivery_destination: '090****5678',
        },
      }).success,
    ).toBe(true);
    expect(
      createExternalShareGrantResponseSchema.safeParse({
        data: {
          token,
          expires_at: at(20),
          otp_delivery: 'manual',
          otp_delivery_destination: null,
        },
      }).success,
    ).toBe(false);
    expect(
      createExternalShareGrantResponseSchema.safeParse({
        data: {
          token: '../unsafe/token',
          expires_at: at(20),
          otp: '123456',
          otp_delivery: 'manual',
          otp_delivery_destination: null,
        },
      }).success,
    ).toBe(false);
  });
});
