import { describe, expect, it } from 'vitest';

import { SET_AUDIT_CHECK_ITEMS } from './dispensing-workbench.write-types';
import type { WorkbenchState } from './dispensing-workbench.store';
import {
  buildRejectedSetAuditInput,
  collectCarryPacketEvidence,
  collectSetAuditChecklistFromChecks,
} from './use-workbench-write-handlers';

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
