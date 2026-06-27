// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { buildPatientHref } from '@/lib/patient/navigation';
import ConsentPage from './page';

setupDomTestEnv();

vi.mock('@/components/layout/page-scaffold', () => ({
  PageScaffold: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));

vi.mock('@/components/features/workflow/page-shortcut-presets', () => ({
  getPatientConsentShortcutLinks: () => [],
}));

vi.mock('@/components/features/workflow/workflow-page-intro', () => ({
  WorkflowPageIntro: ({ backHref }: { backHref?: string }) => <a href={backHref}>back</a>,
}));

vi.mock('./consent-records-content', () => ({
  ConsentRecordsContent: () => <div data-testid="consent-records-content" />,
}));

vi.mock('@/lib/patient/navigation', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/patient/navigation')>();
  return { ...actual, buildPatientHref: vi.fn(actual.buildPatientHref) };
});

describe('ConsentPage', () => {
  it('routes the patient back link through the shared patient href helper', async () => {
    vi.mocked(buildPatientHref).mockReturnValueOnce('/patients/__helper_patient_1__');

    render(await ConsentPage({ params: Promise.resolve({ id: 'patient_1' }) }));

    expect(buildPatientHref).toHaveBeenCalledWith('patient_1');
    expect(screen.getByRole('link', { name: 'back' }).getAttribute('href')).toBe(
      '/patients/__helper_patient_1__',
    );
    expect(screen.getByTestId('consent-records-content')).toBeTruthy();
  });
});
