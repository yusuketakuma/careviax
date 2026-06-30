import { describe, expect, it } from 'vitest';
import {
  deriveCardTypeLabel,
  deriveCompareCardView,
  formatMedicationPeriodSub,
  parseComparePatientsParam,
  selectDefaultComparePatients,
  type CompareBoardCardInput,
  type CompareWorkspaceInput,
} from './compare-card-helpers';

function buildWorkspace(overrides: Partial<CompareWorkspaceInput> = {}): CompareWorkspaceInput {
  return {
    overall_status: 'dispensed',
    exception_status: null,
    current_intake: {
      id: 'intake_1',
      prescribed_date: '2026-05-22T00:00:00.000Z',
      prescription_category: 'regular',
    },
    today_tasks: [],
    open_exceptions: [],
    previous_medication: { start: '2026-04-24T00:00:00.000Z', end: '2026-05-21T00:00:00.000Z' },
    current_medication: { start: '2026-05-22T00:00:00.000Z', end: '2026-06-18T00:00:00.000Z' },
    ...overrides,
  };
}

function buildBoardCard(overrides: Partial<CompareBoardCardInput> = {}): CompareBoardCardInput {
  return {
    patient_id: 'patient_1',
    attention: 'urgent_now',
    status_text: '麻薬監査 期限12:00 — 持参薬が未確定',
    link_label: '監査へ',
    link_href: '/audit',
    current_step: 'audit',
    ...overrides,
  };
}

describe('deriveCardTypeLabel', () => {
  it('returns 返信待ちカード for reply_wait attention or awaiting_reply exception status', () => {
    expect(deriveCardTypeLabel({ attention: 'reply_wait' })).toBe('返信待ちカード');
    expect(deriveCardTypeLabel({ exceptionStatus: 'awaiting_reply' })).toBe('返信待ちカード');
    expect(deriveCardTypeLabel({ exceptionStatus: 'report_failed' })).toBe('返信待ちカード');
  });

  it('maps prescription_category to 定期/臨時処方カード', () => {
    expect(deriveCardTypeLabel({ prescriptionCategory: 'regular' })).toBe('定期処方カード');
    expect(deriveCardTypeLabel({ prescriptionCategory: 'emergency' })).toBe('臨時処方カード');
  });

  it('returns 返信待ちカード ahead of category when both apply', () => {
    expect(deriveCardTypeLabel({ attention: 'reply_wait', prescriptionCategory: 'regular' })).toBe(
      '返信待ちカード',
    );
  });

  it('falls back to 処方カード when no vocabulary is available', () => {
    expect(deriveCardTypeLabel({})).toBe('処方カード');
    expect(deriveCardTypeLabel({ attention: 'steady', prescriptionCategory: null })).toBe(
      '処方カード',
    );
  });
});

describe('formatMedicationPeriodSub', () => {
  it('formats 前回薬 M/dまで / 今回 M/d〜M/d from both periods', () => {
    expect(formatMedicationPeriodSub(buildWorkspace())).toBe('前回薬 5/21まで / 今回 5/22〜6/18');
  });

  it('falls back to 今回 only when previous period is missing', () => {
    expect(formatMedicationPeriodSub(buildWorkspace({ previous_medication: null }))).toBe(
      '今回 5/22〜6/18',
    );
  });

  it('falls back to the intake date when no line periods exist', () => {
    expect(
      formatMedicationPeriodSub(
        buildWorkspace({ previous_medication: null, current_medication: null }),
      ),
    ).toBe('今回処方 5/22 取込');
  });

  it('handles missing workspace and missing intake', () => {
    expect(formatMedicationPeriodSub(null)).toBe('進行中の処方はありません');
    expect(
      formatMedicationPeriodSub(
        buildWorkspace({
          previous_medication: null,
          current_medication: null,
          current_intake: null,
        }),
      ),
    ).toBe('処方期間は未登録です');
  });
});

