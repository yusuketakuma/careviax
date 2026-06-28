import { describe, expect, it } from 'vitest';

import { buildView } from './use-workbench-view';
import type { SeedPatient, WorkbenchModel } from './dispensing-workbench.types';
import { cellKey } from './dispensing-workbench.logic';
import {
  SET_AUDIT_CHECK_ITEMS,
  type SetBatchGenerationMetadata,
} from './dispensing-workbench.write-types';

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

  it('fails closed to — for set/set-audit operator metadata (no fabricated names)', () => {
    const baseArgs = {
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

    const setView = buildView({ phase: 'setp', ...baseArgs });
    expect(setView.calBarMeta).toContain('セット者：—');
    expect(setView.calBarMeta).not.toContain('山田');

    const auditView = buildView({ phase: 'seta', ...baseArgs });
    expect(auditView.calBarMeta).toBe('セット完了：— ／ 監査者：—');
    expect(auditView.calBarMeta).not.toContain('佐々木');
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

  it('shows a normal empty patient fallback when real-data hydration reports an empty patient list', () => {
    const view = buildView({
      phase: 'dispense',
      isRealData: true,
      hydrated: true,
      loadError: false,
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
    expect(view.cur.name).toBe('対象患者なし');
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
        isRealData: true,
        hydrated: true,
        loadError: false,
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
        text: 'この工程に対象患者がいません',
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

describe('buildView set batch generation CTA', () => {
  function generationMeta(
    overrides: Partial<SetBatchGenerationMetadata> = {},
  ): SetBatchGenerationMetadata {
    return {
      batch_count: 0,
      needs_initial_generation: true,
      latest_batch_updated_at: null,
      expected_updated_at: '2026-06-20T00:00:00.000Z',
      can_generate: true,
      can_force_regenerate: false,
      ...overrides,
    };
  }

  const setArgs = {
    phase: 'setp' as const,
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

  it('exposes the initial generate CTA when generation needs an initial run and is permitted', () => {
    const view = buildView({ ...setArgs, calendarGeneration: generationMeta() });

    expect(view.batchGenerationVisible).toBe(true);
    expect(view.canGenerateBatches).toBe(true);
    expect(view.canForceRegenerate).toBe(false);
    expect(view.batchGenerationLabel).toBe('セットバッチを生成');
    expect(view.batchGenerationBlockedReason).toBe('');
  });

  it('exposes the force regenerate CTA when batches exist and force is permitted', () => {
    const view = buildView({
      ...setArgs,
      calendarGeneration: generationMeta({
        needs_initial_generation: false,
        batch_count: 14,
        can_generate: false,
        can_force_regenerate: true,
      }),
    });

    expect(view.batchGenerationVisible).toBe(true);
    expect(view.canGenerateBatches).toBe(false);
    expect(view.canForceRegenerate).toBe(true);
    expect(view.batchGenerationLabel).toBe('セットバッチ再生成');
    expect(view.batchGenerationBlockedReason).toBe('');
    expect(view.batchCount).toBe(14);
    expect(view.expectedUpdatedAt).toBe('2026-06-20T00:00:00.000Z');
  });

  it('blocks regeneration with an explanatory reason after set audit', () => {
    const view = buildView({
      ...setArgs,
      calendarGeneration: generationMeta({
        needs_initial_generation: false,
        batch_count: 14,
        can_generate: false,
        can_force_regenerate: false,
      }),
    });

    expect(view.batchGenerationVisible).toBe(true);
    expect(view.canGenerateBatches).toBe(false);
    expect(view.canForceRegenerate).toBe(false);
    expect(view.batchGenerationBlockedReason).toBe(
      'セット監査後は再生成できません（差戻し後に実行してください）',
    );
  });

  it('blocks initial generation with an explanatory reason before audit approval', () => {
    const view = buildView({
      ...setArgs,
      calendarGeneration: generationMeta({
        needs_initial_generation: true,
        can_generate: false,
      }),
    });

    expect(view.batchGenerationVisible).toBe(true);
    expect(view.canGenerateBatches).toBe(false);
    expect(view.canForceRegenerate).toBe(false);
    expect(view.batchGenerationBlockedReason).toBe('鑑査承認後にセットバッチを生成できます');
  });

  it.each(['dispense', 'audit'] as const)(
    'hides the generation CTA outside the set phase (%s)',
    (phase) => {
      const view = buildView({ ...setArgs, phase, calendarGeneration: generationMeta() });
      expect(view.batchGenerationVisible).toBe(false);
    },
  );

  it('hides the generation CTA when no generation metadata is available', () => {
    expect(buildView({ ...setArgs }).batchGenerationVisible).toBe(false);
    expect(buildView({ ...setArgs, calendarGeneration: null }).batchGenerationVisible).toBe(false);
  });
});

describe('buildView listState (左ペインの実データ取得状態)', () => {
  const listBase = {
    phase: 'dispense' as const,
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
    // 実データ空時は store の hydrate-empty が model:{} を入れる。それに合わせ空 model で構成する
    // （非空 model + 空 patients は本番に存在しない不整合で、autoTarget が空 days を参照して落ちる）。
    model: {},
  };

  it('モック（isRealData 省略）は常に ready（seed 表示・状態は出さない）', () => {
    expect(buildView({ ...listBase, patients: [patient] }).listState).toBe('ready');
  });

  it('実データ未取得（hydrated=false）は loading（seed のちらつきを避ける）', () => {
    expect(
      buildView({ ...listBase, isRealData: true, hydrated: false, patients: [] }).listState,
    ).toBe('loading');
  });

  it('実データ取得失敗（loadError）は error（hydrated 済みでも error を優先）', () => {
    expect(
      buildView({
        ...listBase,
        isRealData: true,
        hydrated: true,
        loadError: true,
        patients: [],
      }).listState,
    ).toBe('error');
  });

  it('詳細取得失敗でも取得済みの患者リストは ready のまま残す', () => {
    const view = buildView({
      ...listBase,
      isRealData: true,
      hydrated: true,
      loadError: true,
      patients: [patient],
      selId: patient.id,
    });

    expect(view.listState).toBe('ready');
    expect(view.patientCount).toBe('1');
    expect(view.patients.map((row) => row.id)).toEqual([patient.id]);
  });

  it('error は loading より優先（loadError なら hydrate 前でも error）', () => {
    // loadError 判定が !hydrated(loading) 判定より前にあることを固定する（優先順位の teeth）。
    expect(
      buildView({
        ...listBase,
        isRealData: true,
        hydrated: false,
        loadError: true,
        patients: [],
      }).listState,
    ).toBe('error');
  });

  it('実データ取得成功・0件は empty（障害と区別する）', () => {
    expect(
      buildView({
        ...listBase,
        isRealData: true,
        hydrated: true,
        loadError: false,
        patients: [],
      }).listState,
    ).toBe('empty');
  });

  it('実データ取得成功・患者ありは ready', () => {
    expect(
      buildView({
        ...listBase,
        isRealData: true,
        hydrated: true,
        loadError: false,
        patients: [patient],
      }).listState,
    ).toBe('ready');
  });
});
