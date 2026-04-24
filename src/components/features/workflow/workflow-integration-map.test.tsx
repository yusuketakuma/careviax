// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import {
  WORKFLOW_INTEGRATION_HANDOFFS,
  WorkflowIntegrationMap,
} from './workflow-integration-map';

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

describe('WorkflowIntegrationMap', () => {
  it('covers every handoff in the 8-step business route', () => {
    expect(WORKFLOW_INTEGRATION_HANDOFFS.map((item) => [item.from, item.to])).toEqual([
      ['prescriptions', 'dispensing'],
      ['dispensing', 'auditing'],
      ['auditing', 'medication_sets'],
      ['medication_sets', 'set_audit'],
      ['set_audit', 'schedules'],
      ['schedules', 'visits'],
      ['visits', 'reports'],
    ]);
  });

  it('renders user-visible linkage checks and data references', () => {
    render(<WorkflowIntegrationMap />);

    expect(screen.getByText('全機能連動マトリクス')).toBeTruthy();
    expect(screen.getByRole('list', { name: '主業務工程間のデータ連動' })).toBeTruthy();
    expect(screen.getByText('処方情報を調剤キューへ渡す')).toBeTruthy();
    expect(screen.getByText('訪問予定を現地モバイル記録へ渡す')).toBeTruthy();
    expect(screen.getByText('訪問記録を報告書へ展開する')).toBeTruthy();
    expect(screen.getByText('facility_visit_context')).toBeTruthy();
    expect(screen.getByText('StructuredSOAP')).toBeTruthy();
    expect(screen.getAllByRole('link', { name: '報告書' })[0]?.getAttribute('href')).toBe('/reports');
  });
});
