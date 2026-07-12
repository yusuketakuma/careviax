import { describe, expect, it } from 'vitest';
import {
  buildCapturePatientNameResponseSchema,
  buildCaptureVisitEndResponseSchema,
  capturePatientSafetyResponseSchema,
} from './capture-response-schemas';

describe('capture response schemas', () => {
  it('projects patient identity and safety data', () => {
    expect(
      buildCapturePatientNameResponseSchema('patient_1').parse({
        data: { id: 'patient_1', name: '患者A', provider_only: true },
      }),
    ).toBe('患者A');
    expect(
      capturePatientSafetyResponseSchema.parse({
        data: {
          safety: {
            visible_safety_tags: ['allergy', 'allergy'],
            hidden_safety_tag_count: 2,
            provider_only: true,
          },
          patient_name: '患者A',
        },
      }),
    ).toEqual({ tags: ['allergy'], hiddenCount: 2 });
  });

  it('rejects cross-patient or malformed safety payloads', () => {
    expect(
      buildCapturePatientNameResponseSchema('patient_1').safeParse({
        data: { id: 'patient_2', name: '患者B' },
      }).success,
    ).toBe(false);
    expect(
      capturePatientSafetyResponseSchema.safeParse({
        data: {
          safety: { visible_safety_tags: [], hidden_safety_tag_count: -1 },
        },
      }).success,
    ).toBe(false);
  });

  it('requires the requested visit-end identity, version, and timestamp', () => {
    const schema = buildCaptureVisitEndResponseSchema({
      recordId: 'record_1',
      expectedVersion: 3,
      endedAt: '2026-04-09T01:45:00.000Z',
    });
    const payload = {
      data: {
        id: 'record_1',
        version: 4,
        visit_started_at: '2026-04-09T01:00:00.000Z',
        visit_ended_at: '2026-04-09T01:45:00.000Z',
        provider_only: true,
      },
    };
    expect(schema.parse(payload)).toBe('2026-04-09T01:45:00.000Z');
    expect(schema.safeParse({ data: { ...payload.data, version: 3 } }).success).toBe(false);
    expect(
      schema.safeParse({
        data: { ...payload.data, visit_ended_at: '2026-04-09T02:00:00.000Z' },
      }).success,
    ).toBe(false);
  });
});
