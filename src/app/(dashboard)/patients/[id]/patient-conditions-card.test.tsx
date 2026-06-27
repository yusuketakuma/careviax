// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { buildPatientApiPath } from '@/lib/patient/api-paths';
import { PatientConditionsCard } from './patient-conditions-card';

setupDomTestEnv();

const useMutationMock = vi.hoisted(() => vi.fn());
const useQueryClientMock = vi.hoisted(() => vi.fn());

vi.mock('@tanstack/react-query', () => ({
  useMutation: useMutationMock,
  useQueryClient: useQueryClientMock,
}));

vi.mock('@/lib/patient/api-paths', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/patient/api-paths')>();
  return { ...actual, buildPatientApiPath: vi.fn(actual.buildPatientApiPath) };
});

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

  const sampleConditions = [
    {
      id: 'condition_1',
      condition_type: 'disease' as const,
      name: '心不全',
      is_primary: true,
      is_active: true,
      noted_at: '2026-05-01T00:00:00.000Z',
      notes: '訪問時に息切れ確認',
    },
  ];

  it('saves conditions to an encoded patient path with shared JSON headers and a raw payload', async () => {
    const hostileId = 'pt/1?x=y#z';
    useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });

    let savedConfig: { mutationFn: () => Promise<unknown> } | undefined;
    useMutationMock.mockImplementation((config: { mutationFn: () => Promise<unknown> }) => {
      savedConfig = config;
      return { mutate: vi.fn(), isPending: false };
    });

    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue({ ok: true, json: () => Promise.resolve({}) } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);

    try {
      render(
        <PatientConditionsCard
          patientId={hostileId}
          orgId="org_1"
          initialConditions={sampleConditions}
        />,
      );

      await savedConfig?.mutationFn();

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`/api/patients/${encodeURIComponent(hostileId)}/conditions`);
      expect(url).not.toContain('?x=y');
      expect(url).not.toContain('#z');
      expect(url).not.toContain('%25');
      expect(init.method).toBe('PUT');
      const headers = init.headers as Record<string, string>;
      expect(headers['Content-Type']).toBe('application/json');
      expect(headers['x-org-id']).toBe('org_1');
      // payload preserves the mapped conditions verbatim; no patient id leaks into the body.
      const body = JSON.parse(init.body as string);
      expect(body.conditions).toEqual([
        {
          condition_type: 'disease',
          name: '心不全',
          is_primary: true,
          is_active: true,
          noted_at: '2026-05-01',
          notes: '訪問時に息切れ確認',
        },
      ]);
      expect(init.body as string).not.toContain(hostileId);
    } finally {
      vi.unstubAllGlobals();
      vi.clearAllMocks();
    }
  });

  it('routes condition saves through the shared patient API path helper', async () => {
    const patientId = 'patient_1';
    vi.mocked(buildPatientApiPath).mockReturnValueOnce(
      '/api/patients/__helper_patient_1__/conditions',
    );
    useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });

    let savedConfig: { mutationFn: () => Promise<unknown> } | undefined;
    useMutationMock.mockImplementation((config: { mutationFn: () => Promise<unknown> }) => {
      savedConfig = config;
      return { mutate: vi.fn(), isPending: false };
    });

    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue({ ok: true, json: () => Promise.resolve({}) } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);

    try {
      render(
        <PatientConditionsCard
          patientId={patientId}
          orgId="org_1"
          initialConditions={sampleConditions}
        />,
      );

      await savedConfig?.mutationFn();

      expect(buildPatientApiPath).toHaveBeenCalledWith(patientId, '/conditions');
      expect(fetchMock).toHaveBeenCalledWith('/api/patients/__helper_patient_1__/conditions', {
        method: 'PUT',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'x-org-id': 'org_1',
        }),
        body: expect.any(String),
      });
      expect(fetchMock).not.toHaveBeenCalledWith(`/api/patients/${patientId}/conditions`, {
        method: 'PUT',
        headers: expect.anything(),
        body: expect.any(String),
      });
    } finally {
      vi.unstubAllGlobals();
      vi.clearAllMocks();
    }
  });

  it.each(['.', '..'])(
    'fails closed without fetching for exact dot-segment patientId %p',
    async (dotId) => {
      useQueryClientMock.mockReturnValue({ invalidateQueries: vi.fn() });

      let savedConfig: { mutationFn: () => Promise<unknown> } | undefined;
      useMutationMock.mockImplementation((config: { mutationFn: () => Promise<unknown> }) => {
        savedConfig = config;
        return { mutate: vi.fn(), isPending: false };
      });

      const fetchMock = vi.fn<typeof fetch>();
      vi.stubGlobal('fetch', fetchMock);

      try {
        render(
          <PatientConditionsCard
            patientId={dotId}
            orgId="org_1"
            initialConditions={sampleConditions}
          />,
        );
        await expect(savedConfig?.mutationFn()).rejects.toThrow(RangeError);
        expect(fetchMock).not.toHaveBeenCalled();
      } finally {
        vi.unstubAllGlobals();
        vi.clearAllMocks();
      }
    },
  );
});
