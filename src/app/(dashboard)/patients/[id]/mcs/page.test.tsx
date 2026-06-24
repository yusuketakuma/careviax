// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import PatientMcsPage from './page';

setupDomTestEnv();

const { patientMcsContentMock } = vi.hoisted(() => ({
  patientMcsContentMock: vi.fn(),
}));

vi.mock('@/components/layout/page-scaffold', () => ({
  PageScaffold: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));

vi.mock('@/components/features/workflow/workflow-page-intro', () => ({
  WorkflowPageIntro: ({
    backHref,
    shortcuts,
  }: {
    backHref: string;
    shortcuts?: Array<{ href: string; label: string }>;
  }) => (
    <header data-testid="workflow-page-intro" data-back-href={backHref}>
      <nav aria-label="ショートカット">
        {shortcuts?.map((shortcut) => (
          <a key={`${shortcut.href}-${shortcut.label}`} href={shortcut.href}>
            {shortcut.label}
          </a>
        ))}
      </nav>
    </header>
  ),
}));

vi.mock('./mcs-content', () => ({
  PatientMcsContent: ({ patientId }: { patientId: string }) => {
    patientMcsContentMock({ patientId });
    return <div data-testid="patient-mcs-content" data-patient-id={patientId} />;
  },
}));

describe('PatientMcsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('encodes navigation path segments while passing the raw id to PatientMcsContent', async () => {
    const patientId = '../settings?x=1#frag';
    const encodedPatientId = encodeURIComponent(patientId);

    render(await PatientMcsPage({ params: Promise.resolve({ id: patientId }) }));

    expect(screen.getByTestId('workflow-page-intro').dataset.backHref).toBe(
      `/patients/${encodedPatientId}`,
    );
    expect(screen.getByTestId('patient-mcs-content').dataset.patientId).toBe(patientId);
    expect(patientMcsContentMock).toHaveBeenCalledWith({ patientId });

    expect(screen.getByRole('link', { name: '患者詳細' }).getAttribute('href')).toBe(
      `/patients/${encodedPatientId}`,
    );
    expect(screen.getByRole('link', { name: '服薬管理' }).getAttribute('href')).toBe(
      `/patients/${encodedPatientId}/medications`,
    );
    expect(screen.getByRole('link', { name: '処方履歴' }).getAttribute('href')).toBe(
      `/patients/${encodedPatientId}/prescriptions`,
    );
    expect(screen.getByRole('link', { name: '外部共有' }).getAttribute('href')).toBe(
      `/patients/${encodedPatientId}/share`,
    );
  });
});
