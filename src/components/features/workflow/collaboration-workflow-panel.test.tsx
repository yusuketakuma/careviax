// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { CollaborationWorkflowPanel } from './collaboration-workflow-panel';

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

describe('CollaborationWorkflowPanel', () => {
  it('shows collaboration touchpoints across the main workflow', () => {
    render(<CollaborationWorkflowPanel focus="conference" />);

    expect(screen.getByText('他職種連携の接続点')).toBeTruthy();
    expect(screen.getByText('処方登録・調剤監査')).toBeTruthy();
    expect(screen.getByText('スケジュール登録・訪問時')).toBeTruthy();
    expect(screen.getByText('訪問時・報告書')).toBeTruthy();
    expect(screen.getByText('報告書')).toBeTruthy();
    expect(screen.getByText('連携先マスター')).toBeTruthy();
    expect(screen.getByRole('link', { name: /カンファレンスを開く/ }).getAttribute('href')).toBe(
      '/conferences',
    );
    expect(screen.getByRole('link', { name: /他職種マスターを開く/ }).getAttribute('href')).toBe(
      '/admin/external-professionals',
    );
  });
});
