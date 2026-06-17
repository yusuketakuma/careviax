import { describe, expect, it } from 'vitest';

import { SET_AUDIT_CHECK_ITEMS } from './dispensing-workbench.write-types';
import type { WorkbenchState } from './dispensing-workbench.store';
import {
  buildRejectedSetAuditInput,
  collectCarryPacketEvidence,
  collectDispenseAuditDoubleCount,
  collectDispenseAuditDoubleCountIssues,
  collectDispenseLines,
  collectDispenseQuantityIssues,
  collectSetAuditChecklistFromChecks,
} from './use-workbench-write-handlers';

describe('collectDispenseLines', () => {
  it('includes backend packaging group id and normalized packaging method from the current group', () => {
    const lines = collectDispenseLines({
      selId: 'patient_1',
      model: {
        patient_1: [
          {
            gid: 'group_1',
            label: 'PTP',
            method: 'PTP（手撒き）',
            start: '2026-06-17',
            days: 1,
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
                prescribedQuantity: 14,
                unit: '錠',
              },
            ],
          },
        ],
      },
      writeContext: {
        taskId: 'task_1',
        cycleId: 'cycle_1',
        cycleVersion: 4,
        planId: null,
        lineGroupByDid: { line_1: 'packaging_group_1' },
        groupIdByGid: { group_1: 'packaging_group_1' },
        cellMeta: {},
      },
      quantityConfirmedByDid: { line_1: true },
    } as unknown as WorkbenchState);

    expect(lines).toEqual([
      {
        line_id: 'line_1',
        actual_drug_name: 'アムロジピン錠5mg',
        actual_quantity: 14,
        actual_quantity_confirmed: true,
        actual_quantity_source: 'prescription_quantity_confirmed',
        actual_unit: '錠',
        carry_type: 'carry',
        packaging_method: 'blister_pack',
        packaging_group_id: 'packaging_group_1',
        special_notes: 'PTP（手撒き）',
      },
    ]);
  });

  it('preserves unknown group labels as packaging instructions while using API enum values', () => {
    const lines = collectDispenseLines({
      selId: 'patient_1',
      model: {
        patient_1: [
          {
            gid: 'group_1',
            label: '朝夕別',
            method: '朝夕別一包化',
            start: '2026-06-17',
            days: 1,
            drugs: [
              {
                did: 'line_1',
                name: '薬剤A',
                yoho: '朝夕食後',
                a: '1',
                h: '',
                y: '1',
                n: '',
                tag: '',
                funsai: false,
                note: '',
                prescribedQuantity: 14,
                unit: '錠',
              },
            ],
          },
        ],
      },
      writeContext: {
        taskId: 'task_1',
        cycleId: 'cycle_1',
        cycleVersion: 4,
        planId: null,
        lineGroupByDid: {},
        groupIdByGid: {},
        cellMeta: {},
      },
      quantityConfirmedByDid: { line_1: true },
    } as unknown as WorkbenchState);

    expect(lines[0]).toMatchObject({
      packaging_method: 'morning_evening_unit_dose',
      special_notes: '朝夕別一包化',
    });
  });

  it('requires explicit quantity confirmation before using prescribed quantity as actual quantity', () => {
    const state = {
      selId: 'patient_1',
      model: {
        patient_1: [
          {
            gid: 'group_1',
            label: '朝食後',
            method: '一包化',
            start: '2026-06-17',
            days: 1,
            drugs: [
              {
                did: 'line_1',
                name: '薬剤A',
                yoho: '朝食後',
                a: '1',
                h: '',
                y: '',
                n: '',
                tag: '',
                funsai: false,
                note: '',
                prescribedQuantity: 14,
              },
            ],
          },
        ],
      },
      writeContext: {
        taskId: 'task_1',
        cycleId: 'cycle_1',
        cycleVersion: 4,
        planId: null,
        lineGroupByDid: {},
        groupIdByGid: {},
        cellMeta: {},
      },
      quantityConfirmedByDid: {},
    } as unknown as WorkbenchState;

    expect(collectDispenseQuantityIssues(state)).toEqual([
      { line_id: 'line_1', reason: 'actual_quantity_confirmation_required' },
    ]);
    expect(() => collectDispenseLines(state)).toThrow('UNCONFIRMED_DISPENSE_QUANTITY');
  });

  it('preserves existing result quantity instead of overwriting it with prescribed quantity', () => {
    const lines = collectDispenseLines({
      selId: 'patient_1',
      model: {
        patient_1: [
          {
            gid: 'group_1',
            label: '朝食後',
            method: '一包化',
            start: '2026-06-17',
            days: 1,
            drugs: [
              {
                did: 'line_1',
                name: '薬剤A',
                yoho: '朝食後',
                a: '1',
                h: '',
                y: '',
                n: '',
                tag: '',
                funsai: false,
                note: '',
                prescribedQuantity: 14,
                dispensedQuantity: 12,
                discrepancyReason: '残薬調整',
              },
            ],
          },
        ],
      },
      writeContext: {
        taskId: 'task_1',
        cycleId: 'cycle_1',
        cycleVersion: 4,
        planId: null,
        lineGroupByDid: {},
        groupIdByGid: {},
        cellMeta: {},
      },
      quantityConfirmedByDid: {},
    } as unknown as WorkbenchState);

    expect(lines[0]).toMatchObject({
      actual_quantity: 12,
      actual_quantity_confirmed: true,
      actual_quantity_source: 'existing_result',
      discrepancy_reason: '残薬調整',
    });
  });

  it('requires a discrepancy reason when an existing result quantity differs from prescription', () => {
    const state = {
      selId: 'patient_1',
      model: {
        patient_1: [
          {
            gid: 'group_1',
            label: '朝食後',
            method: '一包化',
            start: '2026-06-17',
            days: 1,
            drugs: [
              {
                did: 'line_1',
                name: '薬剤A',
                yoho: '朝食後',
                a: '1',
                h: '',
                y: '',
                n: '',
                tag: '',
                funsai: false,
                note: '',
                prescribedQuantity: 14,
                dispensedQuantity: 12,
              },
            ],
          },
        ],
      },
      writeContext: {
        taskId: 'task_1',
        cycleId: 'cycle_1',
        cycleVersion: 4,
        planId: null,
        lineGroupByDid: {},
        groupIdByGid: {},
        cellMeta: {},
      },
      quantityConfirmedByDid: {},
      actualQuantityInputByDid: {},
      discrepancyReasonByDid: {},
    } as unknown as WorkbenchState;

    expect(collectDispenseQuantityIssues(state)).toEqual([
      { line_id: 'line_1', reason: 'discrepancy_reason_required' },
    ]);
    expect(() => collectDispenseLines(state)).toThrow('DISCREPANCY_REASON_REQUIRED');
  });

  it('uses manual_entry with discrepancy reason when actual quantity differs from prescription', () => {
    const lines = collectDispenseLines({
      selId: 'patient_1',
      model: {
        patient_1: [
          {
            gid: 'group_1',
            label: '朝食後',
            method: '一包化',
            start: '2026-06-17',
            days: 1,
            drugs: [
              {
                did: 'line_1',
                name: '薬剤A',
                yoho: '朝食後',
                a: '1',
                h: '',
                y: '',
                n: '',
                tag: '',
                funsai: false,
                note: '',
                prescribedQuantity: 14,
                unit: '錠',
              },
            ],
          },
        ],
      },
      writeContext: {
        taskId: 'task_1',
        cycleId: 'cycle_1',
        cycleVersion: 4,
        planId: null,
        lineGroupByDid: {},
        groupIdByGid: {},
        cellMeta: {},
      },
      quantityConfirmedByDid: { line_1: true },
      actualQuantityInputByDid: { line_1: '12' },
      discrepancyReasonByDid: { line_1: '残薬調整' },
    } as unknown as WorkbenchState);

    expect(lines[0]).toMatchObject({
      actual_quantity: 12,
      actual_quantity_confirmed: true,
      actual_quantity_source: 'manual_entry',
      actual_unit: '錠',
      discrepancy_reason: '残薬調整',
    });
  });

  it('rejects manual quantities that do not match the line unit step', () => {
    const state = {
      selId: 'patient_1',
      model: {
        patient_1: [
          {
            gid: 'group_1',
            label: '朝食後',
            method: '一包化',
            start: '2026-06-17',
            days: 1,
            drugs: [
              {
                did: 'line_1',
                name: '分包薬A',
                yoho: '朝食後',
                a: '1',
                h: '',
                y: '',
                n: '',
                tag: '',
                funsai: false,
                note: '',
                prescribedQuantity: 14,
                unit: '包',
              },
            ],
          },
        ],
      },
      writeContext: {
        taskId: 'task_1',
        cycleId: 'cycle_1',
        cycleVersion: 4,
        planId: null,
        lineGroupByDid: {},
        groupIdByGid: {},
        cellMeta: {},
      },
      quantityConfirmedByDid: { line_1: true },
      actualQuantityInputByDid: { line_1: '12.5' },
      discrepancyReasonByDid: { line_1: '残薬調整' },
    } as unknown as WorkbenchState;

    expect(collectDispenseQuantityIssues(state)).toEqual([
      { line_id: 'line_1', reason: 'actual_quantity_invalid' },
    ]);
    expect(() => collectDispenseLines(state)).toThrow('INVALID_DISPENSE_QUANTITY');
  });

  it('requires a discrepancy reason for manual quantity differences', () => {
    const state = {
      selId: 'patient_1',
      model: {
        patient_1: [
          {
            gid: 'group_1',
            label: '朝食後',
            method: '一包化',
            start: '2026-06-17',
            days: 1,
            drugs: [
              {
                did: 'line_1',
                name: '薬剤A',
                yoho: '朝食後',
                a: '1',
                h: '',
                y: '',
                n: '',
                tag: '',
                funsai: false,
                note: '',
                prescribedQuantity: 14,
              },
            ],
          },
        ],
      },
      writeContext: {
        taskId: 'task_1',
        cycleId: 'cycle_1',
        cycleVersion: 4,
        planId: null,
        lineGroupByDid: {},
        groupIdByGid: {},
        cellMeta: {},
      },
      quantityConfirmedByDid: { line_1: true },
      actualQuantityInputByDid: { line_1: '12' },
      discrepancyReasonByDid: {},
    } as unknown as WorkbenchState;

    expect(collectDispenseQuantityIssues(state)).toEqual([
      { line_id: 'line_1', reason: 'discrepancy_reason_required' },
    ]);
    expect(() => collectDispenseLines(state)).toThrow('DISCREPANCY_REASON_REQUIRED');
  });

  it('rejects invalid manual quantity input instead of falling back to prescription quantity', () => {
    const state = {
      selId: 'patient_1',
      model: {
        patient_1: [
          {
            gid: 'group_1',
            label: '朝食後',
            method: '一包化',
            start: '2026-06-17',
            days: 1,
            drugs: [
              {
                did: 'line_1',
                name: '薬剤A',
                yoho: '朝食後',
                a: '1',
                h: '',
                y: '',
                n: '',
                tag: '',
                funsai: false,
                note: '',
                prescribedQuantity: 14,
              },
            ],
          },
        ],
      },
      writeContext: {
        taskId: 'task_1',
        cycleId: 'cycle_1',
        cycleVersion: 4,
        planId: null,
        lineGroupByDid: {},
        groupIdByGid: {},
        cellMeta: {},
      },
      quantityConfirmedByDid: { line_1: true },
      actualQuantityInputByDid: { line_1: 'abc' },
      discrepancyReasonByDid: {},
    } as unknown as WorkbenchState;

    expect(collectDispenseQuantityIssues(state)).toEqual([
      { line_id: 'line_1', reason: 'actual_quantity_invalid' },
    ]);
    expect(() => collectDispenseLines(state)).toThrow('INVALID_DISPENSE_QUANTITY');
  });

  it('does not fabricate actual quantity when prescribed quantity is unresolved', () => {
    const state = {
      selId: 'patient_1',
      model: {
        patient_1: [
          {
            gid: 'group_1',
            label: '朝食後',
            method: '一包化',
            start: '2026-06-17',
            days: 1,
            drugs: [
              {
                did: 'line_1',
                name: '薬剤A',
                yoho: '朝食後',
                a: '1',
                h: '',
                y: '',
                n: '',
                tag: '',
                funsai: false,
                note: '',
                prescribedQuantity: null,
              },
            ],
          },
        ],
      },
      writeContext: {
        taskId: 'task_1',
        cycleId: 'cycle_1',
        cycleVersion: 4,
        planId: null,
        lineGroupByDid: {},
        groupIdByGid: {},
        cellMeta: {},
      },
      quantityConfirmedByDid: {},
    } as unknown as WorkbenchState;

    expect(collectDispenseQuantityIssues(state)).toEqual([
      { line_id: 'line_1', reason: 'prescribed_quantity_required' },
    ]);
    expect(() => collectDispenseLines(state)).toThrow('UNRESOLVED_DISPENSE_QUANTITY');
  });
});

