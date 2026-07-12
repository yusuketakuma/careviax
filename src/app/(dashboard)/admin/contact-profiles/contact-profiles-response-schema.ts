import { z } from 'zod';
import { CONTACT_METHOD_OPTIONS } from '@/lib/contact-profile-options';

const NON_EMPTY_TEXT = z.string().refine((value) => value.trim().length > 0, {
  message: 'Expected non-empty text',
});
const OPTIONAL_TEXT = z.string().max(2_000).nullable();
const NON_NEGATIVE_COUNT = z.number().finite().int().nonnegative();
const CONTACT_CHANNELS = [...CONTACT_METHOD_OPTIONS, 'ses'] as const;
const contactChannelSchema = z.enum(CONTACT_CHANNELS);

const contactReliabilitySchema = z
  .object({
    ready: z.boolean(),
    warnings: z.array(z.string().max(500)).max(50),
    missing_channel_labels: z.array(z.string().max(100)).max(CONTACT_CHANNELS.length),
  })
  .strict();

const contactProfileSchema = z
  .object({
    id: NON_EMPTY_TEXT,
    kind: z.enum(['facility_contact', 'external_professional', 'prescriber_institution']),
    name: NON_EMPTY_TEXT,
    subtitle: OPTIONAL_TEXT,
    phone: OPTIONAL_TEXT,
    email: OPTIONAL_TEXT,
    fax: OPTIONAL_TEXT,
    preferred_contact_method: contactChannelSchema.nullable(),
    preferred_contact_time: OPTIONAL_TEXT,
    last_contacted_at: z.string().datetime({ offset: true }).nullable(),
    last_success_channel: contactChannelSchema.nullable(),
    recommended_channels: z.array(contactChannelSchema).max(CONTACT_CHANNELS.length),
    contact_reliability: contactReliabilitySchema,
    active_patient_count: NON_NEGATIVE_COUNT,
    pending_response_count: NON_NEGATIVE_COUNT,
  })
  .strict();

export const contactProfilesResponseSchema = z
  .object({
    data: z.array(contactProfileSchema),
  })
  .strict()
  .superRefine(({ data }, context) => {
    const profileIds = new Set<string>();
    for (const [index, profile] of data.entries()) {
      if (profileIds.has(profile.id)) {
        context.addIssue({
          code: 'custom',
          path: ['data', index, 'id'],
          message: 'Duplicate contact profile identity',
        });
      }
      profileIds.add(profile.id);

      const recommendedChannels = new Set<string>();
      for (const [channelIndex, channel] of profile.recommended_channels.entries()) {
        if (recommendedChannels.has(channel)) {
          context.addIssue({
            code: 'custom',
            path: ['data', index, 'recommended_channels', channelIndex],
            message: 'Duplicate recommended contact channel',
          });
        }
        recommendedChannels.add(channel);
      }
    }
  });

export type ContactProfile = z.infer<typeof contactProfileSchema>;
