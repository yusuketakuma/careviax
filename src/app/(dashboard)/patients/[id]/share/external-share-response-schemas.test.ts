import { describe, expect, it } from 'vitest';
import {
  buildExternalShareOverviewResponseSchema,
  buildExternalShareReplyDetailResponseSchema,
  buildExternalShareRequestsResponseSchema,
  createExternalShareGrantResponseSchema,
  externalShareCareTeamResponseSchema,
  externalShareContactsResponseSchema,
} from './external-share-response-schemas';

const at = (day: number) => `2026-07-${String(day).padStart(2, '0')}T00:00:00.000Z`;

describe('external share response schemas', () => {
  it('projects the patient overview and rejects cross-patient or duplicate PHI records', () => {
    const schema = buildExternalShareOverviewResponseSchema('patient_1');
    const payload = {
      data: {
        id: 'patient_1',
        name: '佐藤 花子',
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
        care_reports: [],
        org_id: 'must-be-stripped',
      },
    };

    const parsed = schema.parse(payload);
    expect(parsed.data).not.toHaveProperty('org_id');
    expect(parsed.data.external_shares[0]).not.toHaveProperty('token_hash');
    expect(
      schema.safeParse({ ...payload, data: { ...payload.data, id: 'patient_2' } }).success,
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

  it('validates care-team case selection and unique primary roles', () => {
    const base = {
      data: [
        {
          id: 'member_1',
          role: 'care_manager',
          name: '田中',
          organization_name: '相談支援',
          is_primary: true,
        },
      ],
      meta: { case_id: 'case_1', cases: [{ id: 'case_1', status: 'active' }] },
    };
    expect(externalShareCareTeamResponseSchema.safeParse(base).success).toBe(true);
    expect(
      externalShareCareTeamResponseSchema.safeParse({
        ...base,
        meta: { ...base.meta, case_id: 'case_2' },
      }).success,
    ).toBe(false);
    expect(
      externalShareCareTeamResponseSchema.safeParse({
        ...base,
        data: [...base.data, { ...base.data[0], id: 'member_2' }],
      }).success,
    ).toBe(false);
  });

  it('validates contact version metadata and one primary contact', () => {
    const base = {
      data: [
        {
          id: 'contact_1',
          relation: '長女',
          name: '佐藤 家族',
          organization_name: null,
          is_primary: true,
          phone: '090****5678',
        },
      ],
      meta: { expected_updated_at: at(10), version_basis: 'patient_updated_at' },
    };
    const parsed = externalShareContactsResponseSchema.parse(base);
    expect(parsed.data[0]).not.toHaveProperty('phone');
    expect(
      externalShareContactsResponseSchema.safeParse({
        ...base,
        data: [...base.data, { ...base.data[0], id: 'contact_2' }],
      }).success,
    ).toBe(false);
  });

  it('binds request lists and reply details to the requested patient and request', () => {
    const listSchema = buildExternalShareRequestsResponseSchema('patient_1');
    const request = {
      id: 'request_1',
      patient_id: 'patient_1',
      request_type: 'patient_share_reply_request',
      recipient_name: '田中',
      recipient_role: 'care_manager',
      related_entity_type: 'patient',
      related_entity_id: 'patient_1',
      status: 'responded',
      subject: '共有確認',
      requested_at: at(12),
      responses: [{ id: 'response_1', responder_name: '田中', responded_at: at(13) }],
    } as const;
    const payload = {
      data: [request],
      meta: { limit: 50, has_more: false, next_cursor: null },
    };
    expect(listSchema.safeParse(payload).success).toBe(true);
    expect(
      listSchema.safeParse({
        ...payload,
        data: [{ ...request, related_entity_id: 'patient_2' }],
      }).success,
    ).toBe(false);

    const detailSchema = buildExternalShareReplyDetailResponseSchema({
      expectedRequestId: 'request_1',
      expectedPatientId: 'patient_1',
    });
    const detail = {
      data: {
        ...request,
        responses: [
          { id: 'response_2', responder_name: '田中', content: '確認済み', responded_at: at(14) },
          { id: 'response_1', responder_name: '田中', content: '受領', responded_at: at(13) },
        ],
      },
    };
    const parsed = detailSchema.parse(detail);
    expect(parsed.data).not.toHaveProperty('subject');
    expect(
      detailSchema.safeParse({ ...detail, data: { ...detail.data, id: 'request_2' } }).success,
    ).toBe(false);
    expect(
      detailSchema.safeParse({
        ...detail,
        data: { ...detail.data, responses: [...detail.data.responses].reverse() },
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
