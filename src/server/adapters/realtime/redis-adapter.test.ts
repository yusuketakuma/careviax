import { describe, expect, it } from 'vitest';
import { parseRedisRealtimeMessage } from './redis-adapter';

describe('redis realtime adapter message parsing', () => {
  it('parses object messages', () => {
    expect(parseRedisRealtimeMessage('{"type":"presence_update","entity_id":"vr_1"}')).toEqual({
      type: 'presence_update',
      entity_id: 'vr_1',
    });
  });

  it('rejects malformed JSON and non-object roots', () => {
    expect(parseRedisRealtimeMessage('not-json')).toBeNull();
    expect(parseRedisRealtimeMessage('[]')).toBeNull();
    expect(parseRedisRealtimeMessage('null')).toBeNull();
    expect(parseRedisRealtimeMessage('"presence_update"')).toBeNull();
    expect(parseRedisRealtimeMessage('false')).toBeNull();
    expect(parseRedisRealtimeMessage('123')).toBeNull();
  });
});
