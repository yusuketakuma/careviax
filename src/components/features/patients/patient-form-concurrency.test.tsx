// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { jsonResponse } from '@/test/fetch-test-utils';
import { PatientForm } from './patient-form';
import { validPatientDefaults } from './patient-form.test-fixtures';
import type { PatientEditConflictType } from './patient-form-occ';
import { toast } from 'sonner';

setupDomTestEnv();

const useOrgIdMock = vi.hoisted(() => vi.fn(() => 'org_1'));
const useQueryMock = vi.hoisted(() => vi.fn(() => ({ data: [], isLoading: false })));
const allowNavigationMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/hooks/use-org-id', () => ({ useOrgId: useOrgIdMock }));
vi.mock('@tanstack/react-query', () => ({ useQuery: useQueryMock }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ back: vi.fn(), push: vi.fn() }),
}));
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));
vi.mock('@/lib/hooks/use-unsaved-changes-guard', () => ({
  useUnsavedChangesGuard: () => allowNavigationMock,
}));

describe('PatientForm stale OCC recovery', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/patients/patient_1/edit');
    vi.stubGlobal('fetch', vi.fn());
  });

  it.each<PatientEditConflictType>(['stale_patient', 'stale_care_case'])(
    'preserves the draft and requires explicit refresh/reconfirmation before PATCH retry: %s',
    async (conflictType) => {
      const fetchMock = vi.mocked(fetch);
      fetchMock
        .mockResolvedValueOnce(
          jsonResponse(
            {
              message: '患者情報が同時に更新されました。画面を再読み込みしてください',
              details: { conflict_type: conflictType },
            },
            409,
          ),
        )
        .mockResolvedValueOnce(
          jsonResponse({
            data: {
              id: 'patient_1',
              updated_at: '2026-07-22T00:00:02.000Z',
            },
            meta: {
              warnings: [],
              duplicate_candidates: [],
              version_basis: {
                patient_updated_at: '2026-07-22T00:00:02.000Z',
                care_case_id: 'case_1',
                care_case_version: 3,
              },
            },
          }),
        );
      const onRefreshConcurrencyAuthority = vi.fn().mockResolvedValue({
        expectedUpdatedAt: '2026-07-22T00:00:01.000Z',
        selectedCareCase: { id: 'case_1', version: 2 },
      });

      render(
        <PatientForm
          patientId="patient_1"
          defaultValues={{
            ...validPatientDefaults,
            phone: '090-1111-2222',
            intake: { medication_manager: 'self' },
          }}
          expectedUpdatedAt="2026-07-22T00:00:00.000Z"
          selectedCareCase={{ id: 'case_1', version: 1 }}
          onRefreshConcurrencyAuthority={onRefreshConcurrencyAuthority}
        />,
      );

      fireEvent.click(screen.getByRole('button', { name: '保存する' }));

      await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
      expect(fetchMock).toHaveBeenCalledTimes(1);

      fireEvent.click(screen.getByRole('button', { name: '最新の版を確認' }));
      await waitFor(() =>
        expect(screen.getByRole('button', { name: '入力内容を再確認して再送' })).toBeTruthy(),
      );
      expect(onRefreshConcurrencyAuthority).toHaveBeenCalledWith({
        patientId: 'patient_1',
        conflictType,
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);

      fireEvent.click(screen.getByRole('button', { name: '入力内容を再確認して再送' }));
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

      const requests = fetchMock.mock.calls.map(([, init]) => init);
      expect(requests.every((init) => init?.method === 'PATCH')).toBe(true);
      expect(JSON.parse(String(requests[0]?.body))).toMatchObject({
        name: validPatientDefaults.name,
        phone: '090-1111-2222',
      });
      expect(JSON.parse(String(requests[1]?.body))).toMatchObject({
        name: validPatientDefaults.name,
        phone: '090-1111-2222',
        expected_updated_at: '2026-07-22T00:00:01.000Z',
        care_case_id: 'case_1',
        expected_care_case_version: 2,
      });
    },
  );

  it('keeps reconfirmation required when a retry receives a mismatched 2xx acknowledgement', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(
          {
            message: '患者情報が同時に更新されました。画面を再読み込みしてください',
            details: { conflict_type: 'stale_care_case' },
          },
          409,
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            id: 'patient_1',
            updated_at: '2026-07-22T00:00:02.000Z',
          },
          meta: {
            warnings: [],
            duplicate_candidates: [],
            version_basis: {
              patient_updated_at: '2026-07-22T00:00:02.000Z',
              care_case_id: 'case_1',
              care_case_version: 99,
            },
          },
        }),
      );
    const onRefreshConcurrencyAuthority = vi.fn().mockResolvedValue({
      expectedUpdatedAt: '2026-07-22T00:00:01.000Z',
      selectedCareCase: { id: 'case_1', version: 2 },
    });
    const successCallCount = vi.mocked(toast.success).mock.calls.length;
    const allowNavigationCallCount = allowNavigationMock.mock.calls.length;

    render(
      <PatientForm
        patientId="patient_1"
        defaultValues={{
          ...validPatientDefaults,
          intake: { medication_manager: 'self' },
        }}
        expectedUpdatedAt="2026-07-22T00:00:00.000Z"
        selectedCareCase={{ id: 'case_1', version: 1 }}
        onRefreshConcurrencyAuthority={onRefreshConcurrencyAuthority}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '保存する' }));
    await waitFor(() => screen.getByRole('button', { name: '最新の版を確認' }));
    fireEvent.click(screen.getByRole('button', { name: '最新の版を確認' }));
    await waitFor(() => screen.getByRole('button', { name: '入力内容を再確認して再送' }));
    fireEvent.click(screen.getByRole('button', { name: '入力内容を再確認して再送' }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('更新に失敗しました');
      expect(screen.getByRole('button', { name: '入力内容を再確認して再送' })).toBeTruthy();
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(toast.success).toHaveBeenCalledTimes(successCallCount);
    expect(allowNavigationMock).toHaveBeenCalledTimes(allowNavigationCallCount);
  });

  it('rejects a 2xx acknowledgement missing data.updated_at and permits a normal retry', async () => {
    const fetchMock = vi.mocked(fetch);
    const basis = {
      patient_updated_at: '2026-07-22T00:00:01.000Z',
      care_case_id: null,
      care_case_version: null,
    };
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          data: { id: 'patient_1' },
          meta: { warnings: [], duplicate_candidates: [], version_basis: basis },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: { id: 'patient_1', updated_at: basis.patient_updated_at },
          meta: { warnings: [], duplicate_candidates: [], version_basis: basis },
        }),
      );
    const successCallCount = vi.mocked(toast.success).mock.calls.length;
    const allowNavigationCallCount = allowNavigationMock.mock.calls.length;

    render(
      <PatientForm
        patientId="patient_1"
        defaultValues={validPatientDefaults}
        expectedUpdatedAt="2026-07-22T00:00:00.000Z"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '保存する' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('更新に失敗しました'));
    expect(toast.success).toHaveBeenCalledTimes(successCallCount);
    expect(allowNavigationMock).toHaveBeenCalledTimes(allowNavigationCallCount);

    fireEvent.click(screen.getByRole('button', { name: '保存する' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(toast.success).toHaveBeenCalledTimes(successCallCount + 1);
  });
});
