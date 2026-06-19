// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

const useQueryMock = vi.hoisted(() => vi.fn());
const useQueryClientMock = vi.hoisted(() => vi.fn());

vi.mock('@tanstack/react-query', () => ({
  useQuery: useQueryMock,
  useQueryClient: useQueryClientMock,
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import { CasesTab } from './cases-tab';

setupDomTestEnv();

describe('CasesTab', () => {
  it('renders case groups with semantic headings and grouped actions', () => {
    useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });
    useQueryMock.mockReturnValue({
      data: {
        data: [
          {
            id: 'pharmacist_1',
            name: '佐藤薬剤師',
            site_name: '本店',
          },
        ],
      },
    });

    render(
      <CasesTab
        orgId="org_1"
        patient={{
          id: 'patient_1',
          name: '山田花子',
          cases: [
            {
              id: 'case_abcdef',
              status: 'active',
              primary_pharmacist_id: null,
              backup_pharmacist_id: null,
              referral_source: '居宅介護支援事業所',
              referral_date: '2026-06-01',
              start_date: '2026-06-02',
              end_date: null,
              end_reason: null,
              notes: '初回訪問を調整中',
              required_visit_support: null,
              created_at: '2026-06-01T00:00:00.000Z',
              updated_at: '2026-06-01T00:00:00.000Z',
              care_team_links: [],
            },
          ],
        }}
      />,
    );

    expect(screen.getByRole('button', { name: 'ケース追加' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'ケース #ABCDEF' }).tagName).toBe('H2');
    expect(screen.getByRole('heading', { level: 3, name: 'ケース情報' }).tagName).toBe('H3');
    expect(screen.getByRole('button', { name: 'ケース情報を保存' })).toBeTruthy();
    expect(screen.getByLabelText('ケース1件目の紹介元')).toBeTruthy();
    expect(screen.getByLabelText('ケース1件目の紹介日')).toBeTruthy();
    expect(screen.getByLabelText('ケース1件目の開始日')).toBeTruthy();
    expect(screen.getByLabelText('ケース1件目の終了日')).toBeTruthy();
    expect(screen.getByLabelText('主担当薬剤師')).toBeTruthy();
    expect(screen.getByLabelText('代替薬剤師')).toBeTruthy();
    expect(screen.getByLabelText('ケース1件目の終了理由')).toBeTruthy();
    expect(screen.getByLabelText('ケース1件目のケースメモ')).toBeTruthy();
    expect(screen.getByText('居宅介護支援事業所')).toBeTruthy();
  });
});
