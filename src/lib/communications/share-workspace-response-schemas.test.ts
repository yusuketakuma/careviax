import { describe, expect, it } from 'vitest';
import {
  buildShareCareTeamResponseSchema,
  buildShareCommunicationRequestItemSchema,
  buildShareContactsResponseSchema,
  buildShareReplyDetailResponseSchema,
} from './share-workspace-response-schemas';

const at = (day: number) => `2026-07-${String(day).padStart(2, '0')}T00:00:00.000Z`;

const patientScope = {
  expectedPatientId: 'patient_1',
  expectedRequestType: 'patient_share_reply_request' as const,
  expectedRelatedEntityType: 'patient' as const,
  expectedRelatedEntityId: 'patient_1',
};

describe('share workspace response schemas', () => {
  it('binds care-team selection to the requested case and strips unconsumed identifiers', () => {
    const schema = buildShareCareTeamResponseSchema({
      expectedPatientId: 'patient_1',
      expectedCaseId: 'case_1',
    });
    const payload = {
      data: [
        {
          id: 'member_1',
          role: 'care_manager',
          name: '田中',
          organization_name: '相談支援',
          is_primary: true,
          phone: 'must-not-enter-client-state',
        },
      ],
      meta: {
        patient_id: 'patient_1',
        case_id: 'case_1',
        cases: [{ id: 'case_1', status: 'active' }],
      },
    };

    const parsed = schema.parse(payload);
    expect(parsed).toEqual({
      data: [
        {
          role: 'care_manager',
          name: '田中',
          organization_name: '相談支援',
          is_primary: true,
        },
      ],
    });
    expect(schema.safeParse({ ...payload, meta: { ...payload.meta, case_id: null } }).success).toBe(
      false,
    );
    expect(
      schema.safeParse({ ...payload, meta: { ...payload.meta, patient_id: 'patient_2' } }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        ...payload,
        data: [...payload.data, { ...payload.data[0], id: 'member_2' }],
      }).success,
    ).toBe(false);
  });

  it('validates contact version metadata and keeps only the audience-card projection', () => {
    const payload = {
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
      meta: {
        patient_id: 'patient_1',
        expected_updated_at: at(10),
        version_basis: 'patient_updated_at',
      },
    };

    const schema = buildShareContactsResponseSchema('patient_1');
    const parsed = schema.parse(payload);
    expect(parsed.data[0]).not.toHaveProperty('id');
    expect(parsed.data[0]).not.toHaveProperty('phone');
    expect(
      schema.safeParse({
        ...payload,
        data: [...payload.data, { ...payload.data[0], id: 'contact_2' }],
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({ ...payload, meta: { ...payload.meta, patient_id: 'patient_2' } }).success,
    ).toBe(false);
  });

  it('binds list rows to the expected patient and related entity while stripping request content', () => {
    const schema = buildShareCommunicationRequestItemSchema(patientScope);
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
      content: 'must-not-enter-client-state',
      context_snapshot: { secret: true },
      requested_by: 'user_1',
      responses: [{ id: 'response_1', responder_name: '田中', responded_at: at(13) }],
    };

    const parsed = schema.parse(request);
    expect(parsed).not.toHaveProperty('patient_id');
    expect(parsed).not.toHaveProperty('content');
    expect(parsed).not.toHaveProperty('context_snapshot');
    expect(parsed).not.toHaveProperty('requested_by');
    expect(parsed).not.toHaveProperty('recipient_name');
    expect(parsed).not.toHaveProperty('subject');
    expect(parsed.responses[0]).toEqual({ responded_at: at(13) });
    expect(schema.safeParse({ ...request, patient_id: 'patient_2' }).success).toBe(false);
    expect(schema.safeParse({ ...request, related_entity_id: 'patient_2' }).success).toBe(false);
  });

  it('binds reply details to request, patient, type, and related entity identities', () => {
    const schema = buildShareReplyDetailResponseSchema({
      ...patientScope,
      expectedRequestId: 'request_1',
    });
    const detail = {
      data: {
        id: 'request_1',
        patient_id: 'patient_1',
        request_type: 'patient_share_reply_request',
        related_entity_type: 'patient',
        related_entity_id: 'patient_1',
        subject: 'must-not-enter-client-state',
        responses: [
          { id: 'response_2', responder_name: '田中', content: '確認済み', responded_at: at(14) },
          { id: 'response_1', responder_name: '田中', content: '受領', responded_at: at(13) },
        ],
      },
    };

    const parsed = schema.parse(detail);
    expect(parsed.data).not.toHaveProperty('patient_id');
    expect(parsed.data).not.toHaveProperty('subject');
    expect(parsed.data.responses).toEqual([detail.data.responses[0]]);
    expect(JSON.stringify(parsed)).not.toContain('受領');
    expect(schema.safeParse({ ...detail, data: { ...detail.data, id: 'request_2' } }).success).toBe(
      false,
    );
    expect(
      schema.safeParse({
        ...detail,
        data: { ...detail.data, responses: [...detail.data.responses].reverse() },
      }).success,
    ).toBe(false);
  });
});
