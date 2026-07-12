import { describe, expect, it } from 'vitest';
import {
  buildIncidentReportResponseSchema,
  incidentReportsResponseSchema,
} from './response-schema';

const report = {
  id: 'incident_1',
  title: '取り違えヒヤリ',
  what_happened: '交付前に発見した',
  cause: null,
  immediate_action: null,
  prevention_plan: null,
  related_process: 'dispensing',
  severity: 'near_miss',
  status: 'open',
  occurred_at: '2026-06-20T01:00:00.000Z',
  reported_by: 'user_1',
  created_at: '2026-06-20T01:00:00.000Z',
  updated_at: '2026-06-20T01:00:00.000Z',
};

describe('incidentReportsResponseSchema', () => {
  it('strips the reporter identity from the client projection', () => {
    expect(incidentReportsResponseSchema.parse({ data: [report] }).data[0]).not.toHaveProperty(
      'reported_by',
    );
  });

  it('rejects duplicate, reverse-ordered, and unknown clinical state rows', () => {
    expect(incidentReportsResponseSchema.safeParse({ data: [report, report] }).success).toBe(false);
    expect(
      incidentReportsResponseSchema.safeParse({
        data: [report, { ...report, id: 'incident_2', created_at: '2026-06-21T01:00:00.000Z' }],
      }).success,
    ).toBe(false);
    expect(
      incidentReportsResponseSchema.safeParse({
        data: [{ ...report, severity: 'unknown' }],
      }).success,
    ).toBe(false);
  });
});

describe('buildIncidentReportResponseSchema', () => {
  it('requires the requested incident identity for updates', () => {
    const schema = buildIncidentReportResponseSchema('incident_2');
    expect(schema.safeParse({ data: report }).success).toBe(false);
  });
});
