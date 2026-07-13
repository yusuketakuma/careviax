import { describe, expect, it } from 'vitest';
import {
  buildVisitRecordAttachmentPatchResponseSchema,
  buildVisitRecordCreateResponseSchema,
  buildVisitRecordHeaderSafetyResponseSchema,
  buildVisitRecordScheduleResponseSchema,
  visitRecordCdsAlertsResponseSchema,
} from './visit-record-form-response-schemas';

describe('visit record form response schemas', () => {
  it('projects CDS alerts and rejects mixed-root envelopes', () => {
    expect(
      visitRecordCdsAlertsResponseSchema.parse({
        data: {
          alerts: [
            {
              type: 'renal_dose',
              severity: 'warning',
              message: '用量を確認してください',
              details: { egfr: 42 },
            },
          ],
        },
      }),
    ).toEqual({
      alerts: [
        {
          type: 'renal_dose',
          severity: 'warning',
          message: '用量を確認してください',
          details: { egfr: 42 },
        },
      ],
    });
    expect(() =>
      visitRecordCdsAlertsResponseSchema.parse({ data: { alerts: [] }, message: 'poison' }),
    ).toThrow();
  });

  it('checks schedule and nested patient identities while removing provider-only fields', () => {
    const schema = buildVisitRecordScheduleResponseSchema('schedule_1');
    expect(
      schema.parse({
        data: {
          id: 'schedule_1',
          patient_id: 'patient_1',
          cycle_id: 'cycle_1',
          scheduled_date: '2026-07-13T01:00:00.000Z',
          visit_type: 'home',
          carry_items_status: 'ready',
          provider_only: 'removed',
          case_: { patient: { id: 'patient_1', name: '患者A', secret: 'removed' } },
        },
      }),
    ).not.toHaveProperty('provider_only');
    expect(() =>
      schema.parse({
        data: {
          id: 'schedule_1',
          patient_id: 'patient_1',
          cycle_id: null,
          scheduled_date: '2026-07-13',
          visit_type: 'home',
          carry_items_status: null,
          case_: { patient: { id: 'patient_2', name: '患者B' } },
        },
      }),
    ).toThrow('visit schedule patient relation mismatch');
  });

  it('checks patient safety identity, uniqueness, visibility, and counts', () => {
    const schema = buildVisitRecordHeaderSafetyResponseSchema('patient_1');
    expect(
      schema.parse({
        data: {
          patient_id: 'patient_1',
          name: '患者A',
          safety: {
            safety_tags: ['allergy', 'renal', 'fall'],
            visible_safety_tags: ['allergy'],
            hidden_safety_tag_count: 2,
            allergy: 'penicillin',
          },
        },
      }),
    ).toEqual({
      safety: {
        safety_tags: ['allergy', 'renal', 'fall'],
        visible_safety_tags: ['allergy'],
        hidden_safety_tag_count: 2,
      },
    });
    expect(() =>
      schema.parse({
        data: {
          patient_id: 'patient_1',
          safety: {
            safety_tags: ['allergy'],
            visible_safety_tags: ['allergy'],
            hidden_safety_tag_count: 1,
          },
        },
      }),
    ).toThrow('patient safety tag counts mismatch');
  });

  it('checks create patient identity and strips unused record fields', () => {
    expect(
      buildVisitRecordCreateResponseSchema('patient_1').parse({
        data: {
          record: {
            id: 'record_1',
            version: 1,
            patient_id: 'patient_1',
            soap_subjective: 'removed',
          },
          suggestedSchedule: null,
          conflictResolved: false,
        },
      }),
    ).toEqual({ id: 'record_1', version: 1, patient_id: 'patient_1' });
    expect(() =>
      buildVisitRecordCreateResponseSchema('patient_1').parse({
        data: { record: { id: 'record_1', version: 1, patient_id: 'patient_2' } },
      }),
    ).toThrow('created visit record patient mismatch');
  });

  it('requires attachment patches to preserve identity and advance version', () => {
    const schema = buildVisitRecordAttachmentPatchResponseSchema('record_1', 'patient_1', 1);
    expect(
      schema.parse({
        data: { id: 'record_1', version: 2, patient_id: 'patient_1', attachments: [] },
      }),
    ).toEqual({ id: 'record_1', version: 2, patient_id: 'patient_1' });
    expect(() =>
      schema.parse({ data: { id: 'record_1', version: 1, patient_id: 'patient_1' } }),
    ).toThrow('patched visit record version did not advance');
  });
});
