import { describe, expect, it } from 'vitest';
import { sharedViewerResponseSchema } from './shared-viewer-response-schema';

const BASE = {
  data: {
    patient: {
      id: 'patient_1',
      name: '患者A',
      birth_date: '1950-01-01T00:00:00.000Z',
      gender: 'male',
      archive: { status: 'active', archived: false, archived_at: null },
      phone: 'provider-only',
    },
    self_report_history: [],
    shared_summary: {
      headline: '共有情報',
      bullets: [],
      key_medications: [],
      next_visit_date: null,
      raw_prompt: 'provider-only',
    },
    scope: { allergy_info: true },
    expires_at: '2026-07-13T00:00:00.000Z',
    grant_id: 'provider-only',
  },
};

const INBOUND = {
  version: 1,
  window: {
    from: '2026-06-12T00:00:00.000Z',
    to: '2026-07-12T00:00:00.000Z',
    days: 30,
  },
  totals: {
    event_count: 1,
    signal_count: 1,
    safety_event_count: 1,
    medication_stock_event_count: 0,
    schedule_event_count: 0,
    report_event_count: 0,
    urgent_signal_count: 1,
    truncated: false,
  },
  latest_received_at: '2026-07-11T10:00:00.000Z',
  event_type_counts: [{ event_type: 'care_coordination', label: '連携事項', count: 1 }],
  signal_domain_counts: [{ signal_domain: 'urgent', label: '至急', count: 1 }],
  signal_type_counts: [{ signal_type: 'safety_attention', label: '安全確認', count: 1 }],
  source_channel_counts: [{ source_channel: 'mcs', label: 'MCS', count: 1 }],
  recent_events: [
    {
      received_at: '2026-07-11T10:00:00.000Z',
      event_type: 'care_coordination',
      event_type_label: '連携事項',
      source_channel: 'mcs',
      source_channel_label: 'MCS',
      sender_role: 'nurse',
      sender_role_label: '看護師',
      flags: {
        medication_stock: false,
        patient_safety: true,
        schedule: false,
        report: false,
      },
      signal_domains: [{ signal_domain: 'urgent', label: '至急' }],
      signal_types: [{ signal_type: 'safety_attention', label: '安全確認' }],
      raw_text: 'provider-only PHI',
      sender_contact: 'provider-only',
    },
  ],
};

describe('sharedViewerResponseSchema', () => {
  it('projects the public viewer payload and strips provider-only fields recursively', () => {
    const parsed = sharedViewerResponseSchema.parse({
      data: {
        ...BASE.data,
        scope: { inbound_communication_summary: true },
        inbound_communication_summary: INBOUND,
      },
    });

    expect(parsed.data).not.toHaveProperty('grant_id');
    expect(parsed.data.patient).not.toHaveProperty('phone');
    expect(parsed.data.shared_summary).not.toHaveProperty('raw_prompt');
    expect(parsed.data.inbound_communication_summary?.recent_events[0]).not.toHaveProperty(
      'raw_text',
    );
    expect(parsed.data.inbound_communication_summary?.recent_events[0]).not.toHaveProperty(
      'sender_contact',
    );
  });

  it.each([
    ['legacy root', BASE.data],
    ['unsupported public scope', { data: { ...BASE.data, scope: { self_report_history: true } } }],
    [
      'unsupported history content',
      { data: { ...BASE.data, self_report_history: [{ id: 'report_1' }] } },
    ],
    [
      'archive contradiction',
      {
        data: {
          ...BASE.data,
          patient: {
            ...BASE.data.patient,
            archive: { status: 'active', archived: true, archived_at: null },
          },
        },
      },
    ],
    [
      'missing scoped medication section',
      { data: { ...BASE.data, scope: { medication_list: true } } },
    ],
    ['section without scope', { data: { ...BASE.data, medication_profiles: [] } }],
    [
      'inbound count drift',
      {
        data: {
          ...BASE.data,
          scope: { inbound_communication_summary: true },
          inbound_communication_summary: {
            ...INBOUND,
            totals: { ...INBOUND.totals, event_count: 2 },
          },
        },
      },
    ],
  ])('rejects %s', (_label, payload) => {
    expect(sharedViewerResponseSchema.safeParse(payload).success).toBe(false);
  });
});
