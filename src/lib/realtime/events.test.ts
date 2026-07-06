import { describe, expect, it } from 'vitest';
import { normalizeRealtimeEventPayload, parseRealtimeEventPayload } from './events';

describe('realtime event payload parser', () => {
  it('keeps allowlisted scalar fields from object payloads', () => {
    expect(
      parseRealtimeEventPayload(
        '{"type":"workflow_refresh","payload":{"source":"set_plans","case_id":"case_1"}}',
      ),
    ).toEqual({
      type: 'workflow_refresh',
      source: 'set_plans',
      case_id: 'case_1',
    });
  });

  it('rejects malformed JSON and non-object roots', () => {
    expect(parseRealtimeEventPayload('{')).toBeNull();
    expect(parseRealtimeEventPayload('[]')).toBeNull();
    expect(parseRealtimeEventPayload('"presence_update"')).toBeNull();
    expect(parseRealtimeEventPayload('null')).toBeNull();
    expect(parseRealtimeEventPayload('false')).toBeNull();
  });

  it('rejects payloads without a usable type', () => {
    expect(parseRealtimeEventPayload('{"payload":{}}')).toBeNull();
    expect(parseRealtimeEventPayload('{"type":""}')).toBeNull();
    expect(parseRealtimeEventPayload('{"type":"   "}')).toBeNull();
    expect(parseRealtimeEventPayload('{"type":123}')).toBeNull();
  });

  it('normalizes already-parsed values with the same contract', () => {
    expect(
      normalizeRealtimeEventPayload({
        type: 'presence_update',
        entity_id: 'visit_1',
        user_id: 'user_1',
        display_name: '薬剤師A',
        updated_at: '2026-07-06T00:00:00.000Z',
      }),
    ).toEqual({
      type: 'presence_update',
      entity_id: 'visit_1',
      user_id: 'user_1',
      display_name: '薬剤師A',
      updated_at: '2026-07-06T00:00:00.000Z',
    });
    expect(normalizeRealtimeEventPayload(['presence_update'])).toBeNull();
  });

  it('keeps display_name only for presence updates', () => {
    expect(
      normalizeRealtimeEventPayload({
        type: 'presence_update',
        user_id: 'user_1',
        display_name: '薬剤師A',
      }),
    ).toEqual({
      type: 'presence_update',
      user_id: 'user_1',
      display_name: '薬剤師A',
    });

    expect(
      normalizeRealtimeEventPayload({
        type: 'workflow_refresh',
        source: 'patients_board',
        display_name: '山田 太郎',
      }),
    ).toEqual({
      type: 'workflow_refresh',
      source: 'patients_board',
    });
  });

  it('drops unknown fields and common PHI-bearing realtime hazards', () => {
    const normalized = normalizeRealtimeEventPayload({
      type: 'cycle_transition',
      source: 'medication_cycles_transition',
      patient_name: '山田 太郎',
      address: '東京都港区1-2-3',
      phone: '03-0000-0000',
      drug_name: 'A薬',
      raw_message: '患者宅で確認してください',
      metadata: { patient_name: '山田 太郎' },
      provider_error: 'token=secret',
      storage_key: 'private/patient/file.pdf',
      signed_url: 'https://example.com/private',
      link: '/patients/patient_1',
      payload: {
        source: 'set_plans',
        patient_name: '山田 太郎',
        raw_message: '自由記載',
      },
    });

    expect(normalized).toEqual({
      type: 'cycle_transition',
      source: 'set_plans',
    });
    const serialized = JSON.stringify(normalized);
    expect(serialized).not.toContain('山田');
    expect(serialized).not.toContain('東京都');
    expect(serialized).not.toContain('03-0000-0000');
    expect(serialized).not.toContain('A薬');
    expect(serialized).not.toContain('raw_message');
    expect(serialized).not.toContain('metadata');
    expect(serialized).not.toContain('provider_error');
    expect(serialized).not.toContain('storage_key');
    expect(serialized).not.toContain('signed_url');
    expect(serialized).not.toContain('/patients/');
  });

  it('maps unknown event types to a safe workflow refresh event', () => {
    expect(
      normalizeRealtimeEventPayload({
        type: 'new_unreviewed_event',
        patient_name: '山田 太郎',
        message: '自由記載',
      }),
    ).toEqual({
      type: 'workflow_refresh',
      source: 'unknown_event',
    });
  });
});
