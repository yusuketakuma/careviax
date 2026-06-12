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

import { careTeamContactBadges, PatientCareTeamPanel } from './patient-care-team-panel';

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

describe('careTeamContactBadges', () => {
  it('warns when a document-channel role is missing a fax number', () => {
    expect(
      careTeamContactBadges({ role: 'care_manager', fax: '', email: '', phone: '03-0000-0000' }),
    ).toEqual([
      { label: 'FAX未登録', tone: 'alert' },
      { label: '電話のみ', tone: 'muted' },
    ]);
  });

  it('marks registered fax and email channels as ok', () => {
    expect(
      careTeamContactBadges({
        role: 'physician',
        fax: '03-1234-5678',
        email: 'doctor@example.jp',
        phone: '',
      }),
    ).toEqual([
      { label: 'FAX登録済', tone: 'ok' },
      { label: 'メールOK', tone: 'ok' },
    ]);
  });

  it('shows phone-only for family-like contacts without fax warning', () => {
    expect(
      careTeamContactBadges({ role: 'other', fax: '', email: '', phone: '090-0000-0000' }),
    ).toEqual([{ label: '電話のみ', tone: 'muted' }]);
  });

  it('alerts when no contact channel is registered at all', () => {
    expect(careTeamContactBadges({ role: 'other', fax: '', email: '', phone: '' })).toEqual([
      { label: '連絡先未登録', tone: 'alert' },
    ]);
  });
});
