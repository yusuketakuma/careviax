// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

const useQueryMock = vi.hoisted(() => vi.fn());
const useMutationMock = vi.hoisted(() => vi.fn());
const useQueryClientMock = vi.hoisted(() => vi.fn());

vi.mock('@tanstack/react-query', () => ({
  useMutation: useMutationMock,
  useQuery: useQueryMock,
  useQueryClient: useQueryClientMock,
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import { PatientCareTeamPanel } from './patient-care-team-panel';

setupDomTestEnv();

describe('PatientCareTeamPanel', () => {
  it('renders care team editing with a semantic section heading and shared actions', () => {
    useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });
    useQueryMock.mockReturnValue({ data: { data: [] } });
    useMutationMock.mockReturnValue({ mutate: vi.fn(), isPending: false });

    render(
      <PatientCareTeamPanel
        patientId="patient_1"
        orgId="org_1"
        cases={[
          {
            id: 'case_active_123456',
            status: 'active',
            care_team_links: [
              {
                id: 'link_1',
                external_professional_id: null,
                role: 'physician',
                name: '佐藤医師',
                organization_name: '千代田クリニック',
                department: '在宅診療',
                phone: '03-0000-0000',
                email: null,
                fax: null,
                address: null,
                is_primary: true,
                notes: '主治医',
              },
            ],
          },
        ]}
      />,
    );

    expect(screen.getByRole('heading', { level: 2, name: '多職種連携先' }).tagName).toBe('H2');
    expect(screen.getByDisplayValue('佐藤医師')).toBeTruthy();
    expect(screen.getByDisplayValue('千代田クリニック')).toBeTruthy();
    expect(screen.getByRole('button', { name: /行追加/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: '保存' })).toBeTruthy();
  });
});
