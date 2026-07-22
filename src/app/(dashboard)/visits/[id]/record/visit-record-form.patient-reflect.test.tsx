// @vitest-environment jsdom

import { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createQueryClientWrapper } from '@/test/query-client-test-utils';
import {
  scheduleDetailResponse,
  getVisitRecordFormTestMocks,
} from './visit-record-form.test-support';

const {
  continuationRows,
  continuationCryptoState,
  continuationTableMock,
  encryptContinuationMock,
  continuationDbState,
} = vi.hoisted(() => {
  const rows: Array<{
    id?: number;
    orgId: string;
    scheduleId: string;
    recordId: string;
    payload: string;
    updatedAt: Date;
  }> = [];
  const dbState = { readError: null as Error | null, clearError: null as Error | null };
  return {
    continuationRows: rows,
    continuationCryptoState: { plaintext: '' },
    continuationDbState: dbState,
    encryptContinuationMock: vi.fn(),
    continuationTableMock: {
      add: vi.fn(async (row: (typeof rows)[number]) => {
        rows.push({ ...row, id: rows.length + 1 });
        return rows.length;
      }),
      where: vi.fn((index: string) => ({
        equals: vi.fn((values: string[]) => {
          const matching = () =>
            rows.filter((row) =>
              index === '[orgId+scheduleId]'
                ? row.orgId === values[0] && row.scheduleId === values[1]
                : row.orgId === values[0] &&
                  row.scheduleId === values[1] &&
                  row.recordId === values[2],
            );
          return {
            delete: vi.fn(async () => {
              if (index === '[orgId+scheduleId+recordId]' && dbState.clearError) {
                throw dbState.clearError;
              }
              for (const row of matching()) rows.splice(rows.indexOf(row), 1);
            }),
            reverse: () => ({
              first: vi.fn(async () => {
                if (dbState.readError) throw dbState.readError;
                return matching().at(-1);
              }),
            }),
          };
        }),
      })),
    },
  };
});

vi.mock('@/lib/offline/crypto', () => ({
  encryptOfflinePayloadRequired: encryptContinuationMock,
  decryptOfflinePayload: vi.fn(async () => continuationCryptoState.plaintext),
  isEncryptedOfflinePayload: (value: string) => value.startsWith('encv1:'),
}));

vi.mock('@/lib/stores/offline-db', () => ({
  offlineDb: {
    visitReflectionContinuations: continuationTableMock,
    transaction: vi.fn(async (...args: unknown[]) => {
      const callback = args.at(-1) as () => Promise<void>;
      await callback();
    }),
  },
}));

const {
  visitRecordPostBodies,
  loadDraftMock,
  saveDraftMock,
  clearDraftMock,
  setupAutoSyncMock,
  refreshSyncCountMock,
  refreshSyncStateMock,
  listEvidenceDraftSummariesForScheduleMock,
  toastSuccessMock,
  cdsAlertPanelCalls,
  medicationStockPanelCalls,
  submitVisitMedicationStockObservationsMock,
  routerPushMock,
  useNetworkOnlineMock,
} = getVisitRecordFormTestMocks();
const { buildPatientApiPath } = await import('@/lib/patient/api-paths');
const { VisitRecordForm } = await import('./visit-record-form');

