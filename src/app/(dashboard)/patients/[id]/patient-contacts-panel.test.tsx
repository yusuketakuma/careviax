// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';

const useMutationMock = vi.hoisted(() => vi.fn());
const useQueryClientMock = vi.hoisted(() => vi.fn());

vi.mock('@tanstack/react-query', () => ({
  useMutation: useMutationMock,
  useQueryClient: useQueryClientMock,
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  },
}));

import { PatientContactsPanel } from './patient-contacts-panel';
import { toast } from 'sonner';

setupDomTestEnv();

describe('PatientContactsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders contact editing with a semantic section heading and shared actions', () => {
    useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });
    useMutationMock.mockReturnValue({ mutate: vi.fn(), isPending: false });

    render(
      <PatientContactsPanel
        patientId="patient_1"
        orgId="org_1"
        initialContacts={[
          {
            id: 'contact_1',
            relation: 'child',
            name: '山田太郎',
            phone: '090-0000-0000',
            email: null,
            fax: null,
            organization_name: null,
            department: null,
            address: null,
            is_primary: true,
            is_emergency_contact: true,
            notes: null,
          },
        ]}
      />,
    );

    expect(screen.getByRole('heading', { level: 2, name: '患者・家族連絡先' }).tagName).toBe('H2');
    expect(screen.getByText('子: 山田太郎')).toBeTruthy();
    expect(screen.getByLabelText('連絡先1件目の関係')).toBeTruthy();
    expect(screen.getByLabelText('連絡先1件目の氏名')).toBeTruthy();
    expect(screen.getByLabelText('連絡先1件目の電話番号')).toBeTruthy();
    expect(screen.getByLabelText('連絡先1件目のメール')).toBeTruthy();
    expect(screen.getByLabelText('連絡先1件目の組織名')).toBeTruthy();
    expect(screen.getByLabelText('連絡先1件目の部署')).toBeTruthy();
    expect(screen.getByLabelText('連絡先1件目のFAX')).toBeTruthy();
    expect(screen.getByLabelText('連絡先1件目の住所')).toBeTruthy();
    expect(screen.getByLabelText('連絡先1件目のメモ')).toBeTruthy();
    const deleteButton = screen.getByRole('button', { name: '連絡先1件目を削除' });
    const deleteReason = screen.getByText('連絡先は最低1件必要です。');
    expect(deleteButton).toHaveProperty('disabled', true);
    expect(deleteButton.getAttribute('aria-describedby')).toBe(deleteReason.id);
    expect(deleteButton.getAttribute('aria-label')).not.toMatch(/山田|090-0000-0000|family/);
    expect(deleteReason.textContent).not.toMatch(/山田|090-0000-0000|family/);
    expect(screen.getByRole('button', { name: /行追加/ })).toBeTruthy();
    const saveButton = screen.getByRole('button', { name: '保存' });
    expect(saveButton).toHaveProperty('disabled', false);
    expect(saveButton.getAttribute('aria-describedby')).toBeNull();
  });

  it('does not show the minimum-contact delete reason when multiple rows exist', () => {
    useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });
    useMutationMock.mockReturnValue({ mutate: vi.fn(), isPending: false });

    render(
      <PatientContactsPanel
        patientId="patient_1"
        orgId="org_1"
        initialContacts={[
          {
            id: 'contact_1',
            relation: 'child',
            name: '山田太郎',
            phone: '090-0000-0000',
            email: null,
            fax: null,
            organization_name: null,
            department: null,
            address: null,
            is_primary: true,
            is_emergency_contact: true,
            notes: null,
          },
          {
            id: 'contact_2',
            relation: 'care_manager',
            name: '佐藤花子',
            phone: '080-0000-0000',
            email: null,
            fax: null,
            organization_name: null,
            department: null,
            address: null,
            is_primary: false,
            is_emergency_contact: false,
            notes: null,
          },
        ]}
      />,
    );

    const firstDelete = screen.getByRole('button', { name: '連絡先1件目を削除' });

    expect(screen.queryByText('連絡先は最低1件必要です。')).toBeNull();
    expect(firstDelete).toHaveProperty('disabled', false);
    expect(firstDelete.getAttribute('aria-describedby')).toBeNull();
  });

  it('blocks saving when blank contact rows would persist zero contacts', () => {
    const mutate = vi.fn();
    useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });
    useMutationMock.mockReturnValue({ mutate, isPending: false });

    render(<PatientContactsPanel patientId="patient_1" orgId="org_1" initialContacts={[]} />);

    const saveButton = screen.getByRole('button', { name: '保存' });
    const saveReason = screen.getByText('保存するには連絡先の氏名を入力してください。');

    expect(saveButton).toHaveProperty('disabled', true);
    expect(saveButton.getAttribute('aria-describedby')).toBe(saveReason.id);
    expect(saveReason.textContent).not.toMatch(/patient_1|090|山田|family/);

    fireEvent.click(saveButton);

    expect(mutate).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('shows reliability warnings returned by the contacts save API', () => {
    useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });
    useMutationMock.mockImplementation((config) => ({
      mutate: () =>
        config.onSuccess?.({
          warnings: [
            {
              code: 'PATIENT_CONTACT_UNREADY',
              severity: 'warning',
              message: '訪問前連絡が必要ですが電話可能な連絡先が未確認です。',
            },
          ],
        }),
      isPending: false,
    }));

    render(
      <PatientContactsPanel
        patientId="patient_1"
        orgId="org_1"
        initialContacts={[
          {
            id: 'contact_1',
            relation: 'child',
            name: '山田太郎',
            phone: '',
            email: 'family@example.com',
            fax: null,
            organization_name: null,
            department: null,
            address: null,
            is_primary: true,
            is_emergency_contact: false,
            notes: null,
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    expect(toast.warning).toHaveBeenCalledWith(
      '訪問前連絡が必要ですが電話可能な連絡先が未確認です。',
    );
  });
});
