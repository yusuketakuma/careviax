import { describe, expect, it } from 'vitest';

import { buildView } from './use-workbench-view';
import type { SeedPatient, WorkbenchModel } from './dispensing-workbench.types';
import { cellKey } from './dispensing-workbench.logic';
import { SET_AUDIT_CHECK_ITEMS } from './dispensing-workbench.write-types';

const patient: SeedPatient = {
  id: 'patient_api',
  name: '計画 花子',
  kana: 'ケイカク ハナコ',
  dob: '1940/01/01',
  age: 86,
  sex: '女',
  sub: '1日計画',
  short: '計',
  chips: [],
  regist: '2026/04/01',
  seedStart: '2026-04-01',
  seedDays: 1,
  yosei: '可',
  changes: [],
  biko: [],
  rows: [],
};

const model: WorkbenchModel = {
  patient_api: [
    {
      gid: 'g_api',
      label: 'セット対象',
      method: 'facility_calendar',
      start: '2026-04-01',
      days: 1,
      calendarStart: '2026-04-01',
      calendarDayCount: 1,
      drugs: [
        {
          did: 'line_1',
          name: 'アムロジピン錠5mg',
          yoho: '朝食後',
          a: '1',
          h: '',
          y: '',
          n: '',
          tag: '',
          funsai: false,
          note: '',
        },
      ],
    },
  ],
};

const singleRowGroup = model.patient_api[0]!;
const multiRowModel: WorkbenchModel = {
  patient_api: [
    {
      ...singleRowGroup,
      drugs: [
        ...singleRowGroup.drugs,
        {
          did: 'line_2',
          name: 'カンデサルタン錠4mg',
          yoho: '朝食後',
          a: '1',
          h: '',
          y: '',
          n: '',
          tag: '',
          funsai: false,
          note: '',
        },
      ],
    },
  ],
};