describe('collectDispenseAuditDoubleCount', () => {
  it('builds explicit double-count evidence for audited narcotic lines only', () => {
    const state = {
      selId: 'patient_1',
      model: {
        patient_1: [
          {
            gid: 'group_1',
            label: '朝食後',
            method: '一包化',
            start: '2026-06-17',
            days: 1,
            drugs: [
              {
                did: 'line_narcotic',
                name: 'モルヒネ徐放錠',
                yoho: '朝食後',
                a: '1',
                h: '',
                y: '',
                n: '',
                tag: '麻薬',
                funsai: false,
                note: '',
                dispensedQuantity: 12,
                isNarcotic: true,
              },
              {
                did: 'line_plain',
                name: 'アムロジピン錠',
                yoho: '朝食後',
                a: '1',
                h: '',
                y: '',
                n: '',
                tag: '',
                funsai: false,
                note: '',
                dispensedQuantity: 14,
                isNarcotic: false,
              },
            ],
          },
        ],
      },
      audit: { line_narcotic: true, line_plain: true },
      auditDoubleCountByDid: {
        line_narcotic: { first: '12', second: '12' },
      },
    } as unknown as WorkbenchState;

    expect(collectDispenseAuditDoubleCountIssues(state)).toEqual([]);
    expect(collectDispenseAuditDoubleCount(state)).toEqual([
      {
        line_id: 'line_narcotic',
        drug_name: 'モルヒネ徐放錠',
        dispensed_quantity: 12,
        first_count: 12,
        second_count: 12,
      },
    ]);
  });

  it('flags missing or mismatched narcotic double-count values before submit', () => {
    const state = {
      selId: 'patient_1',
      model: {
        patient_1: [
          {
            gid: 'group_1',
            label: '朝食後',
            method: '一包化',
            start: '2026-06-17',
            days: 1,
            drugs: [
              {
                did: 'line_narcotic',
                name: 'モルヒネ徐放錠',
                yoho: '朝食後',
                a: '1',
                h: '',
                y: '',
                n: '',
                tag: '麻薬',
                funsai: false,
                note: '',
                dispensedQuantity: 12,
                isNarcotic: true,
              },
            ],
          },
        ],
      },
      audit: { line_narcotic: true },
      auditDoubleCountByDid: {
        line_narcotic: { first: '11', second: '' },
      },
    } as unknown as WorkbenchState;

    expect(collectDispenseAuditDoubleCountIssues(state)).toEqual([
      { line_id: 'line_narcotic', reason: 'first_count_mismatch' },
      { line_id: 'line_narcotic', reason: 'second_count_required' },
    ]);
  });
});

