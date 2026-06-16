import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SAVED_VIEW_CONDITIONS,
  SAVED_VIEW_CONDITION_FIELDS,
  SAVED_VIEW_PRESETS,
  formatConditionChipLabel,
  parseSavedView,
} from './saved-filter-views';

describe('saved-filter-views', () => {
  describe('SAVED_VIEW_PRESETS', () => {
    it('defines the four p1_01 preset cards in target order', () => {
      expect(SAVED_VIEW_PRESETS.map((preset) => preset.id)).toEqual([
        'morning_check',
        'set_team',
        'clerk_check',
        'manager',
      ]);
      expect(SAVED_VIEW_PRESETS.map((preset) => preset.title)).toEqual([
        '朝の確認',
        'セット担当',
        '事務で確認',
        '管理者用',
      ]);
    });

    it('routes each preset to an existing list page with query', () => {
      const hrefById = Object.fromEntries(
        SAVED_VIEW_PRESETS.map((preset) => [preset.id, preset.href]),
      );
      expect(hrefById.morning_check).toBe('/my-day?focus=visits&visit_filter=unprepared');
      expect(hrefById.set_team).toBe('/set');
      expect(hrefById.clerk_check).toBe('/clerk-support');
      expect(hrefById.manager).toBe('/dashboard');
    });

    it('keeps the target condition summaries on the cards', () => {
      expect(SAVED_VIEW_PRESETS.map((preset) => preset.conditionSummary)).toEqual([
        '本日訪問 / 未完了 / 薬切れ近い',
        'セット準備 / セット監査待ち',
        '患者確認待ち / 送付先未設定',
        '滞留 / ブロッカーあり / 負荷高い',
      ]);
    });
  });

  describe('formatConditionChipLabel', () => {
    it('projects the default conditions to the five target chips', () => {
      expect(DEFAULT_SAVED_VIEW_CONDITIONS.map(formatConditionChipLabel)).toEqual([
        '訪問日:今日〜今週',
        '担当:自分',
        '薬切れ:3日以内',
        '処方変更:あり',
        '予定:患者確認待ちを含む',
      ]);
    });

    it('falls back to the raw value for unknown condition values', () => {
      expect(formatConditionChipLabel({ field: 'visit_date', value: 'next_month' })).toBe(
        '訪問日:next_month',
      );
    });
  });

  describe('parseSavedView', () => {
    it('reads a stored saved_view with saved_at', () => {
      expect(
        parseSavedView({
          conditions: [
            { field: 'assignee', value: 'me' },
            { field: 'supply_runout', value: 'within_3_days' },
          ],
          saved_at: '2026-06-13T09:00:00.000Z',
        }),
      ).toEqual({
        conditions: [
          { field: 'assignee', value: 'me' },
          { field: 'supply_runout', value: 'within_3_days' },
        ],
        savedAt: '2026-06-13T09:00:00.000Z',
      });
    });

    it('skips malformed entries and unknown fields', () => {
      expect(
        parseSavedView({
          conditions: [
            { field: 'unknown_field', value: 'x' },
            { field: 'assignee', value: '' },
            'broken',
            { field: 'visit_date', value: 'today' },
          ],
        }),
      ).toEqual({
        conditions: [{ field: 'visit_date', value: 'today' }],
        savedAt: undefined,
      });
    });

    it('returns null for missing, non-object, or empty saved views', () => {
      expect(parseSavedView(undefined)).toBeNull();
      expect(parseSavedView(null)).toBeNull();
      expect(parseSavedView('saved')).toBeNull();
      expect(parseSavedView([])).toBeNull();
      expect(parseSavedView({})).toBeNull();
      expect(parseSavedView({ conditions: [] })).toBeNull();
      expect(parseSavedView({ conditions: [{ field: 'nope', value: 'x' }] })).toBeNull();
    });
  });

  it('keeps the default conditions within the shared field list', () => {
    for (const condition of DEFAULT_SAVED_VIEW_CONDITIONS) {
      expect(SAVED_VIEW_CONDITION_FIELDS).toContain(condition.field);
    }
  });
});
