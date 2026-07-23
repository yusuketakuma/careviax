// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { registerPatientsBoardCases } from './fixtures/patients-board.cases';
import {
  getPatientsBoardTestSupport,
  registerPatientsBoardHooks,
} from './fixtures/patients-board.test-support';

const { PatientBoardLoadingShell, card, formatNextVisitLabel, selectVisibleSafetyTags } =
  getPatientsBoardTestSupport();

describe('PatientsBoard', () => {
  registerPatientsBoardHooks();
  registerPatientsBoardCases();
});

describe('PatientBoardLoadingShell', () => {
  it('uses one status announcement and no patient-like placeholder data', () => {
    render(<PatientBoardLoadingShell />);

    const statuses = screen.getAllByRole('status');
    expect(statuses).toHaveLength(1);
    expect(statuses[0].getAttribute('aria-label')).toBe('患者一覧を読み込み中');
    expect(screen.getByText(/患者情報の判断には使用しないでください/)).toBeTruthy();
    expect(screen.queryByText(/0名|田中|山田|東京都|電話/)).toBeNull();
  });
});

describe('formatNextVisitLabel', () => {
  const now = new Date(2026, 5, 12, 9, 42);

  it('formats today / future dates / undecided labels', () => {
    expect(
      formatNextVisitLabel(card({ next_visit_date: '2026-06-12', next_visit_time: '14:00' }), now),
    ).toBe('本日 14:00');
    expect(
      formatNextVisitLabel(card({ next_visit_date: '2026-06-16', next_visit_time: null }), now),
    ).toBe('6/16(火)');
    expect(
      formatNextVisitLabel(card({ next_visit_date: null, next_visit_label: '退院連絡待ち' }), now),
    ).toBe('退院連絡待ち');
    expect(formatNextVisitLabel(card({ next_visit_date: null }), now)).toBe('未定');
  });
});

describe('selectVisibleSafetyTags', () => {
  it('never folds critical safety tags (allergy/narcotic) into the +N overflow', () => {
    // server 並び順: 麻薬→冷所→一包化→…→アレルギー。アレルギーは末尾だが重大なので常時表示。
    const { tags, hiddenCount } = selectVisibleSafetyTags([
      'narcotic',
      'cold_storage',
      'unit_dose',
      'allergy',
    ]);
    expect(tags).toContain('allergy');
    expect(tags).toContain('narcotic');
    // 上限超過分は非重大タグ(unit_dose)が折り畳まれる。
    expect(hiddenCount).toBe(1);
    expect(tags).not.toContain('unit_dose');
    // 元の並び順は保持する。
    expect(tags).toEqual(['narcotic', 'cold_storage', 'allergy']);
  });

  it('shows all critical tags even when they exceed the display limit', () => {
    const { tags, hiddenCount } = selectVisibleSafetyTags(['narcotic', 'allergy']);
    expect(tags).toEqual(['narcotic', 'allergy']);
    expect(hiddenCount).toBe(0);
  });

  it('folds only non-critical tags beyond the limit', () => {
    const { tags, hiddenCount } = selectVisibleSafetyTags([
      'cold_storage',
      'unit_dose',
      'half_tablet',
      'crush_prohibited',
      'renal',
    ]);
    expect(tags).toEqual(['cold_storage', 'unit_dose', 'half_tablet']);
    expect(hiddenCount).toBe(2);
  });
});
