// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
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
    expect(screen.getByLabelText('病名・課題1件目の区分')).toBeTruthy();
    expect(screen.getByLabelText('病名・課題1件目の名称')).toBeTruthy();
    expect(screen.getByLabelText('病名・課題1件目の把握日')).toBeTruthy();
    expect(screen.getByLabelText('病名・課題1件目のメモ')).toBeTruthy();
    expect(screen.getByLabelText('病名・課題1件目を主要課題にする')).toBeTruthy();
    expect(screen.getByLabelText('病名・課題1件目を有効にする')).toBeTruthy();
    const deleteButton = screen.getByRole('button', { name: '病名・課題1件目を削除' });
    const deleteReason = screen.getByText('病名・課題は最低1件必要です。');
    expect(deleteButton).toHaveProperty('disabled', true);
    expect(deleteButton.getAttribute('aria-describedby')).toBe(deleteReason.id);
    expect(deleteButton.getAttribute('aria-label')).not.toMatch(/心不全|訪問時|patient_1/);
    expect(deleteReason.textContent).not.toMatch(/心不全|訪問時|patient_1/);
    expect(screen.getByRole('button', { name: /行追加/ })).toBeTruthy();
    const saveButton = screen.getByRole('button', { name: '保存' });
    expect(saveButton).toHaveProperty('disabled', false);
    expect(saveButton.getAttribute('aria-describedby')).toBeNull();
  });

  it('does not show the minimum-condition delete reason when multiple rows exist', () => {
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
          {
            id: 'condition_2',
            condition_type: 'problem',
            name: '服薬忘れ',
            is_primary: false,
            is_active: true,
            noted_at: '2026-05-02T00:00:00.000Z',
            notes: '夕食後に確認',
          },
        ]}
      />,
    );

    const firstDelete = screen.getByRole('button', { name: '病名・課題1件目を削除' });

    expect(screen.queryByText('病名・課題は最低1件必要です。')).toBeNull();
    expect(firstDelete).toHaveProperty('disabled', false);
    expect(firstDelete.getAttribute('aria-describedby')).toBeNull();
  });

  it('blocks saving when blank condition rows would persist zero conditions', () => {
    const mutate = vi.fn();
    useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });
    useMutationMock.mockReturnValue({ mutate, isPending: false });

    render(<PatientConditionsCard patientId="patient_1" orgId="org_1" initialConditions={[]} />);

    const saveButton = screen.getByRole('button', { name: '保存' });
    const saveReason = screen.getByText('保存するには病名・課題の名称を入力してください。');

    expect(saveButton).toHaveProperty('disabled', true);
    expect(saveButton.getAttribute('aria-describedby')).toBe(saveReason.id);
    expect(saveReason.textContent).not.toMatch(/patient_1|心不全|訪問時/);

    fireEvent.click(saveButton);

    expect(mutate).not.toHaveBeenCalled();
  });
});
