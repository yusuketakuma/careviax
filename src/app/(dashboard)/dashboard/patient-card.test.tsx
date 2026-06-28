// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { buildPatientHref } from '@/lib/patient/navigation';
import type { PatientCard } from '@/types/dashboard-home';
import { PatientCardItem } from './patient-card';

setupDomTestEnv();

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('@/lib/patient/navigation', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/patient/navigation')>();
  return { ...actual, buildPatientHref: vi.fn(actual.buildPatientHref) };
});

const patient: PatientCard = {
  patient_id: 'pt/1?tab=x#frag&case_id=evil',
  patient_name: '山田 花子',
  birth_date: '1950-01-01T00:00:00.000Z',
  address: null,
  phone: null,
  conditions: [],
  last_prescription_date: null,
  last_visit_date: null,
  next_prescription_date: null,
  next_visit_date: null,
  next_visit_type: null,
  case_id: 'case/1?x=y#z&patient_id=evil',
  status_icon: 'stable',
  readiness_flags: {
    missing_emergency_contact: true,
    missing_primary_physician: false,
    missing_first_visit_doc: false,
  },
};

describe('PatientCardItem', () => {
  it('uses shared patient href and URLSearchParams for action links', () => {
    vi.mocked(buildPatientHref).mockReturnValue('/patients/__helper_patient__');

    render(<PatientCardItem patient={patient} />);

    expect(buildPatientHref).toHaveBeenCalledTimes(2);
    expect(buildPatientHref).toHaveBeenNthCalledWith(1, patient.patient_id);
    expect(buildPatientHref).toHaveBeenNthCalledWith(2, patient.patient_id);
    expect(screen.getByRole('link', { name: '山田 花子' }).getAttribute('href')).toBe(
      '/patients/__helper_patient__',
    );
    expect(screen.getByRole('link', { name: '前提確認' }).getAttribute('href')).toBe(
      '/patients/__helper_patient__',
    );

    const intakeHref = screen.getByRole('link', { name: /処方受付/ }).getAttribute('href');
    expect(intakeHref).toBe(
      `/prescriptions/new?${new URLSearchParams({
        patient_id: patient.patient_id,
        case_id: patient.case_id ?? '',
      }).toString()}`,
    );
    expect(intakeHref).not.toContain('?tab=x');
    expect(intakeHref).not.toContain('#frag');
    expect(intakeHref).not.toContain('&patient_id=evil');
  });
});
