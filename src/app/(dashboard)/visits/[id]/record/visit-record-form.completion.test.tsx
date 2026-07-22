// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createQueryClientWrapper } from '@/test/query-client-test-utils';
import {
  registerDefaultVisitRecordFormHooks,
  getVisitRecordFormTestMocks,
} from './visit-record-form.test-support';

const {
  visitRecordPostBodies,
  saveDraftMock,
  enqueueForSyncMock,
  refreshSyncCountMock,
  offlineStoreState,
  toastErrorMock,
  clientLogWarnMock,
  captureVisitGeoPointMock,
  getVisitLocationPermissionStateMock,
  getVisitLocationTrackingPreferenceMock,
  fetchUrls,
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

describe('VisitRecordForm synchronization and completion', () => {
  registerDefaultVisitRecordFormHooks();

  it('flushes the current draft immediately when an attachment is selected', async () => {
    renderVisitRecordForm();

    await waitFor(() => {
      expect((document.querySelector('input[name="patient_id"]') as HTMLInputElement)?.value).toBe(
        'patient_1',
      );
    });

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      fireEvent.change(screen.getByLabelText('主観情報'), {
        target: { value: '添付前メモ' },
      });
      saveDraftMock.mockClear();

      fireEvent.click(screen.getByRole('button', { name: '添付テスト追加' }));
      await act(async () => {
        await Promise.resolve();
      });
      expect(saveDraftMock).toHaveBeenCalledTimes(1);
      expect(saveDraftMock.mock.calls[0]?.[0]).toMatchObject({
        subjective: { free_text: '添付前メモ' },
      });
      expect(fetchUrls).not.toContain('/api/files/presigned-upload');
      expect(enqueueForSyncMock).not.toHaveBeenCalled();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000);
      });
      expect(saveDraftMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not autosave an untouched empty draft after hydration or hidden transition', async () => {
    const setTimeoutSpy = vi.spyOn(window, 'setTimeout');
    renderVisitRecordForm();

    await waitFor(() => {
      expect((document.querySelector('input[name="patient_id"]') as HTMLInputElement)?.value).toBe(
        'patient_1',
      );
    });

    expect(setTimeoutSpy).not.toHaveBeenCalledWith(expect.any(Function), 5_000);
    saveDraftMock.mockClear();
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await Promise.resolve();
    });

    expect(saveDraftMock).not.toHaveBeenCalled();
    setTimeoutSpy.mockRestore();
  });

  it('cancels pending autosave after manual draft save', async () => {
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
        target: { value: '手動保存前の入力' },
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(4_000);
      });

      await act(async () => {
        fireEvent.click(screen.getAllByRole('button', { name: '一時保存' })[0]!);
        await Promise.resolve();
      });
      expect(saveDraftMock).toHaveBeenCalledTimes(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_000);
      });

      expect(saveDraftMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancels pending autosave after keyboard draft save', async () => {
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
        target: { value: 'ショートカット保存前の入力' },
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(4_000);
      });

      await act(async () => {
        fireEvent.keyDown(window, { key: 's', metaKey: true });
        await Promise.resolve();
      });
      expect(saveDraftMock).toHaveBeenCalledTimes(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_000);
      });

      expect(saveDraftMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not expose raw draft-save error messages in toast text', async () => {
    saveDraftMock.mockRejectedValueOnce(new Error('patient=患者A token=secret'));
    renderVisitRecordForm();

    await waitFor(() => {
      expect((document.querySelector('input[name="patient_id"]') as HTMLInputElement)?.value).toBe(
        'patient_1',
      );
    });

    fireEvent.click(screen.getByRole('button', { name: '訪問開始を記録' }));

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith('オフライン下書きの保存に失敗しました');
    });
    expect(JSON.stringify(toastErrorMock.mock.calls)).not.toContain('患者A');
    expect(JSON.stringify(toastErrorMock.mock.calls)).not.toContain('token=secret');
  });

  it('polls sync count only while pending work exists in a visible tab', async () => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
    const setIntervalSpy = vi
      .spyOn(window, 'setInterval')
      .mockImplementation(() => 123 as unknown as ReturnType<typeof setInterval>);
    const clearIntervalSpy = vi.spyOn(window, 'clearInterval').mockImplementation(() => undefined);
    const { rerender } = renderVisitRecordForm();

    await waitFor(() => {
      expect(refreshSyncCountMock).toHaveBeenCalled();
    });

    setIntervalSpy.mockClear();
    offlineStoreState.pendingSyncCount = 0;
    rerender(<VisitRecordForm id="schedule_partial" facilityVisitContext={null} />);
    expect(setIntervalSpy).not.toHaveBeenCalledWith(expect.any(Function), 5_000);

    offlineStoreState.pendingSyncCount = 2;
    rerender(<VisitRecordForm id="schedule_partial" facilityVisitContext={null} />);
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 5_000);

    offlineStoreState.pendingSyncCount = 0;
    rerender(<VisitRecordForm id="schedule_partial" facilityVisitContext={null} />);
    expect(clearIntervalSpy).toHaveBeenCalled();

    setIntervalSpy.mockRestore();
    clearIntervalSpy.mockRestore();
  });

  it('announces and clears the required partial carry-item acknowledgement error', async () => {
    renderVisitRecordForm();

    const checkbox = await screen.findByRole('checkbox', {
      name: '未確定の持参物を確認し、代替手配または現地対応方針を確認しました。',
    });
    await waitFor(() => {
      expect((document.querySelector('input[name="patient_id"]') as HTMLInputElement)?.value).toBe(
        'patient_1',
      );
    });

    fireEvent.click(screen.getByRole('button', { name: '訪問完了' }));

    await waitFor(() => {
      expect(document.body.textContent).toContain(
        '持参物一部未確定の確認：持参物一部未確定の確認が必要です',
      );
    });
    expect(checkbox.getAttribute('aria-invalid')).toBe('true');
    expect(checkbox.getAttribute('aria-describedby')).toBe(
      'carry-item-warning-acknowledgement-error',
    );
    expect(document.getElementById('carry-item-warning-acknowledgement-error')?.textContent).toBe(
      '持参物一部未確定の確認が必要です',
    );

    fireEvent.click(checkbox);

    await waitFor(() => {
      expect(screen.queryByText('持参物一部未確定の確認が必要です')).toBeNull();
    });
    expect(checkbox.getAttribute('aria-invalid')).toBe('false');
    expect(checkbox.getAttribute('aria-describedby')).toBeNull();
  });

  it('clears the carry-item acknowledgement error when the outcome no longer requires it', async () => {
    renderVisitRecordForm();

    await screen.findByRole('checkbox', {
      name: '未確定の持参物を確認し、代替手配または現地対応方針を確認しました。',
    });
    await waitFor(() => {
      expect((document.querySelector('input[name="patient_id"]') as HTMLInputElement)?.value).toBe(
        'patient_1',
      );
    });

    fireEvent.click(screen.getByRole('button', { name: '訪問完了' }));

    await waitFor(() => {
      expect(screen.getByText('持参物一部未確定の確認が必要です')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: '延期' }));

    await waitFor(() => {
      expect(screen.queryByText('持参物一部未確定の確認が必要です')).toBeNull();
    });
    expect(
      screen.queryByRole('checkbox', {
        name: '未確定の持参物を確認し、代替手配または現地対応方針を確認しました。',
      }),
    ).toBeNull();
  });

  it('requires a relation when the receipt receiver name is entered', async () => {
    renderVisitRecordForm();

    await waitFor(() => {
      expect((document.querySelector('input[name="patient_id"]') as HTMLInputElement)?.value).toBe(
        'patient_1',
      );
    });

    fireEvent.click(screen.getByRole('button', { name: '延期' }));
    fireEvent.change(screen.getByLabelText('受領者名'), {
      target: { value: '山田 花子' },
    });
    fireEvent.submit(document.querySelector('form')!);

    await waitFor(() => {
      expect(document.body.textContent).toContain('受領者の続柄：受領者の続柄を選択してください');
    });
    expect(visitRecordPostBodies).toHaveLength(0);
  });

  it('omits the default receipt timestamp when no receiver identity was entered', async () => {
    renderVisitRecordForm();

    await waitFor(() => {
      expect((document.querySelector('input[name="patient_id"]') as HTMLInputElement)?.value).toBe(
        'patient_1',
      );
    });

    fireEvent.click(screen.getByRole('button', { name: '延期' }));
    fireEvent.submit(document.querySelector('form')!);

    await waitFor(() => {
      expect(visitRecordPostBodies).toHaveLength(1);
    });
    expect(visitRecordPostBodies[0]).toMatchObject({
      outcome_status: 'postponed',
      structured_soap: {
        previous_visit_reuse: {
          source_visit_record_id: 'record_prev',
          source_visit_record_version: 3,
          source_visit_record_updated_at: '2026-04-01T03:00:00.000Z',
          carry_forward_items: ['眠気の継続確認'],
        },
      },
    });
    expect(visitRecordPostBodies[0]).not.toHaveProperty('receipt_person_name');
    expect(visitRecordPostBodies[0]).not.toHaveProperty('receipt_person_relation');
    expect(visitRecordPostBodies[0]).not.toHaveProperty('receipt_at');
    expect(fetchUrls.some((url) => url.includes('/labs'))).toBe(false);
  });

  it('keeps visit-record save failures PHI-safe and retains the draft', async () => {
    const baseFetch = globalThis.fetch as typeof fetch;
    const poisonMessage = '患者AのSOAP / 090-1234-5678 / token=secret';
    const responseMessages = [poisonMessage, ''];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === '/api/visit-records') {
          visitRecordPostBodies.push(JSON.parse(String(init?.body ?? '{}')));
          return new Response(JSON.stringify({ message: responseMessages.shift() ?? '' }), {
            status: 500,
          });
        }
        return baseFetch(input, init);
      }),
    );

    renderVisitRecordForm();

    await waitFor(() => {
      expect((document.querySelector('input[name="patient_id"]') as HTMLInputElement)?.value).toBe(
        'patient_1',
      );
    });

    const subjectiveInput = screen.getByLabelText('主観情報') as HTMLTextAreaElement;
    fireEvent.change(subjectiveInput, { target: { value: '下書きを保持する' } });
    fireEvent.click(screen.getByRole('button', { name: '延期' }));
    fireEvent.submit(document.querySelector('form')!);

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenLastCalledWith('保存に失敗しました');
    });
    expect(clientLogWarnMock).toHaveBeenLastCalledWith(
      'visit_record.save_failed',
      expect.any(Error),
      {
        route: '/visits/[id]/record',
        entityType: 'visit_record',
        code: 'VISIT_RECORD_SAVE_FAILED',
      },
    );
    expect(subjectiveInput.value).toBe('下書きを保持する');

    toastErrorMock.mockClear();
    fireEvent.submit(document.querySelector('form')!);

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenLastCalledWith('保存に失敗しました');
    });
    expect(visitRecordPostBodies).toHaveLength(2);
    expect(JSON.stringify(toastErrorMock.mock.calls)).not.toContain(poisonMessage);
    expect(
      JSON.stringify(clientLogWarnMock.mock.calls.map(([, , context]) => context)),
    ).not.toContain(poisonMessage);
  });

  it('keeps visit location capture failures PHI-safe', async () => {
    const poisonError = new Error('患者Aの自宅座標 / 090-1234-5678 / token=secret');
    getVisitLocationTrackingPreferenceMock.mockReturnValue(true);
    getVisitLocationPermissionStateMock.mockResolvedValue('granted');
    captureVisitGeoPointMock.mockRejectedValue(poisonError);

    renderVisitRecordForm();

    await waitFor(() => {
      expect((document.querySelector('input[name="patient_id"]') as HTMLInputElement)?.value).toBe(
        'patient_1',
      );
    });
    fireEvent.click(screen.getByRole('button', { name: '訪問開始を記録' }));

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenLastCalledWith('位置情報を取得できませんでした');
    });
    expect(clientLogWarnMock).toHaveBeenCalledWith(
      'visit_record.location_capture_failed',
      poisonError,
      {
        route: '/visits/[id]/record',
        entityType: 'visit_geo_log',
        code: 'VISIT_LOCATION_CAPTURE_FAILED',
      },
    );
    expect(JSON.stringify(toastErrorMock.mock.calls)).not.toContain(poisonError.message);
  });

  it('does not infer visit end time from form save alone', async () => {
    renderVisitRecordForm();

    await waitFor(() => {
      expect((document.querySelector('input[name="patient_id"]') as HTMLInputElement)?.value).toBe(
        'patient_1',
      );
    });

    fireEvent.click(screen.getByRole('button', { name: '延期' }));
    fireEvent.submit(document.querySelector('form')!);

    await waitFor(() => {
      expect(visitRecordPostBodies).toHaveLength(1);
    });
    expect(visitRecordPostBodies[0]).not.toHaveProperty('visit_ended_at');
  });

  it('posts visit end time only after the explicit end action', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-04-09T02:30:00.000Z'));
    try {
      renderVisitRecordForm();

      await waitFor(() => {
        expect(
          (document.querySelector('input[name="patient_id"]') as HTMLInputElement)?.value,
        ).toBe('patient_1');
      });

      fireEvent.click(screen.getByRole('button', { name: '訪問開始を記録' }));
      vi.setSystemTime(new Date('2026-04-09T03:05:00.000Z'));
      fireEvent.click(screen.getByRole('button', { name: '訪問終了を記録' }));
      fireEvent.click(screen.getByRole('button', { name: '延期' }));
      fireEvent.submit(document.querySelector('form')!);

      await waitFor(() => {
        expect(visitRecordPostBodies).toHaveLength(1);
      });
      expect(visitRecordPostBodies[0]).toMatchObject({
        visit_started_at: '2026-04-09T02:30:00.000Z',
        visit_ended_at: '2026-04-09T03:05:00.000Z',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('saves a local draft immediately after explicit visit start and end actions', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-04-09T02:30:00.000Z'));
    try {
      renderVisitRecordForm();

      await waitFor(() => {
        expect(
          (document.querySelector('input[name="patient_id"]') as HTMLInputElement)?.value,
        ).toBe('patient_1');
      });

      saveDraftMock.mockClear();
      fireEvent.click(screen.getByRole('button', { name: '訪問開始を記録' }));

      await waitFor(() => {
        expect(saveDraftMock).toHaveBeenCalledTimes(1);
      });
      expect(saveDraftMock.mock.calls[0]?.[2]).toMatchObject({
        visitStartedAt: '2026-04-09T02:30:00.000Z',
      });

      vi.setSystemTime(new Date('2026-04-09T03:05:00.000Z'));
      fireEvent.click(screen.getByRole('button', { name: '訪問終了を記録' }));

      await waitFor(() => {
        expect(saveDraftMock).toHaveBeenCalledTimes(2);
      });
      expect(saveDraftMock.mock.calls[1]?.[2]).toMatchObject({
        visitStartedAt: '2026-04-09T02:30:00.000Z',
        visitEndedAt: '2026-04-09T03:05:00.000Z',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows billing collection context without posting billing fields as visit record data', async () => {
    renderVisitRecordForm();

    await waitFor(() => {
      expect(screen.getByTestId('visit-billing-collection-context')).toBeTruthy();
    });

    expect(screen.getByText('集金確認')).toBeTruthy();
    expect(screen.getByText('今回徴収')).toBeTruthy();
    expect(screen.getByText('3,240円')).toBeTruthy();
    expect(screen.getByText('前回未収分')).toBeTruthy();
    expect(screen.getByText('1,080円')).toBeTruthy();
    expect(screen.getByText('合計徴収額')).toBeTruthy();
    expect(screen.getByText('4,320円')).toBeTruthy();
    expect(screen.getByText('現金')).toBeTruthy();
    expect(screen.getByText('紙 / 未発行')).toBeTruthy();
    const billingCandidateHref = screen
      .getByRole('link', { name: '請求候補を開く' })
      .getAttribute('href');
    expect(billingCandidateHref).toContain('candidate_id=candidate_current');
    expect(billingCandidateHref).toContain('workflow_from=visit_record');
    expect(billingCandidateHref).toContain('schedule_id=schedule_partial');

    fireEvent.click(screen.getByRole('button', { name: '延期' }));
    fireEvent.submit(document.querySelector('form')!);

    await waitFor(() => {
      expect(visitRecordPostBodies).toHaveLength(1);
    });
    expect(visitRecordPostBodies[0]).not.toHaveProperty('billing_collection_context');
    expect(visitRecordPostBodies[0]).not.toHaveProperty('current_collection_amount');
    expect(visitRecordPostBodies[0]).not.toHaveProperty('receipt_number');
  });
});