describe('buildView calendar period', () => {
  it('renders API-backed set calendar period and day count instead of the legacy 7-day window', () => {
    const view = buildView({
      phase: 'setp',
      selId: patient.id,
      sortMode: 'start',
      done: {},
      audit: {},
      setCells: {},
      auditCells: {},
      outChk: {},
      checks: {},
      ng: {},
      target: null,
      holdModal: null,
      holdInfo: {},
      packet: {},
      compareOpen: false,
      model,
      patients: [patient],
    });

    expect(view.calDays).toHaveLength(1);
    expect(view.calDays[0]).toMatchObject({ d: '4/1', w: '水' });
    expect(view.cur.period).toBe('2026/4/1（水）〜4/1（水）');
    expect(view.progress.fraction).toBe('0 / 1');
    expect(view.gate.text).toContain('未セット 1');
  });

  it('shows a narcotic classification review chip without falling back to no-notes', () => {
    const view = buildView({
      phase: 'setp',
      selId: patient.id,
      sortMode: 'start',
      done: {},
      audit: {},
      setCells: {},
      auditCells: {},
      outChk: {},
      checks: {},
      ng: {},
      target: null,
      holdModal: null,
      holdInfo: {},
      packet: {},
      compareOpen: false,
      model: {
        patient_api: [
          {
            ...singleRowGroup,
            narcoticClassification: {
              unresolvedLineCount: 2,
              status: 'needs_review',
            },
          },
        ],
      },
      patients: [patient],
    });

    expect(view.setChips.map((chip) => chip.label)).toContain('麻薬分類未確認 2剤');
    expect(view.setChips.map((chip) => chip.label)).not.toContain('特記なし');
  });

  it('does not fall back to seed patients when real-data hydration reports an empty patient list', () => {
    const view = buildView({
      phase: 'dispense',
      selId: '',
      sortMode: 'start',
      done: {},
      audit: {},
      setCells: {},
      auditCells: {},
      outChk: {},
      checks: {},
      ng: {},
      target: null,
      holdModal: null,
      holdInfo: {},
      packet: {},
      compareOpen: false,
      model: {},
      patients: [],
    });

    expect(view.patientCount).toBe('0');
    expect(view.patients).toEqual([]);
    expect(view.rows).toEqual([]);
    expect(view.cur.name).toBe('実データ未取得');
    expect(view.cur.period).toBe('—');
    expect(view.progress.fraction).toBe('0 / 0');
    expect(view.primary.cursor).toBe('not-allowed');
  });

  it('blocks dispense and audit primary actions until every visible drug row is checked', () => {
    const base = {
      selId: patient.id,
      sortMode: 'start' as const,
      done: {},
      audit: {},
      setCells: {},
      auditCells: {},
      outChk: {},
      checks: {},
      ng: {},
      target: null,
      holdModal: null,
      holdInfo: {},
      packet: {},
      compareOpen: false,
      model,
      patients: [patient],
    };

    const blockedDispense = buildView({ ...base, phase: 'dispense' });
    expect(blockedDispense.primary.cursor).toBe('not-allowed');

    const allowedDispense = buildView({
      ...base,
      phase: 'dispense',
      done: { line_1: true },
    });
    expect(allowedDispense.primary.cursor).toBe('pointer');

    const blockedAudit = buildView({ ...base, phase: 'audit' });
    expect(blockedAudit.primary.cursor).toBe('not-allowed');

    const allowedAudit = buildView({
      ...base,
      phase: 'audit',
      done: { line_1: true },
      audit: { line_1: true },
    });
    expect(allowedAudit.primary.cursor).toBe('pointer');
  });

  it('blocks audit primary when narcotic double-count evidence is incomplete', () => {
    const narcoticModel: WorkbenchModel = {
      patient_api: [
        {
          ...singleRowGroup,
          drugs: [
            {
              ...singleRowGroup.drugs[0]!,
              isNarcotic: true,
              dispensedQuantity: 12,
              unit: '錠',
            },
          ],
        },
      ],
    };
    const base = {
      phase: 'audit' as const,
      selId: patient.id,
      sortMode: 'start' as const,
      done: { line_1: true },
      audit: { line_1: true },
      setCells: {},
      auditCells: {},
      outChk: {},
      checks: {},
      ng: {},
      target: null,
      holdModal: null,
      holdInfo: {},
      packet: {},
      compareOpen: false,
      model: narcoticModel,
      patients: [patient],
    };

    const blocked = buildView({
      ...base,
      auditDoubleCountByDid: { line_1: { first: '12', second: '' } },
    });
    expect(blocked.primary.cursor).toBe('not-allowed');
    expect(blocked.gate).toMatchObject({
      ok: false,
      text: '麻薬ダブルカウント未完了',
    });

    const allowed = buildView({
      ...base,
      auditDoubleCountByDid: { line_1: { first: '12', second: '12' } },
    });
    expect(allowed.primary.cursor).toBe('pointer');
  });

  it('derives actual quantity input step from the prescription unit', () => {
    const view = buildView({
      phase: 'dispense',
      selId: patient.id,
      sortMode: 'start',
      done: {},
      audit: {},
      setCells: {},
      auditCells: {},
      outChk: {},
      checks: {},
      ng: {},
      target: null,
      holdModal: null,
      holdInfo: {},
      packet: {},
      compareOpen: false,
      model: {
        patient_api: [
          {
            ...singleRowGroup,
            drugs: [
              {
                ...singleRowGroup.drugs[0]!,
                prescribedQuantity: 14,
                unit: '包',
              },
            ],
          },
        ],
      },
      patients: [patient],
    });

    const drugRow = view.rows.find((row) => row.kind === 'drug');
    expect(drugRow).toMatchObject({
      actualQuantityStep: '1',
      actualQuantityInputMode: 'numeric',
      actualQuantityInput: '14',
    });
  });

  it('passes group period warnings through to section rows', () => {
    const view = buildView({
      phase: 'dispense',
      selId: patient.id,
      sortMode: 'start',
      done: {},
      audit: {},
      setCells: {},
      auditCells: {},
      outChk: {},
      checks: {},
      ng: {},
      target: null,
      holdModal: null,
      holdInfo: {},
      packet: {},
      compareOpen: false,
      model: {
        patient_api: [
          {
            ...singleRowGroup,
            periodWarning: {
              kind: 'mixed_period',
              label: '期間混在 2種類',
              detail: '2026-06-10〜2026-06-23 14日 / 2026-06-17〜2026-06-23 7日',
            },
          },
        ],
      },
      patients: [patient],
    });

    expect(view.rows[0]).toMatchObject({
      kind: 'sec',
      periodWarning: {
        kind: 'mixed_period',
        label: '期間混在 2種類',
      },
    });
  });

  it('keeps dispense and audit primary actions disabled when only some visible rows are checked', () => {
    const base = {
      selId: patient.id,
      sortMode: 'start' as const,
      done: {},
      audit: {},
      setCells: {},
      auditCells: {},
      outChk: {},
      checks: {},
      ng: {},
      target: null,
      holdModal: null,
      holdInfo: {},
      packet: {},
      compareOpen: false,
      model: multiRowModel,
      patients: [patient],
    };

    const partialDispense = buildView({
      ...base,
      phase: 'dispense',
      done: { line_1: true },
    });
    expect(partialDispense.gate.ok).toBe(false);
    expect(partialDispense.progress.fraction).toBe('1 / 2');
    expect(partialDispense.primary.cursor).toBe('not-allowed');

    const partialAudit = buildView({
      ...base,
      phase: 'audit',
      done: { line_1: true },
      audit: { line_1: true },
    });
    expect(partialAudit.gate.ok).toBe(false);
    expect(partialAudit.progress.fraction).toBe('1 / 2');
    expect(partialAudit.primary.cursor).toBe('not-allowed');
  });

  it('keeps audit primary disabled when rows are audited locally but not dispensed', () => {
    const view = buildView({
      phase: 'audit',
      selId: patient.id,
      sortMode: 'start',
      done: {},
      audit: { line_1: true, line_2: true },
      setCells: {},
      auditCells: {},
      outChk: {},
      checks: {},
      ng: {},
      target: null,
      holdModal: null,
      holdInfo: {},
      packet: {},
      compareOpen: false,
      model: multiRowModel,
      patients: [patient],
    });

    expect(view.gate.ok).toBe(false);
    expect(view.progress.fraction).toBe('0 / 2');
    expect(view.primary.cursor).toBe('not-allowed');
    expect(view.rows.filter((row) => row.kind === 'drug').map((row) => row.note)).toEqual([
      '未調剤',
      '未調剤',
    ]);
  });

  it.each(['setp', 'seta'] as const)(
    'blocks the calendar completion gate when %s has no authoritative real-data patients',
    (phase) => {
      const view = buildView({
        phase,
        selId: '',
        sortMode: 'start',
        done: {},
        audit: {},
        setCells: {},
        auditCells: {},
        outChk: {},
        checks: {},
        ng: {},
        target: null,
        holdModal: null,
        holdInfo: {},
        packet: {},
        compareOpen: false,
        model: {},
        patients: [],
      });

      expect(view.patientCount).toBe('0');
      expect(view.gate).toMatchObject({
        ok: false,
        text: '実データを取得できませんでした',
      });
      expect(view.primary.cursor).toBe('not-allowed');
    },
  );

  it('blocks set-audit approval until all six checklist items are complete', () => {
    const auditCells = { [cellKey(patient.id, 0, '朝')]: 'ok' };
    const base = {
      phase: 'seta' as const,
      selId: patient.id,
      sortMode: 'start' as const,
      done: {},
      audit: {},
      setCells: {},
      auditCells,
      outChk: {},
      checks: {},
      ng: {},
      target: { di: 0, tk: '朝' },
      holdModal: null,
      holdInfo: {},
      packet: {},
      compareOpen: false,
      model,
      patients: [patient],
    };

    const blocked = buildView(base);
    expect(blocked.gate).toMatchObject({
      ok: false,
      text: '完了条件：未監査 0・NG 0・確認 6',
    });
    expect(blocked.primary.cursor).toBe('not-allowed');

    const completeChecks = Object.fromEntries(
      SET_AUDIT_CHECK_ITEMS.map((_, index) => [`${cellKey(patient.id, 0, '朝')}:${index}`, true]),
    );
    const allowed = buildView({ ...base, checks: completeChecks });
    expect(allowed.gate).toMatchObject({
      ok: true,
      text: '✓ 全セル監査OK（承認可）',
    });
    expect(allowed.primary.cursor).toBe('pointer');
  });
});
