// @vitest-environment jsdom

import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { buildPatientHref } from '@/lib/patient/navigation';

const workflowIntroMock = vi.hoisted(() => vi.fn());
const patientEditContentMock = vi.hoisted(() => vi.fn());

vi.mock('@/components/layout/page-scaffold', () => ({
  PageScaffold: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/features/workflow/page-shortcut-presets', () => ({
  getPatientEditShortcutLinks: vi.fn(() => []),
}));

vi.mock('@/components/features/workflow/workflow-page-intro', () => ({
  WorkflowPageIntro: (props: unknown) => {
    workflowIntroMock(props);
    return <div>workflow intro</div>;
  },
}));

vi.mock('@/lib/patient/navigation', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/patient/navigation')>();
  return { ...actual, buildPatientHref: vi.fn(actual.buildPatientHref) };
});

vi.mock('./patient-edit-content', () => ({
  PatientEditContent: (props: unknown) => {
    patientEditContentMock(props);
    return <div>patient edit content</div>;
  },
}));

import PatientEditPage from './page';

setupDomTestEnv();

describe('PatientEditPage', () => {
  it('routes the back link through the shared patient href helper', async () => {
    vi.mocked(buildPatientHref).mockReturnValueOnce('/patients/__helper_patient_1__');

    render(await PatientEditPage({ params: Promise.resolve({ id: 'patient_1' }) }));

    expect(buildPatientHref).toHaveBeenCalledWith('patient_1');
    expect(workflowIntroMock).toHaveBeenCalledWith(
      expect.objectContaining({
        backHref: '/patients/__helper_patient_1__',
      }),
    );
    expect(workflowIntroMock).not.toHaveBeenCalledWith(
      expect.objectContaining({
        backHref: '/patients/patient_1',
      }),
    );
    expect(patientEditContentMock).toHaveBeenCalledWith({ patientId: 'patient_1' });
  });
});
