// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PageShortcutLinks } from './page-shortcut-links';

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

describe('PageShortcutLinks', () => {
  it('renders a simple flat rail when no group is provided', () => {
    render(
      <PageShortcutLinks
        links={[
          { href: '/patients', label: '患者一覧' },
          { href: '/workflow', label: 'ワークフロー' },
        ]}
      />,
    );

    expect(screen.queryByText('診療・服薬')).toBeNull();
    const patients = screen.getByRole('link', { name: '患者一覧' });
    const workflow = screen.getByRole('link', { name: 'ワークフロー' });
    expect(patients).toBeTruthy();
    expect(workflow).toBeTruthy();
    expect(patients.className).toContain('min-h-[44px]');
    expect(patients.className).toContain('sm:min-h-[44px]');
    expect(patients.className).not.toContain('sm:min-h-0');
  });

  it('renders grouped shortcut sections when groups are provided', () => {
    render(
      <PageShortcutLinks
        links={[
          { href: '/patients/p1/prescriptions', label: '処方履歴', group: '服薬・経過' },
          { href: '/patients/p1/share', label: '外部共有', group: '連携・共有' },
        ]}
      />,
    );

    expect(screen.getByText('服薬・経過')).toBeTruthy();
    expect(screen.getByText('連携・共有')).toBeTruthy();
    const prescriptionHistory = screen.getByRole('link', { name: '処方履歴' });
    expect(prescriptionHistory).toBeTruthy();
    expect(screen.getByRole('link', { name: '外部共有' })).toBeTruthy();
    expect(prescriptionHistory.className).toContain('min-h-[44px]');
    expect(prescriptionHistory.className).toContain('sm:min-h-[44px]');
    expect(prescriptionHistory.className).not.toContain('sm:min-h-0');
  });
});
