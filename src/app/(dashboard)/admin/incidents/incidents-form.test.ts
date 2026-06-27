import { describe, expect, it } from 'vitest';
import {
  EMPTY_INCIDENT_MEMO_FORM,
  INCIDENT_PROCESS_OPTIONS,
  buildIncidentMemoCompletion,
  buildIncidentMemoPatchPayload,
  hasPreventionMemo,
  incidentCardSubtext,
  isIncidentMemoFieldFilled,
  toIncidentMemoForm,
  type IncidentReportListItem,
} from './incidents-form';

function makeReport(overrides: Partial<IncidentReportListItem> = {}): IncidentReportListItem {
  return {
    id: 'incident-1',
    title: 'セット日付間違い',
    what_happened: null,
    cause: null,
    immediate_action: null,
    prevention_plan: null,
    related_process: null,
    severity: 'near_miss',
    status: 'open',
    occurred_at: null,
    created_at: '2026-06-12T08:00:00.000Z',
    updated_at: '2026-06-12T08:00:00.000Z',
    ...overrides,
  };
}

describe('INCIDENT_PROCESS_OPTIONS', () => {
  it('工程語彙(取込/入力/判断/調剤/監査/セット/訪問/報告/算定)を順に持つ', () => {
    expect(INCIDENT_PROCESS_OPTIONS.map((option) => option.label)).toEqual([
      '取込',
      '入力',
      '判断',
      '調剤',
      '監査',
      'セット',
      '訪問',
      '報告',
      '算定',
    ]);
  });
});

describe('toIncidentMemoForm', () => {
  it('null レコードは空フォームを返す', () => {
    expect(toIncidentMemoForm(null)).toEqual(EMPTY_INCIDENT_MEMO_FORM);
  });

  it('null フィールドを空文字へ射影する', () => {
    expect(toIncidentMemoForm(makeReport())).toEqual({
      whatHappened: '',
      cause: '',
      immediateAction: '',
      preventionPlan: '',
      relatedProcess: '',
    });
  });

  it('記入済みフィールドをそのまま射影する', () => {
    const report = makeReport({
      what_happened: '土曜セットに金曜の薬を入れた',
      cause: 'カレンダー確認漏れ',
      immediate_action: '訪問前に差し替え',
      prevention_plan: 'セット後に日付を二人で確認',
      related_process: 'set',
    });
    expect(toIncidentMemoForm(report)).toEqual({
      whatHappened: '土曜セットに金曜の薬を入れた',
      cause: 'カレンダー確認漏れ',
      immediateAction: '訪問前に差し替え',
      preventionPlan: 'セット後に日付を二人で確認',
      relatedProcess: 'set',
    });
  });

  it('語彙外の related_process は未選択として扱う', () => {
    expect(toIncidentMemoForm(makeReport({ related_process: 'unknown' })).relatedProcess).toBe('');
  });
});

describe('buildIncidentMemoPatchPayload', () => {
  it('trim して空文字を null に変換する', () => {
    expect(
      buildIncidentMemoPatchPayload({
        whatHappened: '  起きたこと  ',
        cause: '   ',
        immediateAction: '',
        preventionPlan: '次から変えること',
        relatedProcess: '',
      }),
    ).toEqual({
      what_happened: '起きたこと',
      cause: null,
      immediate_action: null,
      prevention_plan: '次から変えること',
      related_process: null,
    });
  });

  it('語彙内の工程のみ related_process として送る', () => {
    expect(
      buildIncidentMemoPatchPayload({
        ...EMPTY_INCIDENT_MEMO_FORM,
        relatedProcess: 'report',
      }).related_process,
    ).toBe('report');
    expect(
      buildIncidentMemoPatchPayload({
        ...EMPTY_INCIDENT_MEMO_FORM,
        relatedProcess: 'invalid-process',
      }).related_process,
    ).toBeNull();
  });
});

describe('buildIncidentMemoCompletion', () => {
  it('全項目未入力なら不足ラベルをすべて返す', () => {
    expect(buildIncidentMemoCompletion(EMPTY_INCIDENT_MEMO_FORM)).toEqual({
      completedCount: 0,
      totalCount: 5,
      missingLabels: ['起きたこと', '原因', 'すぐ行った対応', '次から変えること', '関係する工程'],
      isComplete: false,
    });
  });

  it('語彙内の工程と記入済みテキストだけを完了として数える', () => {
    expect(
      buildIncidentMemoCompletion({
        whatHappened: 'セット日付を間違えた',
        cause: '',
        immediateAction: '訪問前に差し替えた',
        preventionPlan: '',
        relatedProcess: 'set',
      }),
    ).toEqual({
      completedCount: 3,
      totalCount: 5,
      missingLabels: ['原因', '次から変えること'],
      isComplete: false,
    });
  });

  it('全項目が埋まると complete になる', () => {
    expect(
      buildIncidentMemoCompletion({
        whatHappened: 'セット日付を間違えた',
        cause: '曜日確認が抜けた',
        immediateAction: '訪問前に差し替えた',
        preventionPlan: 'セット後に曜日を二人で確認する',
        relatedProcess: 'set',
      }).isComplete,
    ).toBe(true);
  });
});

describe('incidentCardSubtext / hasPreventionMemo', () => {
  it('全項目未記入なら「再発防止を記録」', () => {
    const report = makeReport();
    expect(hasPreventionMemo(report)).toBe(false);
    expect(incidentCardSubtext(report)).toBe('再発防止を記録');
  });

  it('空白のみの記入は未記入として扱う', () => {
    expect(hasPreventionMemo(makeReport({ cause: '   ' }))).toBe(false);
  });

  it('1項目でも記入済みなら「再発防止メモあり」', () => {
    const report = makeReport({ prevention_plan: 'セット後に日付を二人で確認' });
    expect(hasPreventionMemo(report)).toBe(true);
    expect(incidentCardSubtext(report)).toBe('再発防止メモあり');
  });
});

describe('isIncidentMemoFieldFilled', () => {
  it('ナラティブ項目は trim 済みで空なら未入力、文字があれば入力済み', () => {
    const empty = { ...EMPTY_INCIDENT_MEMO_FORM, whatHappened: '   ' };
    expect(isIncidentMemoFieldFilled(empty, 'whatHappened')).toBe(false);
    const filled = { ...EMPTY_INCIDENT_MEMO_FORM, whatHappened: '別患者の薬' };
    expect(isIncidentMemoFieldFilled(filled, 'whatHappened')).toBe(true);
  });

  it('relatedProcess は既知工程のみ入力済み扱い', () => {
    expect(isIncidentMemoFieldFilled(EMPTY_INCIDENT_MEMO_FORM, 'relatedProcess')).toBe(false);
    expect(
      isIncidentMemoFieldFilled(
        { ...EMPTY_INCIDENT_MEMO_FORM, relatedProcess: 'unknown_process' },
        'relatedProcess',
      ),
    ).toBe(false);
    expect(
      isIncidentMemoFieldFilled(
        { ...EMPTY_INCIDENT_MEMO_FORM, relatedProcess: 'dispensing' },
        'relatedProcess',
      ),
    ).toBe(true);
  });
});
