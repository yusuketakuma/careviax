import { beforeEach, describe, expect, it } from 'vitest';
import {
  __getInMemoryRealtimeStatsForTests,
  __resetInMemoryRealtimeStateForTests,
} from './in-memory-adapter';
import { RealtimeAdapter } from './index';

describe('RealtimeAdapter', () => {
  beforeEach(() => {
    __resetInMemoryRealtimeStateForTests();
  });

  it('delivers channel events to subscribers and replays recent messages', async () => {
    const adapter = new RealtimeAdapter();
    const received: unknown[] = [];

    await adapter.broadcastStatusUpdate('org:org_1', { step: 'before-subscribe' });
    await adapter.subscribeToChannel('org:org_1', (data) => {
      received.push(data);
    });
    await adapter.broadcastStatusUpdate('org:org_1', { step: 'after-subscribe' });

    expect(received).toEqual([{ step: 'before-subscribe' }, { step: 'after-subscribe' }]);
  });

  it('does not retain unobserved presence rooms for later replay', async () => {
    const adapter = new RealtimeAdapter();
    const received: unknown[] = [];

    for (let index = 0; index < 1_000; index += 1) {
      await adapter.broadcastStatusUpdate(`presence:org_1:visit_record:vr_${index}`, {
        type: 'presence_update',
        index,
      });
    }

    expect(__getInMemoryRealtimeStatsForTests().recentChannelCount).toBe(0);

    await adapter.subscribeToChannel('presence:org_1:visit_record:vr_999', (data) => {
      received.push(data);
    });

    expect(received).toEqual([]);
  });

  it('caps replay channels even when many replayable channels are broadcast', async () => {
    const adapter = new RealtimeAdapter();

    for (let index = 0; index < 600; index += 1) {
      await adapter.broadcastStatusUpdate(`org:org_${index}`, {
        type: 'status_update',
        index,
      });
    }

    expect(__getInMemoryRealtimeStatsForTests().recentChannelCount).toBeLessThanOrEqual(500);
  });
});
