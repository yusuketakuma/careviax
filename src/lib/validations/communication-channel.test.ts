import { describe, expect, it } from 'vitest';
import {
  communicationChannelSchema,
  externalCommunicationChannelSchema,
} from './communication-channel';

describe('communication channel schemas', () => {
  it('keeps PH-OS share in the full delivery channel contract only', () => {
    expect(communicationChannelSchema.safeParse('ph_os_share').success).toBe(true);
    expect(externalCommunicationChannelSchema.safeParse('ph_os_share').success).toBe(false);
  });

  it('accepts shared external communication channel values', () => {
    for (const channel of ['email', 'fax', 'phone', 'in_person', 'postal', 'ses']) {
      expect(externalCommunicationChannelSchema.safeParse(channel).success).toBe(true);
    }
  });
});
