import { describe, expect, it, vi } from 'vitest';
import { redirect } from 'next/navigation';
import { buildPatientHref } from '@/lib/patient/navigation';
import PatientManagementPlanPage from './page';

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
}));

vi.mock('@/lib/patient/navigation', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/patient/navigation')>();
  return { ...actual, buildPatientHref: vi.fn(actual.buildPatientHref) };
});

describe('PatientManagementPlanPage', () => {
  it('routes the legacy management-plan redirect through the shared patient href helper', async () => {
    vi.mocked(buildPatientHref).mockReturnValueOnce('/patients/__helper_patient_1__');

    await PatientManagementPlanPage({ params: Promise.resolve({ id: 'patient_1' }) });

    expect(buildPatientHref).toHaveBeenCalledWith('patient_1');
    expect(redirect).toHaveBeenCalledWith('/patients/__helper_patient_1__');
    expect(redirect).not.toHaveBeenCalledWith('/patients/patient_1');
  });
});
