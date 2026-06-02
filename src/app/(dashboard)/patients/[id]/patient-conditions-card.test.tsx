// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { PatientConditionsCard } from './patient-conditions-card';

setupDomTestEnv();

const useMutationMock = vi.hoisted(() => vi.fn());
const useQueryClientMock = vi.hoisted(() => vi.fn());

vi.mock('@tanstack/react-query', () => ({
  useMutation: useMutationMock,
  useQueryClient: useQueryClientMock,
}));

describe('PatientConditionsCard', () => {
  it('renders condition editing with a semantic section heading and shared actions', () => {
    useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });
    useMutationMock.mockReturnValue({ mutate: vi.fn(), isPending: false });

    render(
      <PatientConditionsCard
        patientId="patient_1"
        orgId="org_1"
        initialConditions={[
          {
            id: 'condition_1',
            condition_type: 'disease',
            name: '心不全',
            is_primary: true,
            is_active: true,
            noted_at: '2026-05-01T00:00:00.000Z',
            notes: '訪問時に息切れ確認',
          },
        ]}
      />,
    );

    expect(screen.getByRole('heading', { level: 2, name: '病名・課題リスト' }).tagName).toBe('H2');
    expect(screen.getByText('疾患: 心不全')).toBeTruthy();
    expect(screen.getByRole('button', { name: /行追加/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: '保存' })).toBeTruthy();
  });
});
