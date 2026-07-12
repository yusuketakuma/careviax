import { describe, expect, it } from 'vitest';
import { voiceMemoVisitRecordDetailResponseSchema } from './voice-memo-response-schema';

describe('voiceMemoVisitRecordDetailResponseSchema', () => {
  it('projects only optimistic-lock and SOAP-subjective fields', () => {
    expect(
      voiceMemoVisitRecordDetailResponseSchema.parse({
        data: {
          version: 3,
          soap_subjective: '既存メモ',
          patient_name: 'provider-only-patient-name',
          attachments: [{ file_name: 'provider-only-file-name' }],
        },
      }),
    ).toEqual({ version: 3, soap_subjective: '既存メモ' });
  });

  it.each([
    { record: { version: 3, soap_subjective: null } },
    { data: { version: '3', soap_subjective: null } },
    { data: { version: 0, soap_subjective: null } },
    { data: { version: 3 } },
    { data: { version: 3, soap_subjective: 42 } },
    { data: { version: 3, soap_subjective: null }, debug: true },
  ])('rejects malformed visit-record detail %#', (payload) => {
    expect(voiceMemoVisitRecordDetailResponseSchema.safeParse(payload).success).toBe(false);
  });
});
