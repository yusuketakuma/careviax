// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { PatientTimelinePanel } from './patient-timeline-panel';

setupDomTestEnv();

const useOrgIdMock = vi.hoisted(() => vi.fn());
const useQueryMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: useOrgIdMock,
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: useQueryMock,
}));

vi.mock('./patient-activity-timeline', () => ({
  PatientActivityTimeline: () => <div>activity timeline</div>,
}));

describe('PatientTimelinePanel', () => {
  it('renders timeline errors with a semantic section heading', () => {
    useOrgIdMock.mockReturnValue('org_1');
    useQueryMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('患者タイムラインの取得に失敗しました'),
    });

    render(<PatientTimelinePanel patientId="patient_1" enabled />);

    expect(screen.getByRole('heading', { level: 2, name: 'タイムライン' }).tagName).toBe('H2');
    expect(screen.getByText('患者タイムラインの取得に失敗しました')).toBeTruthy();
  });
});
