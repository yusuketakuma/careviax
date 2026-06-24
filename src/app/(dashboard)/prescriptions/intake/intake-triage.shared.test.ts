import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IntakeTriageRow } from '@/lib/prescriptions/intake-triage-contract';

// Actual-backed spy: keep real encode/guard behavior for the to_card href tests while
// proving delegation/return-value and that static actions never touch the patient helper.
vi.mock('@/lib/patient/navigation', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/patient/navigation')>();
  return { ...actual, buildPatientHref: vi.fn(actual.buildPatientHref) };
});

vi.mock('@/lib/prescriptions/navigation', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/prescriptions/navigation')>();
  return { ...actual, buildPrescriptionHref: vi.fn(actual.buildPrescriptionHref) };
});

import { buildPatientHref } from '@/lib/patient/navigation';
import { buildPrescriptionHref } from '@/lib/prescriptions/navigation';
import { INTAKE_ACTION_PRESENTATIONS } from './intake-triage.shared';

function makeRow(overrides: Partial<IntakeTriageRow> = {}): IntakeTriageRow {
  return {
    intake_id: 'intake_1',
    cycle_id: 'cycle_1',
    patient_id: 'p1',
    patient_name: '田中 一郎',
    received_at: '2026-06-12T00:00:00.000Z',
    lane: 'fax',
    issuer: null,
    content_label: '定期処方',
    rx_number: null,
    auto_read_percent: null,
    status: 'imported',
    duplicate_of_date: null,
    action: 'to_card',
    ...overrides,
  };
}

describe('INTAKE_ACTION_PRESENTATIONS', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('builds the to_card href from the patient id', () => {
    expect(INTAKE_ACTION_PRESENTATIONS.to_card.href(makeRow({ patient_id: 'p1' }))).toBe(
      '/patients/p1',
    );
  });

  it('to_card uses the shared helper RETURN VALUE with the raw patient id (not local reconstruction)', () => {
    vi.mocked(buildPatientHref).mockReturnValueOnce('/patients/__sentinel__');
    expect(INTAKE_ACTION_PRESENTATIONS.to_card.href(makeRow({ patient_id: 'p1' }))).toBe(
      '/patients/__sentinel__',
    );
    expect(vi.mocked(buildPatientHref)).toHaveBeenCalledWith('p1');
  });

  it('to_card encodes a hostile patient id as a single path segment', () => {
    const hostilePatientId = 'patient/1?tab=x#frag';
    const href = INTAKE_ACTION_PRESENTATIONS.to_card.href(
      makeRow({ patient_id: hostilePatientId }),
    );
    expect(href).toBe(`/patients/${encodeURIComponent(hostilePatientId)}`);
    expect(href).not.toContain('patient/1');
    expect(href).not.toContain('?tab=');
    expect(href).not.toContain('#frag');
  });

  // patient_id is API/DB-derived action identity -> fail fast (RangeError) via the shared
  // guard on exact dot segments, and the throw must come THROUGH the helper.
  it.each(['.', '..'])(
    'to_card fails fast via the shared helper for a dot-segment id (%s)',
    (dotId) => {
      expect(() =>
        INTAKE_ACTION_PRESENTATIONS.to_card.href(makeRow({ patient_id: dotId })),
      ).toThrow(RangeError);
      expect(vi.mocked(buildPatientHref)).toHaveBeenCalledWith(dotId);
    },
  );

  it.each(['send_to_entry', 'compare'] as const)(
    '%s routes the clicked intake through the prescription detail helper',
    (action) => {
      vi.mocked(buildPrescriptionHref).mockReturnValueOnce('/prescriptions/__sentinel__');

      expect(INTAKE_ACTION_PRESENTATIONS[action].href(makeRow({ intake_id: 'intake_1' }))).toBe(
        '/prescriptions/__sentinel__',
      );
      expect(vi.mocked(buildPrescriptionHref)).toHaveBeenCalledWith('intake_1');
      expect(vi.mocked(buildPatientHref)).not.toHaveBeenCalled();
    },
  );

  it.each(['send_to_entry', 'compare'] as const)(
    '%s encodes a hostile intake id as one prescription detail path segment',
    (action) => {
      const hostileIntakeId = 'intake/1?tab=x#frag';
      expect(
        INTAKE_ACTION_PRESENTATIONS[action].href(makeRow({ intake_id: hostileIntakeId })),
      ).toBe(`/prescriptions/${encodeURIComponent(hostileIntakeId)}`);
      expect(vi.mocked(buildPrescriptionHref)).toHaveBeenCalledWith(hostileIntakeId);
    },
  );

  it.each(['send_to_entry', 'compare'] as const)(
    '%s fails fast via the prescription helper for a dot-segment intake id',
    (action) => {
      expect(() => INTAKE_ACTION_PRESENTATIONS[action].href(makeRow({ intake_id: '.' }))).toThrow(
        RangeError,
      );
      expect(vi.mocked(buildPrescriptionHref)).toHaveBeenCalledWith('.');
    },
  );

  // Static (non-card) actions ignore the row and must never call the patient helper,
  // even when the row carries a hostile/dot patient id.
  it.each([
    ['to_dashboard', '/dashboard'],
    ['to_audit', '/audit'],
    ['to_dispensing', '/dispense'],
    ['to_set', '/set'],
  ] as const)(
    'static action %s returns %s without calling route helpers',
    (action, expectedHref) => {
      const row = makeRow({ patient_id: '../settings?x=1#y', action });
      expect(INTAKE_ACTION_PRESENTATIONS[action].href(row)).toBe(expectedHref);
      expect(vi.mocked(buildPatientHref)).not.toHaveBeenCalled();
      expect(vi.mocked(buildPrescriptionHref)).not.toHaveBeenCalled();
    },
  );
});
