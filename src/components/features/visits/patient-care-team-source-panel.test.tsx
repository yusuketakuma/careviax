// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { PatientCareTeamSourcePanel } from './patient-care-team-source-panel';

setupDomTestEnv();

describe('PatientCareTeamSourcePanel', () => {
  it('shows patient-care-team contacts and missing report recipients', () => {
    render(
      <PatientCareTeamSourcePanel
        contacts={[
          {
            id: 'team_1',
            role: 'physician',
            name: '佐藤医師',
            organization_name: '佐藤クリニック',
            phone: '03-0000-0001',
          },
          {
            id: 'team_2',
            role: 'care_manager',
            name: '田中ケアマネ',
            organization_name: '支援事業所',
            phone: null,
          },
        ]}
      />,
    );

    expect(screen.getByText('患者情報から取得した連携先')).toBeTruthy();
    expect(screen.getByText('佐藤医師')).toBeTruthy();
    expect(screen.getByText('田中ケアマネ')).toBeTruthy();
    expect(screen.getByText('未登録: 訪問看護')).toBeTruthy();
    expect(screen.getByText('電話番号未登録')).toBeTruthy();
  });

  it('normalizes external-professional role aliases', () => {
    render(
      <PatientCareTeamSourcePanel
        contacts={[
          {
            id: 'team_1',
            role: 'doctor',
            name: '佐藤医師',
            organization_name: '佐藤クリニック',
            phone: null,
          },
          {
            id: 'team_2',
            role: 'visiting_nurse',
            name: '訪看 太郎',
            organization_name: '訪問看護ST',
            phone: null,
          },
          {
            id: 'team_3',
            role: 'cm',
            name: '田中ケアマネ',
            organization_name: '支援事業所',
            phone: null,
          },
        ]}
      />,
    );

    expect(screen.getByText((_content, element) => element?.textContent === '3件 / 不足 0件')).toBeTruthy();
    expect(screen.queryByText(/未登録:/)).toBeNull();
  });
});