describe('deriveCompareCardView', () => {
  it('builds a 定期処方カード preview from today tasks, exceptions and cycle action (田中パターン)', () => {
    const view = deriveCompareCardView({
      boardCard: buildBoardCard(),
      workspace: buildWorkspace({
        today_tasks: [
          { time_label: '期限 12:00', label: '麻薬監査', due_time: '12:00' },
          { time_label: '監査後', label: 'セット作成', due_time: null },
          { time_label: '14:00', label: '訪問', due_time: null },
        ],
        open_exceptions: [
          { id: 'ex_1', description: 'ご家族の同意待ち(新規契約)', severity: 'critical' },
          { id: 'ex_2', description: '送付先の確認(やまもと内科)', severity: 'warning' },
          { id: 'ex_3', description: '3件目は表示しない', severity: 'warning' },
        ],
      }),
    });

    expect(view.typeLabel).toBe('定期処方カード');
    expect(view.periodSub).toBe('前回薬 5/21まで / 今回 5/22〜6/18');
    // 今日の見どころ: 今日のタスク先頭 2 件
    expect(view.highlights).toEqual(['期限 12:00 麻薬監査', '監査後 セット作成']);
    // 止まっている理由: open_exceptions 先頭 2 件
    expect(view.blockedReasons).toEqual([
      { id: 'ex_1', label: 'ご家族の同意待ち(新規契約)', severity: 'critical' },
      { id: 'ex_2', label: '送付先の確認(やまもと内科)', severity: 'warning' },
    ]);
    // 次にやること: 調剤鑑査 + 期限内包
    expect(view.nextAction).toEqual({
      description: '調剤鑑査をして、セット作業へ進めます。',
      actionLabel: '調剤鑑査を始める — 12:00期限',
      actionHref: '/audit',
    });
  });

  it('moves the waiting status text to 止まっている理由 for external waits (高橋パターン)', () => {
    const view = deriveCompareCardView({
      boardCard: buildBoardCard({
        attention: 'external_wait',
        status_text: '医師回答待ち 2日 — 再照会を検討',
        link_label: '判断へ',
        link_href: '/prescriptions',
        current_step: 'decision',
      }),
      workspace: buildWorkspace({
        overall_status: 'inquiry_pending',
        previous_medication: null,
        current_medication: null,
        current_intake: {
          id: 'intake_t',
          prescribed_date: '2026-06-10T00:00:00.000Z',
          prescription_category: 'regular',
        },
      }),
    });

    expect(view.typeLabel).toBe('定期処方カード');
    expect(view.periodSub).toBe('今回処方 6/10 取込');
    expect(view.highlights).toEqual(['現在の工程: 判断(疑義照会中)']);
    expect(view.blockedReasons).toEqual([
      {
        id: 'attention-external_wait',
        label: '医師回答待ち 2日 — 再照会を検討',
        severity: 'warning',
      },
    ]);
    expect(view.nextAction).toEqual({
      description: '医師からの回答を確認して、処方へ反映します。',
      actionLabel: '照会状況を確認する',
      actionHref: '/communications/requests?status=sent&patient_id=patient_1',
    });
  });

  it('builds a 返信待ちカード preview from the board card alone (加藤パターン: reported サイクル)', () => {
    const view = deriveCompareCardView({
      boardCard: buildBoardCard({
        attention: 'reply_wait',
        status_text: '報告先の返信待ち 3日 — 再送できます',
        link_label: '報告・共有へ',
        link_href: '/reports',
        current_step: 'billing',
      }),
      // reported サイクルは workspace 対象外(buildPatientWorkspace は notIn reported/cancelled)
      workspace: null,
    });

    expect(view.typeLabel).toBe('返信待ちカード');
    expect(view.periodSub).toBe('進行中の処方はありません');
    expect(view.highlights).toEqual(['現在の工程: 算定']);
    expect(view.blockedReasons).toEqual([
      {
        id: 'attention-reply_wait',
        label: '報告先の返信待ち 3日 — 再送できます',
        severity: 'warning',
      },
    ]);
    expect(view.nextAction).toEqual({
      description: '返信状況を確認して、必要であれば報告を再送します。',
      actionLabel: '報告・共有へ',
      actionHref: '/communications/requests?status=sent&patient_id=patient_1',
    });
  });

  it('keeps reply-wait patient ids URL-encoded in compare card actions', () => {
    const patientId = '../patient with space?x=1#frag';

    const view = deriveCompareCardView({
      boardCard: buildBoardCard({
        patient_id: patientId,
        attention: 'reply_wait',
        status_text: '報告先の返信待ち 3日 — 再送できます',
        link_label: '報告・共有へ',
        link_href: '/reports',
        current_step: 'billing',
      }),
      workspace: null,
    });

    expect(view.nextAction?.actionHref).toBe(
      `/communications/requests?${new URLSearchParams({ status: 'sent', patient_id: patientId }).toString()}`,
    );
  });

  it('handles a card without board entry or workspace', () => {
    const view = deriveCompareCardView({ boardCard: null, workspace: null });
    expect(view.typeLabel).toBe('処方カード');
    expect(view.highlights).toEqual(['今日このカードでやることはありません']);
    expect(view.blockedReasons).toEqual([]);
    expect(view.nextAction).toBeNull();
  });
});

describe('parseComparePatientsParam', () => {
  it('splits, trims, dedupes and caps at 3 ids', () => {
    expect(parseComparePatientsParam('a, b ,a,c,d')).toEqual(['a', 'b', 'c']);
    expect(parseComparePatientsParam(',,')).toEqual([]);
    expect(parseComparePatientsParam(undefined)).toEqual([]);
    expect(parseComparePatientsParam(null)).toEqual([]);
  });
});

describe('selectDefaultComparePatients', () => {
  it('picks 最優先 + 返信待ち + 止まっている患者 from the sorted board cards', () => {
    const cards = [
      { patient_id: 'tanaka', attention: 'urgent_now' as const },
      { patient_id: 'sasaki', attention: 'wait_release' as const },
      { patient_id: 'ito', attention: 'visit_today' as const },
      { patient_id: 'takahashi', attention: 'external_wait' as const },
      { patient_id: 'kato', attention: 'reply_wait' as const },
    ];
    // checking が居ないので 3 枚目は external_wait(高橋)
    expect(selectDefaultComparePatients(cards)).toEqual(['tanaka', 'kato', 'takahashi']);
  });

  it('prefers checking over external_wait for the third slot', () => {
    const cards = [
      { patient_id: 'tanaka', attention: 'urgent_now' as const },
      { patient_id: 'kimura', attention: 'checking' as const },
      { patient_id: 'takahashi', attention: 'external_wait' as const },
      { patient_id: 'kato', attention: 'reply_wait' as const },
    ];
    expect(selectDefaultComparePatients(cards)).toEqual(['tanaka', 'kato', 'kimura']);
  });

  it('fills remaining slots in board order and dedupes', () => {
    const cards = [
      { patient_id: 'kato', attention: 'reply_wait' as const },
      { patient_id: 'sato', attention: 'steady' as const },
      { patient_id: 'suzuki', attention: 'steady' as const },
    ];
    // 先頭 = 加藤(reply_wait と重複)→ 補完で佐藤・鈴木
    expect(selectDefaultComparePatients(cards)).toEqual(['kato', 'sato', 'suzuki']);
  });

  it('returns fewer ids when the board has fewer cards', () => {
    expect(selectDefaultComparePatients([])).toEqual([]);
    expect(
      selectDefaultComparePatients([{ patient_id: 'only', attention: 'steady' as const }]),
    ).toEqual(['only']);
  });
});
