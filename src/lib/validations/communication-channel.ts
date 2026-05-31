import { z } from 'zod';
import type { CommunicationChannel } from '@prisma/client';

export const COMMUNICATION_CHANNELS = [
  'email',
  'fax',
  'phone',
  'in_person',
  'postal',
  'ses',
] as const satisfies readonly [CommunicationChannel, ...CommunicationChannel[]];

export const communicationChannelSchema = z.enum(COMMUNICATION_CHANNELS);
