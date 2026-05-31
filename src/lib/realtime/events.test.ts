import { describe, expect, it } from 'vitest';
import { normalizeRealtimeEventPayload, parseRealtimeEventPayload } from './events';

describe('realtime event payload parser', () => {
  it('keeps object payloads with a non-empty string type', () => {
    expect(
      parseRealtimeEventPayload('{"type":"workflow_refresh","payload":{"source":"set_plans"}}'),
    ).toEqual({
      type: 'workflow_refresh',
      payload: { source: 'set_plans' },
    });
  });

  it('rejects malformed JSON and non-object roots', () => {
    expect(parseRealtimeEventPayload('{')).toBeNull();
    expect(parseRealtimeEventPayload('[]')).toBeNull();
    expect(parseRealtimeEventPayload('"presence_update"')).toBeNull();
    expect(parseRealtimeEventPayload('null')).toBeNull();
  });

  it('rejects payloads without a usable type', () => {
    expect(parseRealtimeEventPayload('{"payload":{}}')).toBeNull();
    expect(parseRealtimeEventPayload('{"type":""}')).toBeNull();
    expect(parseRealtimeEventPayload('{"type":"   "}')).toBeNull();
    expect(parseRealtimeEventPayload('{"type":123}')).toBeNull();
  });

  it('normalizes already-parsed values with the same contract', () => {
    expect(
      normalizeRealtimeEventPayload({ type: 'presence_update', entity_id: 'visit_1' }),
    ).toEqual({
      type: 'presence_update',
      entity_id: 'visit_1',
    });
    expect(normalizeRealtimeEventPayload(['presence_update'])).toBeNull();
  });
});
