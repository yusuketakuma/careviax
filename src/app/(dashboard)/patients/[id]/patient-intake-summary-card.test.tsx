// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { PatientIntakeSummaryCard } from './patient-intake-summary-card';

setupDomTestEnv();

describe('PatientIntakeSummaryCard', () => {
  it('renders the intake summary with a semantic section heading', () => {
    vi.setSystemTime(new Date('2026-06-02T00:00:00+09:00'));

    render(
      <PatientIntakeSummaryCard
        patient={{
          name: '山田花子',
          name_kana: 'ヤマダハナコ',
          birth_date: '1946-06-01',
          gender: 'female',
          residences: [
            {
              address: '東京都千代田区1-1',
              unit_name: '101号室',
              is_primary: true,
            },
          ],
          cases: [
            {
              id: 'case_1',
              created_at: '2026-06-01T00:00:00.000Z',
              required_visit_support: {
                home_visit_intake: {
                  requester: {
                    organization_name: '千代田ケア',
                    profession: 'care',
                    contact_name: '佐藤',
                    phone: '03-0000-0000',
                    preferred_contact_method: 'phone',
                  },
                  reported_age: 80,
                  primary_disease: '心不全',
                  housing_type: 'apartment',
                  primary_contact_preference: 'phone',
                  visit_before_contact_required: true,
                  care_level: 'care_2',
                  medication_support_methods: ['calendar', 'box'],
                  special_medical_procedures: ['tpn'],
                },
              },
            },
          ],
          scheduling_preference: {
            adl_level: 'b',
            dementia_level: 'ii',
            swallowing_route: '経口',
            care_level: 'care_3',
            infection_isolation: false,
          },
        }}
      />,
    );

    expect(
      screen.getByRole('heading', { level: 2, name: '訪問薬剤管理 新規依頼受付票' }).tagName,
    ).toBe('H2');
    expect(screen.getByText('A. 依頼元情報')).toBeTruthy();
    expect(screen.getByText('千代田ケア')).toBeTruthy();
    expect(screen.getByText('山田花子 / ヤマダハナコ')).toBeTruthy();
    expect(screen.getByText('カレンダー / BOX')).toBeTruthy();
  });
});
