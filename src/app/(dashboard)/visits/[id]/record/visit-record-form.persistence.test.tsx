// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createQueryClientWrapper } from '@/test/query-client-test-utils';
import {
  registerDefaultVisitRecordFormHooks,
  getVisitRecordFormTestMocks,
} from './visit-record-form.test-support';

const {
  routerPushMock,
  visitRecordPostBodies,
  saveDraftMock,
  refreshSyncCountMock,
  refreshSyncStateMock,
  offlineStoreState,
  toastErrorMock,
  toastSuccessMock,
  toastWarningMock,
  clientLogWarnMock,
  fetchUrls,
  medicationStockPanelCalls,
  submitVisitMedicationStockObservationsMock,
} = getVisitRecordFormTestMocks();
const { VisitRecordForm } = await import('./visit-record-form');

function renderVisitRecordForm({
  id = 'schedule_partial',
  medicationStockObservationWriteEnabled = false,
}: { id?: string; medicationStockObservationWriteEnabled?: boolean } = {}) {
  return render(
    <VisitRecordForm
      id={id}
      facilityVisitContext={null}
      medicationStockObservationWriteEnabled={medicationStockObservationWriteEnabled}
    />,
    { wrapper: createQueryClientWrapper() },
  );
}

describe('VisitRecordForm persistence and medication stock', () => {
  registerDefaultVisitRecordFormHooks();

  it('logs count refresh failures without rejecting from the polling timer', async () => {
    refreshSyncCountMock.mockRejectedValue(
      new Error('IndexedDB unavailable patient=患者A token=secret'),
    );
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    renderVisitRecordForm();

    await waitFor(() => {
      expect(consoleWarn).toHaveBeenCalledWith('[offline-sync] sync count refresh failed');
    });
    expect(JSON.stringify(consoleWarn.mock.calls)).not.toContain('患者A');
    expect(JSON.stringify(consoleWarn.mock.calls)).not.toContain('token=secret');
    expect(refreshSyncStateMock).not.toHaveBeenCalled();

    consoleWarn.mockRestore();
  });

  it('debounces important visit draft autosave for five seconds after the latest edit', async () => {
    renderVisitRecordForm();

    await waitFor(() => {
      expect((document.querySelector('input[name="patient_id"]') as HTMLInputElement)?.value).toBe(
        'patient_1',
      );
    });

    saveDraftMock.mockClear();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      fireEvent.change(screen.getByLabelText('主観情報'), {
        target: { value: '眠気が強い' },
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(4_999);
      });
      expect(saveDraftMock).not.toHaveBeenCalled();

      fireEvent.change(screen.getByLabelText('主観情報'), {
        target: { value: '眠気が改善' },
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(4_999);
      });
      expect(saveDraftMock).not.toHaveBeenCalled();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });

      expect(saveDraftMock).toHaveBeenCalledTimes(1);
      expect(saveDraftMock.mock.calls[0]?.[0]).toMatchObject({
        subjective: { free_text: '眠気が改善' },
      });
      expect(JSON.stringify(saveDraftMock.mock.calls)).not.toContain('眠気が強い');
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows a persistent PHI-safe save state indicator in the fixed action bar', async () => {
    const { rerender } = renderVisitRecordForm();

    await waitFor(() => {
      expect((document.querySelector('input[name="patient_id"]') as HTMLInputElement)?.value).toBe(
        'patient_1',
      );
    });

    await waitFor(() => {
      expect(screen.getByTestId('visit-save-state-indicator').textContent).toContain('未保存');
    });

    offlineStoreState.pendingSyncCount = 2;
    offlineStoreState.pendingQueue = [
      {
        id: 1,
        entityType: 'visit_record',
        payload: { schedule_id: 'schedule_other' },
        scope_id: 'schedule_other',
        createdAt: new Date('2026-07-13T00:00:00.000Z'),
        retryCount: 0,
        conflict: null,
      },
    ];
    rerender(<VisitRecordForm id="schedule_partial" facilityVisitContext={null} />);
    expect(screen.getByTestId('visit-save-state-indicator').textContent).toContain('未保存');
    expect(screen.getByTestId('visit-mobile-mode-header').textContent).not.toContain('未同期 1件');

    offlineStoreState.pendingQueue = [
      {
        ...offlineStoreState.pendingQueue[0]!,
        scope_id: 'schedule_partial',
        payload: { schedule_id: 'schedule_partial' },
      },
    ];
    rerender(<VisitRecordForm id="schedule_partial" facilityVisitContext={null} />);
    expect(screen.getByTestId('visit-save-state-indicator').textContent).toContain('送信待ち');

    offlineStoreState.pendingQueue = [
      {
        ...offlineStoreState.pendingQueue[0]!,
        conflict_state: 'server_conflict',
      },
    ];
    rerender(<VisitRecordForm id="schedule_partial" facilityVisitContext={null} />);
    expect(screen.getByTestId('visit-save-state-indicator').textContent).toContain('競合');
    expect(screen.getByRole('link', { name: '同期状況を確認' }).getAttribute('href')).toBe(
      '/offline-sync',
    );
    expect(screen.getByTestId('visit-save-state-indicator').textContent).not.toContain('患者');
  });

  it('keeps a current-record retry failure visible instead of reporting sync success', async () => {
    offlineStoreState.pendingSyncCount = 1;
    offlineStoreState.pendingQueue = [
      {
        id: 1,
        entityType: 'visit_record',
        payload: { schedule_id: 'schedule_partial' },
        scope_id: 'schedule_partial',
        createdAt: new Date('2026-07-13T00:00:00.000Z'),
        retryCount: 2,
        lastError: 'HTTP 503 patient name must not render',
        conflict: null,
      },
    ];

    renderVisitRecordForm();

    await waitFor(() => {
      expect(screen.getByTestId('visit-save-state-indicator').textContent).toContain('送信失敗');
    });
    expect(screen.getByTestId('visit-save-state-indicator').textContent).not.toContain('patient');
    expect(screen.getByRole('link', { name: '同期状況を確認' })).toBeTruthy();
  });

  it('updates the save state from saving to locally saved after a manual draft save', async () => {
    let resolveDraftSave: (() => void) | null = null;
    saveDraftMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveDraftSave = resolve;
        }),
    );

    renderVisitRecordForm();

    await waitFor(() => {
      expect((document.querySelector('input[name="patient_id"]') as HTMLInputElement)?.value).toBe(
        'patient_1',
      );
    });

    saveDraftMock.mockClear();
    fireEvent.click(screen.getAllByRole('button', { name: '一時保存' })[0]!);

    expect(screen.getByTestId('visit-save-state-indicator').textContent).toContain('保存中');
    expect(resolveDraftSave).toBeTypeOf('function');

    await act(async () => {
      resolveDraftSave?.();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByTestId('visit-save-state-indicator').textContent).toContain('端末保存済');
    });
  });

  it('flushes the current draft immediately when the mobile step changes', async () => {
    renderVisitRecordForm();

    await waitFor(() => {
      expect((document.querySelector('input[name="patient_id"]') as HTMLInputElement)?.value).toBe(
        'patient_1',
      );
    });

    saveDraftMock.mockClear();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      fireEvent.change(screen.getByLabelText('主観情報'), {
        target: { value: 'ステップ移動前の入力' },
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(4_999);
      });
      expect(saveDraftMock).not.toHaveBeenCalled();

      const nextButtons = screen.getAllByRole('button', { name: '次へ' });
      fireEvent.click(nextButtons[nextButtons.length - 1]!);
      await act(async () => {
        await Promise.resolve();
      });
      expect(saveDraftMock).toHaveBeenCalledTimes(1);
      expect(saveDraftMock.mock.calls[0]?.[0]).toMatchObject({
        subjective: { free_text: 'ステップ移動前の入力' },
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(saveDraftMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('flushes the draft immediately when residual medication rows are added and removed', async () => {
    renderVisitRecordForm();

    await waitFor(() => {
      expect((document.querySelector('input[name="patient_id"]') as HTMLInputElement)?.value).toBe(
        'patient_1',
      );
    });

    saveDraftMock.mockClear();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      fireEvent.click(screen.getByRole('button', { name: '薬剤を追加' }));

      await act(async () => {
        await Promise.resolve();
      });
      expect(saveDraftMock).toHaveBeenCalledTimes(1);
      expect(saveDraftMock.mock.calls[0]?.[2]).toMatchObject({
        residualMedications: [
          {
            drug_name: '',
            remaining_quantity: 0,
            is_prohibited_reduction: false,
          },
        ],
      });

      fireEvent.click(screen.getByRole('button', { name: '薬剤 1 を削除' }));
      await act(async () => {
        await Promise.resolve();
      });
      expect(saveDraftMock).toHaveBeenCalledTimes(2);
      expect(saveDraftMock.mock.calls[1]?.[2]).toMatchObject({
        residualMedications: [],
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000);
      });
      expect(saveDraftMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('mounts the medication stock reference panel without adding stock observations to visit submit payload', async () => {
    renderVisitRecordForm();

    await waitFor(() => {
      expect((document.querySelector('input[name="patient_id"]') as HTMLInputElement)?.value).toBe(
        'patient_1',
      );
    });

    expect(screen.getByTestId('visit-medication-stock-observation-panel')).toBeTruthy();
    expect(medicationStockPanelCalls.some((call) => call.patientId === 'patient_1')).toBe(true);
    expect(medicationStockPanelCalls.at(-1)?.writeEnabled).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: '延期' }));
    fireEvent.submit(document.querySelector('form')!);

    await waitFor(() => {
      expect(visitRecordPostBodies).toHaveLength(1);
    });
    expect(visitRecordPostBodies[0]).not.toHaveProperty('medication_stock_observations');
    expect(visitRecordPostBodies[0]).not.toHaveProperty('stock_observations');
    expect(fetchUrls.some((url) => url.includes('/medication-stock-observations'))).toBe(false);
  });

  it('unwraps the visit-record PATCH envelope after attaching an uploaded file', async () => {
    const baselineFetch = globalThis.fetch;
    const patchBodies: unknown[] = [];
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url === '/api/files/presigned-upload') {
        return new Response(
          JSON.stringify({
            data: {
              id: 'file_1',
              uploadUrl: 'https://upload.example/file_1',
              headers: { 'x-upload': '1' },
            },
          }),
          { status: 200 },
        );
      }
      if (url === 'https://upload.example/file_1' && init?.method === 'PUT') {
        return new Response(null, { status: 200, headers: { etag: 'etag_1' } });
      }
      if (url === '/api/files/complete') {
        return new Response(
          JSON.stringify({
            data: { id: 'file_1', completedAt: '2026-04-09T01:30:00.000Z' },
          }),
          { status: 200 },
        );
      }
      if (url === '/api/visit-records/record_1' && init?.method === 'PATCH') {
        patchBodies.push(JSON.parse(String(init.body)));
        return new Response(
          JSON.stringify({
            data: { id: 'record_1', version: 2, patient_id: 'patient_1' },
          }),
          { status: 200 },
        );
      }
      return baselineFetch(input, init);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderVisitRecordForm();
    await waitFor(() => {
      expect((document.querySelector('input[name="patient_id"]') as HTMLInputElement)?.value).toBe(
        'patient_1',
      );
    });

    fireEvent.click(screen.getByRole('button', { name: '添付テスト追加' }));
    fireEvent.click(screen.getByRole('button', { name: '延期' }));
    fireEvent.submit(document.querySelector('form')!);

    await waitFor(() => {
      expect(patchBodies).toEqual([
        {
          version: 1,
          attachments: [{ file_id: 'file_1' }],
        },
      ]);
    });
    await waitFor(() => {
      expect(routerPushMock).toHaveBeenCalledWith('/visits/record_1');
    });
    expect(toastSuccessMock).toHaveBeenCalledWith('訪問記録を保存しました');
  });

  it('keeps a partial attachment failure PHI-safe after saving the visit record', async () => {
    const baselineFetch = globalThis.fetch;
    const poisonMessage = '患者Aの添付 / 090-1234-5678 / token=secret';
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url === '/api/files/presigned-upload') {
        return new Response(
          JSON.stringify({
            data: {
              id: 'file_1',
              uploadUrl: 'https://upload.example/file_1',
              headers: { 'x-upload': '1' },
            },
          }),
          { status: 200 },
        );
      }
      if (url === 'https://upload.example/file_1' && init?.method === 'PUT') {
        return new Response(null, { status: 200, headers: { etag: 'etag_1' } });
      }
      if (url === '/api/files/complete') {
        return new Response(JSON.stringify({ data: { id: 'file_1' } }), { status: 200 });
      }
      if (url === '/api/visit-records/record_1' && init?.method === 'PATCH') {
        return new Response(JSON.stringify({ message: poisonMessage }), { status: 500 });
      }
      return baselineFetch(input, init);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderVisitRecordForm();
    await waitFor(() => {
      expect((document.querySelector('input[name="patient_id"]') as HTMLInputElement)?.value).toBe(
        'patient_1',
      );
    });

    fireEvent.click(screen.getByRole('button', { name: '添付テスト追加' }));
    fireEvent.click(screen.getByRole('button', { name: '延期' }));
    fireEvent.submit(document.querySelector('form')!);

    await waitFor(() => {
      expect(toastWarningMock).toHaveBeenLastCalledWith(
        '訪問記録は保存しましたが、添付の紐づけに失敗しました',
      );
    });
    expect(clientLogWarnMock).toHaveBeenCalledWith(
      'visit_record.attachment_link_failed',
      undefined,
      {
        route: '/visits/[id]/record',
        entityType: 'visit_attachment',
        code: 'VISIT_ATTACHMENT_LINK_FAILED',
        status: 500,
      },
    );
    expect(JSON.stringify(toastWarningMock.mock.calls)).not.toContain(poisonMessage);
    expect(routerPushMock).toHaveBeenCalledWith('/visits/record_1');
  });

  it('keeps an attachment upload failure PHI-safe after saving the visit record', async () => {
    const baselineFetch = globalThis.fetch;
    const poisonMessage = '患者Aの添付 / 090-1234-5678 / token=secret';
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url === '/api/files/presigned-upload') {
        return new Response(JSON.stringify({ message: poisonMessage }), { status: 500 });
      }
      return baselineFetch(input, init);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderVisitRecordForm();
    await waitFor(() => {
      expect((document.querySelector('input[name="patient_id"]') as HTMLInputElement)?.value).toBe(
        'patient_1',
      );
    });

    fireEvent.click(screen.getByRole('button', { name: '添付テスト追加' }));
    fireEvent.click(screen.getByRole('button', { name: '延期' }));
    fireEvent.submit(document.querySelector('form')!);

    await waitFor(() => {
      expect(toastWarningMock).toHaveBeenLastCalledWith(
        '訪問記録は保存しましたが、添付のアップロードに失敗しました',
      );
    });
    expect(clientLogWarnMock).toHaveBeenCalledWith(
      'visit_record.attachment_upload_failed',
      expect.any(Error),
      {
        route: '/visits/[id]/record',
        entityType: 'visit_attachment',
        code: 'VISIT_ATTACHMENT_UPLOAD_FAILED',
      },
    );
    expect(JSON.stringify(toastWarningMock.mock.calls)).not.toContain(poisonMessage);
    expect(routerPushMock).toHaveBeenCalledWith('/visits/record_1');
  });

  it('fails closed when medication stock drafts exist while the server capability gate is disabled', async () => {
    renderVisitRecordForm();

    await waitFor(() => {
      expect((document.querySelector('input[name="patient_id"]') as HTMLInputElement)?.value).toBe(
        'patient_1',
      );
    });

    fireEvent.click(screen.getByRole('button', { name: '残数観測テスト入力' }));
    await waitFor(() => {
      expect(medicationStockPanelCalls.at(-1)?.drafts).toHaveLength(1);
    });

    fireEvent.click(screen.getByRole('button', { name: '延期' }));
    fireEvent.submit(document.querySelector('form')!);

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith(
        '残数観測の登録機能はDB連携確認中です。従来の残薬記録を使用してください。',
      );
    });
    expect(visitRecordPostBodies).toHaveLength(0);
    expect(submitVisitMedicationStockObservationsMock).not.toHaveBeenCalled();
  });

  it('submits medication stock observations after the visit record with a request idempotency key', async () => {
    renderVisitRecordForm({ medicationStockObservationWriteEnabled: true });

    await waitFor(() => {
      expect((document.querySelector('input[name="patient_id"]') as HTMLInputElement)?.value).toBe(
        'patient_1',
      );
    });

    fireEvent.click(screen.getByRole('button', { name: '残数観測テスト入力' }));
    await waitFor(() => {
      expect(medicationStockPanelCalls.at(-1)?.drafts).toHaveLength(1);
    });

    fireEvent.click(screen.getByRole('button', { name: '延期' }));
    fireEvent.submit(document.querySelector('form')!);

    await waitFor(() => {
      expect(visitRecordPostBodies).toHaveLength(1);
    });
    await waitFor(() => {
      expect(submitVisitMedicationStockObservationsMock).toHaveBeenCalledTimes(1);
    });

    expect(visitRecordPostBodies[0]).not.toHaveProperty('medication_stock_observations');
    expect(visitRecordPostBodies[0]).not.toHaveProperty('stock_observations');
    expect(submitVisitMedicationStockObservationsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        visitRecordId: 'record_1',
        orgId: 'org_1',
        idempotencyKey: expect.stringMatching(/^visit-stock-request:/),
        request: expect.objectContaining({
          observations: [
            expect.objectContaining({
              client_observation_id: 'obs_stock_1',
              stock_item_id: 'stock_1',
              kind: 'observed_absolute',
              quantity: 4,
              unit: '枚',
              source_context_code: 'pharmacist_direct_observation',
            }),
          ],
        }),
      }),
    );
    await waitFor(() => {
      expect(routerPushMock).toHaveBeenCalledWith('/visits/record_1');
    });
    expect(toastSuccessMock).toHaveBeenCalledWith('訪問記録と残数観測を保存しました');
  });

  it('keeps the visit record unsaved when medication stock draft validation fails', async () => {
    renderVisitRecordForm({ medicationStockObservationWriteEnabled: true });

    await waitFor(() => {
      expect((document.querySelector('input[name="patient_id"]') as HTMLInputElement)?.value).toBe(
        'patient_1',
      );
    });

    fireEvent.click(screen.getByRole('button', { name: '残数観測不正入力' }));
    await waitFor(() => {
      expect(medicationStockPanelCalls.at(-1)?.drafts).toHaveLength(1);
    });

    fireEvent.click(screen.getByRole('button', { name: '延期' }));
    fireEvent.submit(document.querySelector('form')!);

    await waitFor(() => {
      expect(screen.getByTestId('visit-medication-stock-validation-error').textContent).toContain(
        '今回残数は0以上の数値で入力してください。',
      );
    });
    expect(visitRecordPostBodies).toHaveLength(0);
    expect(submitVisitMedicationStockObservationsMock).not.toHaveBeenCalled();
    expect(toastErrorMock).toHaveBeenCalledWith('残数観測の入力内容を確認してください');
  });

  it('keeps failed medication stock observations pending and retries with the same idempotency key', async () => {
    submitVisitMedicationStockObservationsMock
      .mockResolvedValueOnce({
        ok: false,
        status: 'conflict',
        message: '患者Aの残数4枚 / 090-1234-5678 / token=secret',
      })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          data: { visit_record_id: 'record_1', observations: [] },
          meta: {
            generated_at: '2026-04-09T01:00:00.000Z',
            applied_count: 0,
            replay_count: 1,
          },
        },
      });

    renderVisitRecordForm({ medicationStockObservationWriteEnabled: true });

    await waitFor(() => {
      expect((document.querySelector('input[name="patient_id"]') as HTMLInputElement)?.value).toBe(
        'patient_1',
      );
    });

    fireEvent.click(screen.getByRole('button', { name: '残数観測テスト入力' }));
    fireEvent.click(screen.getByRole('button', { name: '延期' }));
    fireEvent.submit(document.querySelector('form')!);

    await waitFor(() => {
      expect(submitVisitMedicationStockObservationsMock).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(screen.getByTestId('visit-medication-stock-submission-state').textContent).toBe(
        'conflict',
      );
    });
    expect(routerPushMock).not.toHaveBeenCalledWith('/visits/record_1');
    expect(visitRecordPostBodies).toHaveLength(1);
    expect(toastErrorMock).toHaveBeenCalledWith(
      '訪問記録は保存しましたが、残数観測が競合しました。最新情報を確認して同じ内容で再試行してください。',
    );
    expect(clientLogWarnMock).toHaveBeenCalledWith(
      'visit_record.medication_stock_submission_failed',
      undefined,
      {
        route: '/visits/[id]/record',
        entityType: 'medication_stock_observation',
        code: 'VISIT_MEDICATION_STOCK_SUBMISSION_FAILED',
        status: 'conflict',
      },
    );
    expect(JSON.stringify(toastErrorMock.mock.calls)).not.toContain('患者Aの残数4枚');

    fireEvent.submit(document.querySelector('form')!);

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith(
        '訪問記録は保存済みです。残数観測の登録結果を確認してください',
      );
    });
    expect(visitRecordPostBodies).toHaveLength(1);
    expect(submitVisitMedicationStockObservationsMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: '残数観測再試行' }));

    await waitFor(() => {
      expect(submitVisitMedicationStockObservationsMock).toHaveBeenCalledTimes(2);
    });
    const firstCall = submitVisitMedicationStockObservationsMock.mock.calls[0]?.[0];
    const secondCall = submitVisitMedicationStockObservationsMock.mock.calls[1]?.[0];
    expect(secondCall?.idempotencyKey).toBe(firstCall?.idempotencyKey);
    expect(secondCall?.request).toEqual(firstCall?.request);
    await waitFor(() => {
      expect(routerPushMock).toHaveBeenCalledWith('/visits/record_1');
    });
  });
});