describe('VisitRecordForm patient-detail reflect (⑤)', () => {
  const patientPatchBodies: unknown[] = [];
  const patientPatchUrls: string[] = [];
  let patientPatchStatuses: number[] = [];
  let headerGetStatuses: number[] = [];
  let headerIntakeTarget: {
    care_case_id: string;
    expected_care_case_version: number;
  } | null = null;
  let patientPatchSuccessOverride: unknown | null = null;
  let schedulePatientId = 'patient_1';
  let patientPatchGate: Promise<Response> | null = null;
  let attachmentPresignGate: Promise<Response> | null = null;
  let patientPatchRequested = false;
  let attachmentPresignRequested = false;

  beforeEach(() => {
    vi.clearAllMocks();
    loadDraftMock.mockResolvedValue(null);
    saveDraftMock.mockResolvedValue(undefined);
    clearDraftMock.mockResolvedValue(undefined);
    setupAutoSyncMock.mockReturnValue(vi.fn());
    refreshSyncStateMock.mockResolvedValue(undefined);
    refreshSyncCountMock.mockResolvedValue(undefined);
    useNetworkOnlineMock.mockReturnValue(true);
    listEvidenceDraftSummariesForScheduleMock.mockResolvedValue([]);
    cdsAlertPanelCalls.length = 0;
    medicationStockPanelCalls.length = 0;
    visitRecordPostBodies.length = 0;
    patientPatchBodies.length = 0;
    patientPatchUrls.length = 0;
    patientPatchStatuses = [200];
    headerGetStatuses = [200];
    headerIntakeTarget = {
      care_case_id: 'case_canonical',
      expected_care_case_version: 11,
    };
    patientPatchSuccessOverride = null;
    patientPatchGate = null;
    attachmentPresignGate = null;
    patientPatchRequested = false;
    attachmentPresignRequested = false;
    submitVisitMedicationStockObservationsMock.mockReset().mockResolvedValue({
      ok: true,
      data: {
        data: { visit_record_id: 'record_1', observations: [] },
        meta: { generated_at: '2026-04-09T01:00:00.000Z', applied_count: 0, replay_count: 0 },
      },
    });
    schedulePatientId = 'patient_1';
    continuationRows.length = 0;
    continuationDbState.readError = null;
    continuationDbState.clearError = null;
    continuationCryptoState.plaintext = '';
    encryptContinuationMock.mockReset().mockImplementation(async (value: string) => {
      continuationCryptoState.plaintext = value;
      return 'encv1:opaque-reflection';
    });
    window.localStorage.clear();
    vi.mocked(buildPatientApiPath).mockImplementation(
      (patientId, suffix = '') => `/api/patients/${encodeURIComponent(patientId)}${suffix}`,
    );

    Object.defineProperty(window, 'requestAnimationFrame', {
      configurable: true,
      value: (callback: FrameRequestCallback) => {
        callback(0);
        return 0;
      },
    });

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? 'GET';
        if (url === '/api/visit-schedules/schedule_partial') {
          return scheduleDetailResponse({
            patient_id: schedulePatientId,
            carry_items_status: 'partial',
          });
        }
        if (url === '/api/visit-preparations/schedule_partial') {
          return new Response(
            JSON.stringify({
              data: {
                pack: {
                  care_team: [],
                  billing_blockers: [],
                  conference_context: [],
                  medication_period: null,
                  prescription_changes: null,
                  previous_visit: null,
                  facility_parallel_context: null,
                  intake_context: null,
                },
              },
            }),
            { status: 200 },
          );
        }
        if (url === '/api/visit-records') {
          visitRecordPostBodies.push(JSON.parse(String(init?.body ?? '{}')));
          return new Response(
            JSON.stringify({
              data: {
                record: { id: 'record_1', version: 1, patient_id: schedulePatientId },
              },
            }),
            { status: 201 },
          );
        }
        if (url === '/api/files/presigned-upload' && attachmentPresignGate) {
          attachmentPresignRequested = true;
          return await attachmentPresignGate;
        }
        if (url.endsWith('/header-summary')) {
          const status = headerGetStatuses.shift() ?? 200;
          return new Response(
            JSON.stringify({
              data: {
                patient_id: schedulePatientId,
                patient_updated_at: '2026-04-09T01:00:00.000Z',
                intake_edit_target: headerIntakeTarget,
                safety: {
                  safety_tags: [],
                  visible_safety_tags: [],
                  hidden_safety_tag_count: 0,
                },
              },
            }),
            { status },
          );
        }
        if (url.startsWith('/api/patients/') && method === 'PATCH') {
          patientPatchUrls.push(url);
          const patchBody = JSON.parse(String(init?.body ?? '{}')) as {
            care_case_id: string | null;
            expected_care_case_version: number | null;
          };
          patientPatchBodies.push(patchBody);
          if (patientPatchGate) {
            patientPatchRequested = true;
            return await patientPatchGate;
          }
          const status = patientPatchStatuses.shift() ?? 200;
          const updatedAt = '2026-04-09T01:00:01.000Z';
          const responseBody =
            status >= 200 && status < 300 && patientPatchSuccessOverride !== null
              ? patientPatchSuccessOverride
              : {
                  data: { id: schedulePatientId, updated_at: updatedAt },
                  meta: {
                    warnings: [],
                    duplicate_candidates: [],
                    version_basis: {
                      patient_updated_at: updatedAt,
                      care_case_id: patchBody.care_case_id,
                      care_case_version:
                        patchBody.expected_care_case_version === null
                          ? null
                          : patchBody.expected_care_case_version + 1,
                    },
                  },
                };
          return new Response(JSON.stringify(responseBody), { status });
        }
        throw new Error(`Unexpected fetch: ${method} ${url}`);
      }),
    );
  });

  afterEach(() => {
    window.localStorage.clear();
    vi.unstubAllGlobals();
  });

  function renderForm({
    medicationStock = false,
    strictMode = false,
  }: { medicationStock?: boolean; strictMode?: boolean } = {}) {
    const form = (
      <VisitRecordForm
        id="schedule_partial"
        facilityVisitContext={null}
        medicationStockObservationWriteEnabled={medicationStock}
      />
    );
    return render(strictMode ? <StrictMode>{form}</StrictMode> : form, {
      wrapper: createQueryClientWrapper(),
    });
  }

  async function waitForPatientHydrated() {
    await waitFor(() => {
      expect((document.querySelector('input[name="patient_id"]') as HTMLInputElement)?.value).toBe(
        schedulePatientId,
      );
    });
  }

  it('StrictMode hydration reaches ready and creates no duplicate continuation side effects', async () => {
    renderForm({ strictMode: true });
    await waitForPatientHydrated();

    fireEvent.click(screen.getByRole('button', { name: '延期' }));
    fireEvent.submit(document.querySelector('form')!);

    await waitFor(() => expect(visitRecordPostBodies).toHaveLength(1));
    expect(patientPatchBodies).toHaveLength(0);
    expect(continuationTableMock.add).not.toHaveBeenCalled();
  });

  it('StrictMode shows hydration errors and same-scope retry unblocks one Visit POST', async () => {
    continuationDbState.readError = new Error('IndexedDB read failed');
    renderForm({ strictMode: true });
    await waitForPatientHydrated();
    expect(await screen.findByText('保存済みの患者反映情報を確認できません')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '延期' }));
    fireEvent.submit(document.querySelector('form')!);
    await act(async () => {
      await Promise.resolve();
    });
    expect(visitRecordPostBodies).toHaveLength(0);

    continuationDbState.readError = null;
    fireEvent.click(screen.getByRole('button', { name: '回復情報を再読み込み' }));
    await waitFor(() =>
      expect(screen.queryByText('保存済みの患者反映情報を確認できません')).toBeNull(),
    );
    await waitForPatientHydrated();
    fireEvent.click(screen.getByRole('button', { name: '延期' }));
    fireEvent.submit(document.querySelector('form')!);
    await waitFor(() => expect(visitRecordPostBodies).toHaveLength(1));
    expect(patientPatchBodies).toHaveLength(0);
    expect(continuationTableMock.add).not.toHaveBeenCalled();
  });

  it('persists the encrypted continuation before deferred Patient PATCH and attachment work', async () => {
    let releasePatientPatch!: (response: Response) => void;
    let releaseAttachmentPresign!: (response: Response) => void;
    patientPatchGate = new Promise((resolve) => {
      releasePatientPatch = resolve;
    });
    attachmentPresignGate = new Promise((resolve) => {
      releaseAttachmentPresign = resolve;
    });
    renderForm();
    await waitForPatientHydrated();

    fireEvent.click(screen.getByRole('button', { name: '添付テスト追加' }));
    fireEvent.click(screen.getByRole('button', { name: '延期' }));
    fireEvent.click(screen.getByRole('button', { name: '家族' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'この内容を患者詳細に反映する' }));
    fireEvent.submit(document.querySelector('form')!);

    await waitFor(() => expect(patientPatchRequested).toBe(true));
    expect(attachmentPresignRequested).toBe(false);
    expect(clearDraftMock).not.toHaveBeenCalled();
    expect(continuationRows).toHaveLength(1);
    expect(continuationRows[0]?.payload).toBe('encv1:opaque-reflection');
    expect(JSON.parse(continuationCryptoState.plaintext)).toMatchObject({
      scheduleId: 'schedule_partial',
      status: 'failed',
      record: { id: 'record_1', version: 1, patient_id: 'patient_1' },
    });

    await act(async () => {
      releasePatientPatch(new Response('{}', { status: 409 }));
    });
    await waitFor(() => expect(attachmentPresignRequested).toBe(true));
    expect(continuationRows).toHaveLength(1);
    expect(JSON.parse(continuationCryptoState.plaintext)).toMatchObject({ status: 'stale' });
    expect(clearDraftMock).not.toHaveBeenCalled();
    expect(visitRecordPostBodies).toHaveLength(1);

    await act(async () => {
      releaseAttachmentPresign(
        new Response(JSON.stringify({ message: 'upload unavailable' }), { status: 503 }),
      );
    });
    await screen.findByText('訪問記録は保存済みですが、患者詳細への反映は未完了です');
    expect(visitRecordPostBodies).toHaveLength(1);
  });

  it('keeps in-memory recovery fail-closed when durable persistence is unavailable', async () => {
    encryptContinuationMock.mockRejectedValue(new Error('encryption unavailable'));
    patientPatchStatuses = [409];
    renderForm();
    await waitForPatientHydrated();

    fireEvent.click(screen.getByRole('button', { name: '延期' }));
    fireEvent.click(screen.getByRole('button', { name: '家族' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'この内容を患者詳細に反映する' }));
    fireEvent.submit(document.querySelector('form')!);

    await screen.findByText('訪問記録は保存済みですが、患者詳細への反映は未完了です');
    fireEvent.submit(document.querySelector('form')!);
    await act(async () => {
      await Promise.resolve();
    });
    expect(visitRecordPostBodies).toHaveLength(1);
    expect(continuationRows).toHaveLength(0);
    expect(routerPushMock).not.toHaveBeenCalledWith('/visits/record_1');
  });

  it('reloads a resolved tombstone with clear-only cleanup and never repeats Patient PATCH', async () => {
    continuationDbState.clearError = new Error('IndexedDB clear failed');
    const initial = renderForm();
    await waitForPatientHydrated();

    fireEvent.click(screen.getByRole('button', { name: '延期' }));
    fireEvent.click(screen.getByRole('button', { name: '家族' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'この内容を患者詳細に反映する' }));
    fireEvent.submit(document.querySelector('form')!);

    await screen.findByText('患者詳細への反映は完了しています');
    expect(patientPatchBodies).toHaveLength(1);
    expect(visitRecordPostBodies).toHaveLength(1);
    expect(continuationRows).toHaveLength(1);
    expect(JSON.parse(continuationCryptoState.plaintext)).toMatchObject({ status: 'resolved' });
    expect(screen.queryByRole('button', { name: '最新情報を再取得' })).toBeNull();
    expect(screen.queryByRole('button', { name: '反映だけ再試行' })).toBeNull();
    expect(screen.getByRole('button', { name: '完了情報を消去して続行' })).toBeTruthy();

    initial.unmount();
    renderForm();
    await screen.findByText('患者詳細への反映は完了しています');
    expect(patientPatchBodies).toHaveLength(1);
    expect(screen.queryByRole('button', { name: '反映だけ再試行' })).toBeNull();

    continuationDbState.clearError = null;
    fireEvent.click(screen.getByRole('button', { name: '完了情報を消去して続行' }));
    await waitFor(() => expect(continuationRows).toHaveLength(0));
    await waitFor(() => expect(routerPushMock).toHaveBeenCalledWith('/visits/record_1'));
    expect(patientPatchBodies).toHaveLength(1);
    expect(visitRecordPostBodies).toHaveLength(1);
  });

  it('retries failed resolved-tombstone persistence without exposing Patient PATCH again', async () => {
    let encryptionAttempt = 0;
    encryptContinuationMock.mockImplementation(async (value: string) => {
      encryptionAttempt += 1;
      if (encryptionAttempt === 2) throw new Error('resolved persistence failed');
      continuationCryptoState.plaintext = value;
      return 'encv1:opaque-reflection';
    });
    renderForm();
    await waitForPatientHydrated();

    fireEvent.click(screen.getByRole('button', { name: '延期' }));
    fireEvent.click(screen.getByRole('button', { name: '家族' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'この内容を患者詳細に反映する' }));
    fireEvent.submit(document.querySelector('form')!);

    await screen.findByText('患者詳細への反映は完了しています');
    await waitFor(() =>
      expect(JSON.parse(continuationCryptoState.plaintext)).toMatchObject({ status: 'resolved' }),
    );
    expect(encryptionAttempt).toBeGreaterThanOrEqual(3);
    expect(patientPatchBodies).toHaveLength(1);
    expect(screen.queryByRole('button', { name: '反映だけ再試行' })).toBeNull();
  });

  it('schedule と異なる canonical intake target を使って患者詳細へ PATCH する', async () => {
    renderForm();
    await waitForPatientHydrated();

    fireEvent.click(screen.getByRole('button', { name: '延期' }));
    fireEvent.change(screen.getByLabelText('介護度'), { target: { value: '要介護3' } });
    fireEvent.click(screen.getByRole('button', { name: '家族' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'この内容を患者詳細に反映する' }));

    fireEvent.submit(document.querySelector('form')!);

    await waitFor(() => {
      expect(visitRecordPostBodies).toHaveLength(1);
    });
    await waitFor(() => {
      expect(patientPatchBodies).toHaveLength(1);
    });
    expect(continuationTableMock.add).toHaveBeenCalled();
    expect(continuationRows).toHaveLength(0);
    expect(patientPatchBodies[0]).toEqual({
      intake: { care_level: '要介護3', medication_manager: 'family' },
      source_visit_record_id: 'record_1',
      expected_updated_at: '2026-04-09T01:00:00.000Z',
      care_case_id: 'case_canonical',
      expected_care_case_version: 11,
    });
    expect(toastSuccessMock).toHaveBeenCalledWith('確認した内容を患者詳細に反映しました');
  });

  it('A-only 反映も canonical target があれば exact case authority を送る', async () => {
    renderForm();
    await waitForPatientHydrated();

    fireEvent.click(screen.getByRole('button', { name: '延期' }));
    fireEvent.change(screen.getByLabelText('介護度'), { target: { value: '要介護2' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'この内容を患者詳細に反映する' }));
    fireEvent.submit(document.querySelector('form')!);

    await waitFor(() => expect(patientPatchBodies).toHaveLength(1));
    expect(patientPatchBodies[0]).toMatchObject({
      care_case_id: 'case_canonical',
      expected_care_case_version: 11,
    });
  });

  it('case-null A-only 反映だけ case authority を null/null にする', async () => {
    headerIntakeTarget = null;
    renderForm();
    await waitForPatientHydrated();

    fireEvent.click(screen.getByRole('button', { name: '延期' }));
    fireEvent.change(screen.getByLabelText('介護度'), { target: { value: '要介護2' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'この内容を患者詳細に反映する' }));
    fireEvent.submit(document.querySelector('form')!);

    await waitFor(() => expect(patientPatchBodies).toHaveLength(1));
    expect(patientPatchBodies[0]).toMatchObject({
      care_case_id: null,
      expected_care_case_version: null,
    });
  });

  it('B field fails closed when canonical intake target is null', async () => {
    headerIntakeTarget = null;
    renderForm();
    await waitForPatientHydrated();

    fireEvent.click(screen.getByRole('button', { name: '延期' }));
    fireEvent.click(screen.getByRole('button', { name: '家族' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'この内容を患者詳細に反映する' }));
    fireEvent.submit(document.querySelector('form')!);

    expect(
      await screen.findByText('訪問記録は保存済みですが、患者詳細への反映は未完了です'),
    ).toBeTruthy();
    expect(patientPatchBodies).toHaveLength(0);
    expect(routerPushMock).not.toHaveBeenCalledWith('/visits/record_1');
  });

  it('retains the continuation when Patient PATCH returns a mismatched 2xx envelope', async () => {
    patientPatchSuccessOverride = {
      data: { id: 'patient_other', updated_at: '2026-04-09T01:00:01.000Z' },
      meta: {
        warnings: [],
        duplicate_candidates: [],
        version_basis: {
          patient_updated_at: '2026-04-09T01:00:01.000Z',
          care_case_id: 'case_canonical',
          care_case_version: 12,
        },
      },
    };
    renderForm();
    await waitForPatientHydrated();

    fireEvent.click(screen.getByRole('button', { name: '延期' }));
    fireEvent.click(screen.getByRole('button', { name: '家族' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'この内容を患者詳細に反映する' }));
    fireEvent.submit(document.querySelector('form')!);

    expect(
      await screen.findByText('訪問記録は保存済みですが、患者詳細への反映は未完了です'),
    ).toBeTruthy();
    expect(patientPatchBodies).toHaveLength(1);
    expect(routerPushMock).not.toHaveBeenCalledWith('/visits/record_1');
    await waitFor(() => expect(continuationRows).toHaveLength(1));
    expect(window.localStorage.length).toBe(0);
  });

  it('mobile reload keeps the recovery alert and PATCH-only actions reachable before the final step', async () => {
    vi.stubGlobal('innerWidth', 390);
    patientPatchStatuses = [409, 200];
    const initial = renderForm();
    await waitForPatientHydrated();

    fireEvent.click(screen.getByRole('button', { name: '延期' }));
    fireEvent.change(screen.getByLabelText('介護度'), { target: { value: '要介護3' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'この内容を患者詳細に反映する' }));
    fireEvent.submit(document.querySelector('form')!);

    expect(
      await screen.findByText('訪問記録は保存済みですが、患者詳細への反映は未完了です'),
    ).toBeTruthy();
    expect(screen.getByText(/患者情報または訪問ケースが更新されています/)).toBeTruthy();
    expect(visitRecordPostBodies).toHaveLength(1);
    expect(patientPatchBodies).toHaveLength(1);

    await waitFor(() => {
      expect(continuationRows).toHaveLength(1);
    });
    initial.unmount();
    renderForm();
    const recoveryTitle = await screen.findByText(
      '訪問記録は保存済みですが、患者詳細への反映は未完了です',
    );
    const recoveryAlert = recoveryTitle.closest('[role="alert"]');
    expect(screen.getByRole('button', { name: 'ステップ1 訪問前確認(現在)' })).toBeTruthy();
    expect(recoveryAlert).toBeTruthy();
    expect(recoveryAlert?.closest('.max-md\\:hidden')).toBeNull();
    expect(
      screen.getByRole('button', { name: '最新情報を再取得' }).closest('.max-md\\:hidden'),
    ).toBeNull();
    expect(screen.getByRole('button', { name: '反映だけ再試行' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '今回は反映しない' })).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(recoveryAlert));
    expect(visitRecordPostBodies).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: '最新情報を再取得' }));
    expect(await screen.findByText(/最新版を取得しました/, {}, { timeout: 5_000 })).toBeTruthy();
    const reconfirm = screen
      .getAllByRole('checkbox')
      .find(
        (checkbox) =>
          checkbox.getAttribute('aria-describedby') === 'patient-reflection-reconfirm-description',
      );
    expect(reconfirm).toBeTruthy();
    expect(screen.getByText('訪問記録は保存済みですが、患者詳細への反映は未完了です')).toBeTruthy();
    expect(visitRecordPostBodies).toHaveLength(1);

    fireEvent.click(reconfirm!);
    fireEvent.click(screen.getByRole('button', { name: '反映だけ再試行' }));

    await waitFor(() => {
      expect(patientPatchBodies).toHaveLength(2);
    });
    expect(visitRecordPostBodies).toHaveLength(1);
    await waitFor(() => {
      expect(
        screen.queryByText('訪問記録は保存済みですが、患者詳細への反映は未完了です'),
      ).toBeNull();
    });
    expect(continuationRows).toHaveLength(0);
    expect(window.localStorage.length).toBe(0);
  });

  it('retry ACK clear failure becomes reload-safe resolved cleanup without a third PATCH', async () => {
    patientPatchStatuses = [409, 200];
    const initial = renderForm();
    await waitForPatientHydrated();

    fireEvent.click(screen.getByRole('button', { name: '延期' }));
    fireEvent.click(screen.getByRole('button', { name: '家族' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'この内容を患者詳細に反映する' }));
    fireEvent.submit(document.querySelector('form')!);
    await screen.findByText('訪問記録は保存済みですが、患者詳細への反映は未完了です');

    fireEvent.click(screen.getByRole('button', { name: '最新情報を再取得' }));
    await screen.findByText(/最新版を取得しました/);
    const reconfirm = screen
      .getAllByRole('checkbox')
      .find(
        (checkbox) =>
          checkbox.getAttribute('aria-describedby') === 'patient-reflection-reconfirm-description',
      );
    fireEvent.click(reconfirm!);
    continuationDbState.clearError = new Error('IndexedDB clear failed');
    fireEvent.click(screen.getByRole('button', { name: '反映だけ再試行' }));

    await screen.findByText('患者詳細への反映は完了しています');
    expect(patientPatchBodies).toHaveLength(2);
    expect(visitRecordPostBodies).toHaveLength(1);
    await waitFor(() =>
      expect(JSON.parse(continuationCryptoState.plaintext)).toMatchObject({ status: 'resolved' }),
    );
    expect(screen.queryByRole('button', { name: '反映だけ再試行' })).toBeNull();

    initial.unmount();
    renderForm();
    await screen.findByText('患者詳細への反映は完了しています');
    expect(patientPatchBodies).toHaveLength(2);
    expect(screen.queryByRole('button', { name: '反映だけ再試行' })).toBeNull();

    continuationDbState.clearError = null;
    fireEvent.click(screen.getByRole('button', { name: '完了情報を消去して続行' }));
    await waitFor(() => expect(routerPushMock).toHaveBeenCalledWith('/visits/record_1'));
    expect(patientPatchBodies).toHaveLength(2);
    expect(visitRecordPostBodies).toHaveLength(1);
  });

  it.each(['retry', 'skip'] as const)(
    'serializes delayed persistence before %s clear so the continuation cannot resurrect',
    async (resolution) => {
      patientPatchStatuses = [409, 200];
      renderForm();
      await waitForPatientHydrated();

      fireEvent.click(screen.getByRole('button', { name: '延期' }));
      fireEvent.click(screen.getByRole('button', { name: '家族' }));
      fireEvent.click(screen.getByRole('checkbox', { name: 'この内容を患者詳細に反映する' }));
      fireEvent.submit(document.querySelector('form')!);
      await screen.findByText('訪問記録は保存済みですが、患者詳細への反映は未完了です');
      await waitFor(() => expect(encryptContinuationMock.mock.calls.length).toBeGreaterThan(1));
      await waitFor(() => expect(continuationRows).toHaveLength(1));

      let releaseEncryption!: () => void;
      const delayedEncryption = new Promise<void>((resolve) => {
        releaseEncryption = resolve;
      });
      encryptContinuationMock.mockClear();
      encryptContinuationMock.mockImplementationOnce(async (value: string) => {
        continuationCryptoState.plaintext = value;
        await delayedEncryption;
        return 'encv1:delayed-reflection';
      });

      fireEvent.click(screen.getByRole('button', { name: '最新情報を再取得' }));
      await screen.findByText(/最新版を取得しました/);
      await waitFor(() => expect(encryptContinuationMock).toHaveBeenCalled());
      const reconfirm = screen
        .getAllByRole('checkbox')
        .find(
          (checkbox) =>
            checkbox.getAttribute('aria-describedby') ===
            'patient-reflection-reconfirm-description',
        );
      fireEvent.click(reconfirm!);
      const actionButton = screen.getByRole('button', {
        name: resolution === 'retry' ? '反映だけ再試行' : '今回は反映しない',
      });
      fireEvent.click(actionButton);
      fireEvent.click(actionButton);
      expect(actionButton.hasAttribute('disabled')).toBe(true);
      expect(continuationRows).toHaveLength(1);

      releaseEncryption();
      await waitFor(() => expect(continuationRows).toHaveLength(0));
      await waitFor(() =>
        expect(
          screen.queryByText('訪問記録は保存済みですが、患者詳細への反映は未完了です'),
        ).toBeNull(),
      );
      if (resolution === 'retry') expect(patientPatchBodies).toHaveLength(2);
    },
  );

  it('refetch failure with cached data never enables reflection retry', async () => {
    patientPatchStatuses = [409];
    headerGetStatuses = [200, 500];
    renderForm();
    await waitForPatientHydrated();

    fireEvent.click(screen.getByRole('button', { name: '延期' }));
    fireEvent.click(screen.getByRole('button', { name: '家族' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'この内容を患者詳細に反映する' }));
    fireEvent.submit(document.querySelector('form')!);
    await screen.findByText('訪問記録は保存済みですが、患者詳細への反映は未完了です');

    fireEvent.click(screen.getByRole('button', { name: '最新情報を再取得' }));
    await waitFor(() => {
      expect(screen.getByText(/更新元の版を確認できないか、通信に失敗しました/)).toBeTruthy();
    });
    expect(screen.queryByText(/最新版を取得しました/)).toBeNull();
    expect(screen.queryByRole('button', { name: '反映だけ再試行' })?.hasAttribute('disabled')).toBe(
      true,
    );
    expect(patientPatchBodies).toHaveLength(1);
  });

  it.each(['reflection-first', 'medication-first'] as const)(
    'dual failure waits for both continuations when resolved %s',
    async (resolutionOrder) => {
      patientPatchStatuses = [409, 200];
      submitVisitMedicationStockObservationsMock
        .mockResolvedValueOnce({ ok: false, status: 'conflict' })
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
      renderForm({ medicationStock: true });
      await waitForPatientHydrated();
      await waitFor(() => expect(headerGetStatuses).toHaveLength(0));

      fireEvent.click(screen.getByRole('button', { name: '残数観測テスト入力' }));
      await waitFor(() => expect(medicationStockPanelCalls.at(-1)?.drafts).toHaveLength(1));
      fireEvent.click(screen.getByRole('button', { name: '延期' }));
      fireEvent.click(screen.getByRole('button', { name: '家族' }));
      fireEvent.click(screen.getByRole('checkbox', { name: 'この内容を患者詳細に反映する' }));
      fireEvent.submit(document.querySelector('form')!);

      await screen.findByText('訪問記録は保存済みですが、患者詳細への反映は未完了です');
      await waitFor(() =>
        expect(screen.getByTestId('visit-medication-stock-submission-state').textContent).toBe(
          'conflict',
        ),
      );

      const resolveReflection = async () => {
        fireEvent.click(screen.getByRole('button', { name: '最新情報を再取得' }));
        await screen.findByText(/最新版を取得しました/);
        const reconfirm = screen
          .getAllByRole('checkbox')
          .find(
            (checkbox) =>
              checkbox.getAttribute('aria-describedby') ===
              'patient-reflection-reconfirm-description',
          );
        fireEvent.click(reconfirm!);
        fireEvent.click(screen.getByRole('button', { name: '反映だけ再試行' }));
        await waitFor(() => expect(patientPatchBodies).toHaveLength(2));
      };
      const resolveMedication = async () => {
        fireEvent.click(screen.getByRole('button', { name: '残数観測再試行' }));
        await waitFor(() =>
          expect(submitVisitMedicationStockObservationsMock).toHaveBeenCalledTimes(2),
        );
      };

      if (resolutionOrder === 'reflection-first') {
        await resolveReflection();
        expect(routerPushMock).not.toHaveBeenCalledWith('/visits/record_1');
        await resolveMedication();
      } else {
        await resolveMedication();
        expect(routerPushMock).not.toHaveBeenCalledWith('/visits/record_1');
        await resolveReflection();
      }
      await waitFor(() => expect(routerPushMock).toHaveBeenCalledWith('/visits/record_1'));
      expect(visitRecordPostBodies).toHaveLength(1);
    },
  );

  it('same-tick shortcut and form submit create only one visit record', async () => {
    renderForm();
    await waitForPatientHydrated();
    fireEvent.click(screen.getByRole('button', { name: '延期' }));

    fireEvent.keyDown(window, { key: 'Enter', metaKey: true });
    fireEvent.submit(document.querySelector('form')!);

    await waitFor(() => expect(visitRecordPostBodies).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(visitRecordPostBodies).toHaveLength(1);
  });

  it('患者詳細反映 PATCH を共有 patient API path helper 経由にする', async () => {
    schedulePatientId = 'pt/1?tab=x#frag';
    // header-summary query も同 helper を suffix 付きで呼ぶため、mockReturnValueOnce だと
    // そちらが先に消費する。suffix なし(反映 PATCH)だけ sentinel へ差し替える。
    const { buildPatientApiPath: actualBuildPatientApiPath } =
      await vi.importActual<typeof import('@/lib/patient/api-paths')>('@/lib/patient/api-paths');
    vi.mocked(buildPatientApiPath).mockImplementation((patientId: string, suffix = '') =>
      suffix === ''
        ? '/api/patients/__helper_reflect__'
        : actualBuildPatientApiPath(patientId, suffix),
    );
    try {
      renderForm();
      await waitForPatientHydrated();

      fireEvent.click(screen.getByRole('button', { name: '延期' }));
      fireEvent.change(screen.getByLabelText('介護度'), { target: { value: '要介護3' } });
      fireEvent.click(screen.getByRole('checkbox', { name: 'この内容を患者詳細に反映する' }));

      fireEvent.submit(document.querySelector('form')!);

      await waitFor(() => {
        expect(patientPatchUrls).toEqual(['/api/patients/__helper_reflect__']);
      });
      expect(buildPatientApiPath).toHaveBeenCalledWith(schedulePatientId);
      expect(patientPatchUrls).not.toContain(`/api/patients/${schedulePatientId}`);
    } finally {
      vi.mocked(buildPatientApiPath).mockImplementation(actualBuildPatientApiPath);
    }
  });

  it('反映チェック無しなら患者詳細へ PATCH しない', async () => {
    renderForm();
    await waitForPatientHydrated();

    fireEvent.click(screen.getByRole('button', { name: '延期' }));
    fireEvent.change(screen.getByLabelText('介護度'), { target: { value: '要介護3' } });
    // 反映チェックを入れずに保存する
    fireEvent.submit(document.querySelector('form')!);

    await waitFor(() => {
      expect(visitRecordPostBodies).toHaveLength(1);
    });
    expect(patientPatchBodies).toHaveLength(0);
  });

  it('反映チェック有でも入力が空なら PATCH しない', async () => {
    renderForm();
    await waitForPatientHydrated();

    fireEvent.click(screen.getByRole('button', { name: '延期' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'この内容を患者詳細に反映する' }));
    fireEvent.submit(document.querySelector('form')!);

    await waitFor(() => {
      expect(visitRecordPostBodies).toHaveLength(1);
    });
    expect(patientPatchBodies).toHaveLength(0);
  });
});
