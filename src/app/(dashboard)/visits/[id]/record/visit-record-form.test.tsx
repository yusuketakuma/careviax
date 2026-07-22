// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { buildOrgJsonHeaders } from '@/lib/api/org-headers';
import { encodePathSegment } from '@/lib/http/path-segment';
import { createQueryClientWrapper } from '@/test/query-client-test-utils';
import {
  registerDefaultVisitRecordFormHooks,
  scheduleDetailResponse,
  getVisitRecordFormTestMocks,
} from './visit-record-form.test-support';

const {
  visitRecordPostBodies,
  syncOnlineStatusMock,
  useNetworkOnlineMock,
  refreshSyncCountMock,
  refreshSyncStateMock,
  listEvidenceDraftSummariesForScheduleMock,
  fetchUrls,
  cdsAlertPanelCalls,
  medicationManagementSectionCalls,
  patientCareTeamSourcePanelCalls,
  visitReportReadinessPanelCalls,
} = getVisitRecordFormTestMocks();
const { VisitRecordForm, fetchVisitRecordCdsAlerts } = await import('./visit-record-form');

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

describe('VisitRecordForm loading and safety', () => {
  registerDefaultVisitRecordFormHooks();

  it('surfaces API error messages when visit CDS alerts fail to load', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ message: '処方安全アラートの閲覧権限がありません' }), {
        status: 403,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchVisitRecordCdsAlerts('cycle_1', 'org_1')).rejects.toThrow(
      '処方安全アラートの閲覧権限がありません',
    );
    expect(fetchMock).toHaveBeenCalledWith('/api/cds/check', {
      method: 'POST',
      headers: buildOrgJsonHeaders('org_1'),
      body: JSON.stringify({ cycleId: 'cycle_1' }),
    });
  });

  it('shows a visit-record skeleton instead of generic loading text while schedule loads', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => {})),
    );

    renderVisitRecordForm();

    expect(screen.getByRole('status', { name: '訪問記録フォームを読み込み中' })).toBeTruthy();
    expect(screen.queryByText('読み込み中...', { selector: 'p' })).toBeNull();
    expect(screen.queryByRole('button', { name: '訪問完了' })).toBeNull();
    expect(screen.queryByTestId('medication-management-section')).toBeNull();
    expect(screen.queryByText('訪問時チェック')).toBeNull();
  });

  it('surfaces a retryable warning instead of silently dropping the visit-preparation pack on fetch failure', async () => {
    // 準備パック取得失敗を「処方変更/その他薬/前回記録なし」に潰さず、再読込導線つきで明示する。
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        fetchUrls.push(url);
        if (url === '/api/visit-schedules/schedule_partial') {
          return scheduleDetailResponse();
        }
        if (url === '/api/visit-preparations/schedule_partial') {
          return new Response(JSON.stringify({ message: 'boom' }), { status: 500 });
        }
        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );

    renderVisitRecordForm();

    // 臨床画面の一次日付は和式表記(SSOT 7.8: MM/DD 単独禁止)。
    const visitTimeLabels = await screen.findAllByText(/4月9日 09:00/);
    expect(visitTimeLabels.length).toBeGreaterThan(0);
    expect(await screen.findByText('訪問準備情報を読み込めませんでした')).toBeTruthy();
    expect(screen.getByRole('button', { name: '再読み込み' })).toBeTruthy();
    expect(medicationManagementSectionCalls.at(-1)?.preparationSourceStatus).toBe('error');
    expect(
      visitReportReadinessPanelCalls
        .at(-1)
        ?.items.find((item) => item.key === 'medication_management'),
    ).toMatchObject({
      done: false,
      description: '訪問準備情報が最新でないため、必須項目の判定を保留しています。',
    });
  });

  it('fails visibly when a successful preparation response omits required pack collections', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        fetchUrls.push(url);
        if (url === '/api/visit-schedules/schedule_partial') {
          return scheduleDetailResponse();
        }
        if (url === '/api/visit-preparations/schedule_partial') {
          return new Response(JSON.stringify({ data: { pack: {} } }), { status: 200 });
        }
        if (url.endsWith('/header-summary')) {
          return new Response(
            JSON.stringify({
              data: {
                patient_id: 'patient_1',
                patient_updated_at: '2026-04-09T01:00:00.000Z',
                safety: { safety_tags: [], visible_safety_tags: [], hidden_safety_tag_count: 0 },
              },
            }),
            { status: 200 },
          );
        }
        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );

    renderVisitRecordForm();

    expect(await screen.findByText('訪問準備情報を読み込めませんでした')).toBeTruthy();
    expect(medicationManagementSectionCalls.at(-1)?.preparationSourceStatus).toBe('error');
  });

  it.each([
    {
      label: 'facility patient collection',
      pack: {
        care_team: [],
        billing_blockers: [],
        conference_context: [],
        facility_parallel_context: {},
      },
    },
    {
      label: 'prescription change collections',
      pack: {
        care_team: [],
        billing_blockers: [],
        conference_context: [],
        prescription_changes: {
          current_prescribed_date: '2026-04-09',
          previous_prescribed_date: null,
          source_type: 'fax',
        },
      },
    },
  ])('fails visibly when a successful response has malformed $label', async ({ pack }) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        fetchUrls.push(url);
        if (url === '/api/visit-schedules/schedule_partial') {
          return scheduleDetailResponse();
        }
        if (url === '/api/visit-preparations/schedule_partial') {
          return new Response(JSON.stringify({ data: { pack } }), { status: 200 });
        }
        if (url.endsWith('/header-summary')) {
          return new Response(
            JSON.stringify({
              data: {
                patient_id: 'patient_1',
                patient_updated_at: '2026-04-09T01:00:00.000Z',
                safety: { safety_tags: [], visible_safety_tags: [], hidden_safety_tag_count: 0 },
              },
            }),
            { status: 200 },
          );
        }
        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );

    renderVisitRecordForm();

    expect(await screen.findByText('訪問準備情報を読み込めませんでした')).toBeTruthy();
    expect(medicationManagementSectionCalls.at(-1)?.preparationSourceStatus).toBe('error');
  });

  it('retains authorized cached preparation details after a refetch failure', async () => {
    let preparationRequestCount = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        fetchUrls.push(url);
        if (url === '/api/visit-schedules/schedule_partial') {
          return scheduleDetailResponse();
        }
        if (url === '/api/visit-preparations/schedule_partial') {
          preparationRequestCount += 1;
          if (preparationRequestCount > 1) {
            return new Response(JSON.stringify({ message: 'provider detail must stay hidden' }), {
              status: 500,
            });
          }
          return new Response(
            JSON.stringify({
              data: {
                pack: {
                  care_team: [
                    {
                      id: 'care_team_1',
                      role: 'physician',
                      name: '佐藤医師',
                      organization_name: '在宅クリニック',
                      phone: null,
                    },
                  ],
                  billing_blockers: [],
                  conference_context: [],
                  prescription_changes: {
                    current_prescribed_date: '2026-04-09',
                    previous_prescribed_date: '2026-03-25',
                    source_type: 'fax',
                    added: ['酸化マグネシウム錠'],
                    changed: [],
                    removed: [],
                  },
                },
              },
            }),
            { status: 200 },
          );
        }
        if (url.endsWith('/header-summary')) {
          return new Response(
            JSON.stringify({
              data: {
                patient_id: 'patient_1',
                patient_updated_at: '2026-04-09T01:00:00.000Z',
                safety: { safety_tags: [], visible_safety_tags: [], hidden_safety_tag_count: 0 },
              },
            }),
            { status: 200 },
          );
        }
        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );

    renderVisitRecordForm();

    await waitFor(() => {
      expect(medicationManagementSectionCalls.at(-1)?.preparationSourceStatus).toBe('ready');
    });
    expect(screen.getByTestId('medication-management-prescription-changes').textContent).toContain(
      '酸化マグネシウム錠',
    );
    expect(patientCareTeamSourcePanelCalls.at(-1)?.contacts[0]?.name).toBe('佐藤医師');

    act(() => medicationManagementSectionCalls.at(-1)?.onRetryPreparation?.());

    await waitFor(() => {
      expect(medicationManagementSectionCalls.at(-1)?.preparationSourceStatus).toBe('stale');
    });
    expect(medicationManagementSectionCalls.at(-1)?.preparationSourceUpdatedAt).toBeGreaterThan(0);
    expect(medicationManagementSectionCalls.at(-1)?.prescriptionChanges?.added).toContain(
      '酸化マグネシウム錠',
    );
    expect(patientCareTeamSourcePanelCalls.at(-1)?.contacts[0]?.name).toBe('佐藤医師');
    expect(
      visitReportReadinessPanelCalls
        .at(-1)
        ?.items.find((item) => item.key === 'medication_management')?.done,
    ).toBe(false);
  });

  it('hides cached preparation PHI when a refetch reports revoked access', async () => {
    let preparationRequestCount = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        fetchUrls.push(url);
        if (url === '/api/visit-schedules/schedule_partial') {
          return scheduleDetailResponse();
        }
        if (url === '/api/visit-preparations/schedule_partial') {
          preparationRequestCount += 1;
          if (preparationRequestCount > 1) {
            return new Response(
              JSON.stringify({ message: 'patient token raw detail must stay hidden' }),
              { status: 403 },
            );
          }
          return new Response(
            JSON.stringify({
              data: {
                pack: {
                  care_team: [
                    {
                      id: 'care_team_1',
                      role: 'physician',
                      name: '佐藤医師',
                      organization_name: '在宅クリニック',
                      phone: null,
                    },
                  ],
                  billing_blockers: [],
                  conference_context: [],
                  prescription_changes: {
                    current_prescribed_date: '2026-04-09',
                    previous_prescribed_date: '2026-03-25',
                    source_type: 'fax',
                    added: ['酸化マグネシウム錠'],
                    changed: [],
                    removed: [],
                  },
                },
              },
            }),
            { status: 200 },
          );
        }
        if (url.endsWith('/header-summary')) {
          return new Response(
            JSON.stringify({
              data: {
                patient_id: 'patient_1',
                patient_updated_at: '2026-04-09T01:00:00.000Z',
                safety: { safety_tags: [], visible_safety_tags: [], hidden_safety_tag_count: 0 },
              },
            }),
            { status: 200 },
          );
        }
        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );

    renderVisitRecordForm();

    await waitFor(() => {
      expect(medicationManagementSectionCalls.at(-1)?.preparationSourceStatus).toBe('ready');
    });
    expect(screen.getByTestId('patient-care-team-source-panel').textContent).toContain('佐藤医師');
    expect(screen.getByTestId('medication-management-prescription-changes').textContent).toContain(
      '酸化マグネシウム錠',
    );

    act(() => medicationManagementSectionCalls.at(-1)?.onRetryPreparation?.());

    await waitFor(() => {
      expect(medicationManagementSectionCalls.at(-1)?.preparationSourceStatus).toBe('error');
    });
    expect(preparationRequestCount).toBe(2);
    expect(medicationManagementSectionCalls.at(-1)?.prescriptionChanges).toBeNull();
    expect(screen.queryByTestId('patient-care-team-source-panel')).toBeNull();
    expect(screen.queryByText('佐藤医師')).toBeNull();
    expect(screen.queryByText('酸化マグネシウム錠')).toBeNull();
    expect(screen.queryByText('patient token raw detail must stay hidden')).toBeNull();
    expect(
      visitReportReadinessPanelCalls
        .at(-1)
        ?.items.find((item) => item.key === 'medication_management')?.done,
    ).toBe(false);
  });

  it('encodes the route schedule id as one segment for schedule and preparation APIs', async () => {
    const hostileScheduleId = 'schedule/../../outside';
    const encodedScheduleId = encodePathSegment(hostileScheduleId);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        fetchUrls.push(url);
        if (url === `/api/visit-schedules/${encodedScheduleId}`) {
          return scheduleDetailResponse({ id: hostileScheduleId });
        }
        if (url === `/api/visit-preparations/${encodedScheduleId}`) {
          return new Response(
            JSON.stringify({
              data: {
                pack: { care_team: [], billing_blockers: [], conference_context: [] },
              },
            }),
            { status: 200 },
          );
        }
        if (url.endsWith('/header-summary')) {
          return new Response(
            JSON.stringify({
              data: {
                patient_id: 'patient_1',
                patient_updated_at: '2026-04-09T01:00:00.000Z',
                safety: { safety_tags: [], visible_safety_tags: [], hidden_safety_tag_count: 0 },
              },
            }),
            { status: 200 },
          );
        }
        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );

    renderVisitRecordForm({ id: hostileScheduleId });

    expect(await screen.findByTestId('medication-management-section')).toBeTruthy();
    expect(fetchUrls).toContain(`/api/visit-schedules/${encodedScheduleId}`);
    expect(fetchUrls).toContain(`/api/visit-preparations/${encodedScheduleId}`);
    expect(fetchUrls).not.toContain(`/api/visit-schedules/${hostileScheduleId}`);
    expect(fetchUrls).not.toContain(`/api/visit-preparations/${hostileScheduleId}`);
  });

  it('pins the allergy safety tag in the visit mode headers (SSOT 4.1)', async () => {
    renderVisitRecordForm();

    // md+/mobile 両ヘッダに critical 保証済みの安全タグ(アレルギー)と +N が常時表示される。
    const tagGroups = await screen.findAllByTestId('visit-header-safety-tags');
    expect(tagGroups.length).toBeGreaterThan(0);
    for (const group of tagGroups) {
      expect(group.textContent).toContain('アレルギー');
      expect(group.textContent).toContain('+2');
    }
    expect(screen.queryByTestId('visit-header-safety-unavailable')).toBeNull();
    // md+ ヘッダは AppHeader の下で sticky になり、入力中も安全タグが隠れない(SSOT 2.3)。
    const modeHeader = screen.getByTestId('visit-mode-header');
    expect(modeHeader.className).toContain('sticky');
    expect(modeHeader.className).toContain('top-[var(--app-header-height)]');
  });

  it('fails closed in the header when safety tags cannot be loaded', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        fetchUrls.push(url);
        if (url === '/api/visit-schedules/schedule_partial') {
          return scheduleDetailResponse({ carry_items_status: 'none' });
        }
        if (url.endsWith('/header-summary')) {
          return new Response(JSON.stringify({ message: 'boom' }), { status: 500 });
        }
        if (url === '/api/visit-preparations/schedule_partial') {
          // 500 は form が明示ハンドリング済みの経路(retryable warning)。pack:null は crash する。
          return new Response(JSON.stringify({ message: 'skip' }), { status: 500 });
        }
        return new Response(JSON.stringify({ data: { alerts: [] } }), { status: 200 });
      }),
    );

    renderVisitRecordForm();

    // 取得失敗を「タグなし」に潰さない(fail-close)。
    const warnings = await screen.findAllByTestId('visit-header-safety-unavailable');
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0].textContent).toContain('「なし」とは判断しない');
    expect(screen.queryByTestId('visit-header-safety-tags')).toBeNull();
  });

  it('keeps 訪問完了 as the single primary submit with no green fill (SSOT 5.1)', async () => {
    renderVisitRecordForm();

    // md+ 固定バーと mobile ウィザードの双方(jsdom は media query 非適用で両方 DOM に載る)。
    const completeButtons = await screen.findAllByRole('button', { name: '訪問完了' });
    expect(completeButtons.length).toBeGreaterThan(0);
    for (const button of completeButtons) {
      // 完了アクションも Primary(--primary)。done 緑の主操作塗りは禁止。
      expect(button.className).not.toContain('bg-state-done');
      expect(button.getAttribute('type')).toBe('submit');
    }
    // inline の重複 submit(旧 ActionRail の「保存」)は存在しない(主操作導線の一本化)。
    expect(screen.queryByRole('button', { name: '保存' })).toBeNull();
    // md+ の「次へ」はスクロール補助(outline)へ降格され、塗りの主操作は訪問完了のみ。
    const nextButtons = screen.getAllByRole('button', { name: '次へ' });
    expect(nextButtons.some((button) => !button.className.includes('bg-primary'))).toBe(true);
  });

  it('defaults the visit date to the JST business date on a device timezone behind Japan (SSOT 2.8)', async () => {
    // 既定訪問日は端末ローカル TZ ではなく JST 業務日を正本にする。format(new Date(),...) だと
    // Asia/Tokyo より遅れた TZ では前日の既定日になってしまう回帰を固定する。
    const originalTz = process.env.TZ;
    process.env.TZ = 'Pacific/Honolulu'; // UTC-10、JST より遅れ
    // Date のみ偽装し(setTimeout/rAF は実タイマーのまま)、react-query の非同期解決を妨げない。
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-07-04T02:00:00+09:00'));
    try {
      // 前提確認: ランタイム TZ が実際に JST より遅れている(偽ガード検知)。
      expect(new Date('2026-07-04T00:00:00+09:00').getDate()).toBe(3);

      renderVisitRecordForm();

      const visitDateInput = (await screen.findByLabelText(/訪問日/)) as HTMLInputElement;
      // JST 業務日(2026-07-04)。端末ローカル日付(2026-07-03)にならない。
      expect(visitDateInput.value).toBe('2026-07-04');
    } finally {
      vi.useRealTimers();
      if (originalTz === undefined) delete process.env.TZ;
      else process.env.TZ = originalTz;
    }
  });

  it('blocks the visit form with a retryable error when the schedule cannot be loaded', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      fetchUrls.push(url);
      if (url === '/api/visit-schedules/schedule_partial') {
        return new Response(JSON.stringify({ message: 'schedule failed' }), { status: 500 });
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
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderVisitRecordForm();

    const alert = await screen.findByRole('alert');
    expect(alert.getAttribute('aria-live')).toBe('assertive');
    expect(alert.textContent).toContain('訪問予定を読み込めませんでした');
    expect(alert.textContent).toContain('訪問予定と患者情報を確認できないため');
    expect(screen.queryByRole('button', { name: '訪問完了' })).toBeNull();
    expect(document.querySelector('form')).toBeNull();
    expect(screen.queryByTestId('medication-management-section')).toBeNull();
    expect(screen.queryByText('訪問時チェック')).toBeNull();
    expect(
      screen.queryByRole('checkbox', {
        name: '未確定の持参物を確認し、代替手配または現地対応方針を確認しました。',
      }),
    ).toBeNull();
    expect(fetchUrls.some((url) => url === '/api/cds/check')).toBe(false);
    expect(fetchUrls).not.toContain('/api/visit-preparations/schedule_partial');
    expect(visitRecordPostBodies).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: '再読み込み' }));

    await waitFor(() => {
      expect(
        fetchUrls.filter((url) => url === '/api/visit-schedules/schedule_partial'),
      ).toHaveLength(2);
    });
  });

  it('passes an unavailable CDS state when schedule is loaded but safety alerts fail', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        fetchUrls.push(url);
        if (url === '/api/visit-schedules/schedule_partial') {
          return scheduleDetailResponse({ cycle_id: 'cycle_1' });
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
        if (url === '/api/cds/check') {
          return new Response(JSON.stringify({ message: 'cds failed' }), { status: 500 });
        }
        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );

    renderVisitRecordForm();

    expect(await screen.findByTestId('cds-alerts-unavailable')).toBeTruthy();
    expect(screen.getByText('訪問時チェック')).toBeTruthy();
    expect(cdsAlertPanelCalls.some((call) => call.isUnavailable === true)).toBe(true);
  });

  it('syncs offline state on mount and when network status changes', async () => {
    const { rerender } = renderVisitRecordForm();

    await waitFor(() => {
      expect(syncOnlineStatusMock).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(refreshSyncCountMock).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(listEvidenceDraftSummariesForScheduleMock).toHaveBeenCalledWith(
        'schedule_partial',
        'org_1',
      );
    });
    expect(refreshSyncStateMock).not.toHaveBeenCalled();

    syncOnlineStatusMock.mockClear();
    useNetworkOnlineMock.mockReturnValue(false);
    rerender(<VisitRecordForm id="schedule_partial" facilityVisitContext={null} />);

    await waitFor(() => {
      expect(syncOnlineStatusMock).toHaveBeenCalledTimes(1);
    });

    syncOnlineStatusMock.mockClear();
    useNetworkOnlineMock.mockReturnValue(true);
    rerender(<VisitRecordForm id="schedule_partial" facilityVisitContext={null} />);

    await waitFor(() => {
      expect(syncOnlineStatusMock).toHaveBeenCalledTimes(1);
    });
  });
});
