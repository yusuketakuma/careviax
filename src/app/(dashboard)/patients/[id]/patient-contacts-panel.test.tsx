// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
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
    error: vi.fn(),
  },
}));

import { PatientContactsPanel } from './patient-contacts-panel';

setupDomTestEnv();

describe('PatientContactsPanel', () => {
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
    expect(screen.getByRole('button', { name: /行追加/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: '保存' })).toBeTruthy();
  });
});
