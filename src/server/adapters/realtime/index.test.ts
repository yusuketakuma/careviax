import { describe, expect, it } from 'vitest';
import { RealtimeAdapter } from './index';

describe('RealtimeAdapter', () => {
  it('delivers channel events to subscribers and replays recent messages', async () => {
    const adapter = new RealtimeAdapter();
    const received: unknown[] = [];

    await adapter.broadcastStatusUpdate('channel-1', { step: 'before-subscribe' });
    await adapter.subscribeToChannel('channel-1', (data) => {
      received.push(data);
    });
    await adapter.broadcastStatusUpdate('channel-1', { step: 'after-subscribe' });

    expect(received).toEqual([{ step: 'before-subscribe' }, { step: 'after-subscribe' }]);
  });
});
