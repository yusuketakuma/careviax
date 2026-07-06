// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import {
  buildPrimaryConfirm,
  buildRejectConfirm,
  buildForceRegenConfirm,
} from './dispensing-workbench';
import type {
  PendingPrimary,
  PendingSetAuditReject,
  PendingForceRegen,
} from './dispensing-workbench.write-types';

const DISPENSE: PendingPrimary = {
  phase: 'dispense',
  next: 'audit',
  patientId: 'patient_1',
  taskId: 'task_1',
  cycleVersion: 4,
};

const REJECT: PendingSetAuditReject = {
  patientId: 'patient_1',
  planId: 'plan_1',
  target: { di: 0, tk: '朝' },
  ngCode: 'drug_mismatch',
  ngLabel: '薬剤違い',
  meta: { batchIds: ['batch_1'], versions: [7], dayNumber: 3, slot: 'bedtime' },
};

const FORCE_REGEN: PendingForceRegen = {
  patientId: 'patient_1',
  planId: 'plan_1',
  expectedUpdatedAt: '2026-06-20T00:00:00.000Z',
};

describe('confirm description evidence', () => {
  describe('buildPrimaryConfirm', () => {
    it('氏名+生年月日を description に前置する', () => {
      const { description } = buildPrimaryConfirm(DISPENSE, '計画 花子', '昭和20年1月1日');
      expect(description).toContain('計画 花子');
      expect(description).toContain('昭和20年1月1日');
    });

    it('調剤完了 confirm は現在表示中の薬剤行が対象であることを明示する', () => {
      const { description } = buildPrimaryConfirm(DISPENSE, '計画 花子', '昭和20年1月1日');
      expect(description).toContain('現在表示中の薬剤行');
      expect(description).toContain('確定後は取り消せません');
    });

    it('監査承認 confirm は調剤済み薬剤行が対象であることを明示する', () => {
      const { description } = buildPrimaryConfirm(
        { ...DISPENSE, phase: 'audit', narcoticLines: [] },
        '計画 花子',
        '昭和20年1月1日',
      );
      expect(description).toContain('調剤済み薬剤行');
      expect(description).toContain('取り消せません');
    });

    it('麻薬を含む監査承認 confirm も調剤済み薬剤行の麻薬二重計数範囲を明示する', () => {
      const { description, requiredConfirmText } = buildPrimaryConfirm(
        {
          ...DISPENSE,
          phase: 'audit',
          narcoticLines: [
            {
              line_id: 'line_narcotic',
              drug_name: '麻薬製剤',
              dispensed_quantity: 10,
              first_count: 10,
              second_count: 10,
            },
          ],
        },
        '計画 花子',
        '昭和20年1月1日',
      );
      expect(description).toContain('調剤済み薬剤行');
      expect(description).toContain('麻薬 1 件');
      expect(requiredConfirmText).toBe('麻薬');
    });

    it('セット監査承認 confirm は表示中セルが対象であることを明示する', () => {
      const { description } = buildPrimaryConfirm(
        { phase: 'seta', next: 'seta', patientId: 'patient_1', planId: 'plan_1' },
        '計画 花子',
        '昭和20年1月1日',
      );
      expect(description).toContain('表示中セル');
      expect(description).toContain('取り消せません');
    });

    it('生年月日が未取得（—）のときは氏名のみ前置する', () => {
      const { description } = buildPrimaryConfirm(DISPENSE, '計画 花子', '—');
      expect(description).toContain('計画 花子');
      expect(description).not.toContain('（—）');
    });

    it('患者名が無いときは前置を省略する', () => {
      const { description } = buildPrimaryConfirm(DISPENSE, undefined, undefined);
      expect(description).not.toContain('様');
    });
  });

  describe('buildRejectConfirm', () => {
    it('氏名+生年月日・対象セル（日目/時点）・NG 理由を明示する', () => {
      const { description } = buildRejectConfirm(REJECT, '計画 花子', '昭和20年1月1日');
      expect(description).toContain('計画 花子');
      expect(description).toContain('昭和20年1月1日');
      expect(description).toContain('3日目');
      expect(description).toContain('眠前'); // slot=bedtime
      expect(description).toContain('薬剤違い');
    });

    it('pending が無いときは空 description を返す', () => {
      const { description } = buildRejectConfirm(null);
      expect(description).toBe('');
    });
  });

  describe('buildForceRegenConfirm', () => {
    it('氏名+生年月日・対象セットプラン期間を明示する', () => {
      const { description } = buildForceRegenConfirm(
        FORCE_REGEN,
        '計画 花子',
        '昭和20年1月1日',
        '2026/06/17〜2026/06/30',
      );
      expect(description).toContain('計画 花子');
      expect(description).toContain('昭和20年1月1日');
      expect(description).toContain('2026/06/17〜2026/06/30');
      expect(description).toContain('取り消せません');
    });

    it('pending が無いときは空 description を返す', () => {
      const { description } = buildForceRegenConfirm(null);
      expect(description).toBe('');
    });
  });
});
