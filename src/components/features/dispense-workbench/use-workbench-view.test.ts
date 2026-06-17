import { describe, expect, it } from 'vitest';

import { buildView } from './use-workbench-view';
import type { SeedPatient, WorkbenchModel } from './dispensing-workbench.types';

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
});