describe('collectCarryPacketEvidence', () => {
  it('builds non-PHI carry packet evidence for the current patient only', () => {
    const evidence = collectCarryPacketEvidence({
      selId: 'patient_1',
      model: {
        patient_1: [
          {
            gid: 'group_1',
            label: 'セット対象',
            method: '一包化',
            start: '2026-06-17',
            days: 1,
            drugs: [
              {
                did: 'line_prn',
                name: 'ロキソプロフェン錠60mg',
                yoho: '疼痛時',
                a: '',
                h: '',
                y: '',
                n: '',
                tag: '頓用',
                funsai: false,
                note: '',
              },
              {
                did: 'line_topical',
                name: '薬剤A',
                yoho: '1日1回',
                a: '',
                h: '',
                y: '',
                n: '',
                tag: '外用',
                funsai: false,
                note: '',
              },
              {
                did: 'line_liquid',
                name: '液剤A',
                yoho: '朝食後',
                a: '',
                h: '',
                y: '',
                n: '',
                tag: '',
                funsai: false,
                note: '内用液',
              },
            ],
          },
        ],
      },
      outChk: {
        'patient_1:ロキソプロフェン錠60mg': true,
        'patient_1:薬剤A': true,
        'patient_1:液剤A': true,
        'patient_2:薬剤A': true,
      },
      packet: {
        'patient_1:cal': true,
        'patient_1:ton': true,
        'patient_1:gai': true,
        'patient_1:liq': true,
        'patient_1:doc': true,
        'patient_1:note': true,
        'patient_2:cal': true,
      },
      writeContext: {
        taskId: null,
        cycleId: 'cycle_1',
        cycleVersion: 4,
        planId: 'plan_1',
        lineGroupByDid: {},
        groupIdByGid: {},
        cellMeta: {},
      },
    } as unknown as WorkbenchState);

    expect(evidence).toEqual({
      schema_version: 1,
      plan_id: 'plan_1',
      cycle_id: 'cycle_1',
      patient_id: 'patient_1',
      outside_meds: [
        { line_id: 'line_prn', kind: 'prn', checked: true },
        { line_id: 'line_topical', kind: 'topical', checked: true },
        { line_id: 'line_liquid', kind: 'liquid', checked: true },
      ],
      packet_items: [
        { key: 'cal', checked: true },
        { key: 'ton', checked: true },
        { key: 'gai', checked: true },
        { key: 'liq', checked: true },
        { key: 'doc', checked: true },
        { key: 'note', checked: true },
      ],
      summary: {
        outside_required_count: 3,
        outside_confirmed_count: 3,
        packet_required_count: 6,
        packet_confirmed_count: 6,
        all_checked: true,
      },
    });
    expect(JSON.stringify(evidence)).not.toContain('ロキソプロフェン');
    expect(JSON.stringify(evidence)).not.toContain('薬剤A');
  });

  it('records an explicit empty outside-med list when only the base packet is required', () => {
    const evidence = collectCarryPacketEvidence({
      selId: 'patient_1',
      model: {
        patient_1: [
          {
            gid: 'group_1',
            label: 'セット対象',
            method: '一包化',
            start: '2026-06-17',
            days: 1,
            drugs: [
              {
                did: 'line_regular',
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
      },
      outChk: {},
      packet: {
        'patient_1:cal': true,
        'patient_1:doc': true,
        'patient_1:note': true,
      },
      writeContext: {
        taskId: null,
        cycleId: 'cycle_1',
        cycleVersion: 4,
        planId: 'plan_1',
        lineGroupByDid: {},
        groupIdByGid: {},
        cellMeta: {},
      },
    } as unknown as WorkbenchState);

    expect(evidence?.outside_meds).toEqual([]);
    expect(evidence?.packet_items.map((item) => item.key)).toEqual(['cal', 'doc', 'note']);
    expect(evidence?.summary).toMatchObject({
      outside_required_count: 0,
      outside_confirmed_count: 0,
      packet_required_count: 3,
      packet_confirmed_count: 3,
      all_checked: true,
    });
  });

  it('does not build approval evidence while required packet items are unchecked', () => {
    const evidence = collectCarryPacketEvidence({
      selId: 'patient_1',
      model: { patient_1: [] },
      outChk: {},
      packet: { 'patient_1:cal': true },
      writeContext: {
        taskId: null,
        cycleId: 'cycle_1',
        cycleVersion: 4,
        planId: 'plan_1',
        lineGroupByDid: {},
        groupIdByGid: {},
        cellMeta: {},
      },
    } as unknown as WorkbenchState);

    expect(evidence).toBeNull();
  });
});

describe('collectSetAuditChecklistFromChecks', () => {
  it('maps the visible set-audit checklist order to the API checklist keys', () => {
    const prefix = 'patient_1:0:朝';
    const checks = Object.fromEntries(
      SET_AUDIT_CHECK_ITEMS.map((_, index) => [`${prefix}:${index}`, true]),
    );

    expect(collectSetAuditChecklistFromChecks(checks)).toEqual({
      date_match: true,
      timing_match: true,
      quantity_match: true,
      no_discontinued: true,
      residual_usage_ok: true,
      cold_storage_separated: true,
    });
  });

  it('does not mark unrelated or unchecked checklist items as complete', () => {
    const prefix = 'patient_1:0:朝';

    expect(
      collectSetAuditChecklistFromChecks({
        [`${prefix}:0`]: true,
        [`${prefix}:1`]: false,
        [`${prefix}:2`]: true,
        'patient_2:0:朝:3': true,
      }),
    ).toEqual({
      date_match: true,
      timing_match: false,
      quantity_match: true,
      no_discontinued: false,
      residual_usage_ok: false,
      cold_storage_separated: false,
    });
  });
});

describe('buildRejectedSetAuditInput', () => {
  it('does not build a rejected audit payload until an NG classification is selected', () => {
    expect(
      buildRejectedSetAuditInput(
        'plan_1',
        { batchIds: ['batch_1'], versions: [3], dayNumber: 1, slot: 'morning' },
        undefined,
      ),
    ).toBeNull();
  });

  it('includes both human-readable and structured NG reasons in rejected audit payloads', () => {
    expect(
      buildRejectedSetAuditInput(
        'plan_1',
        { batchIds: ['batch_1'], versions: [3], dayNumber: 1, slot: 'morning' },
        '数量不足',
      ),
    ).toEqual({
      plan_id: 'plan_1',
      result: 'rejected',
      reject_reason: '数量不足',
      reject_reason_code: 'quantity_short',
      cell_audits: [
        {
          batch_id: 'batch_1',
          audit_state: 'ng',
          ng_code: 'quantity_short',
          expected_version: 3,
        },
      ],
    });
  });
});
