import { describe, expect, it } from 'vitest';
import {
  buildSetAuditHydrationState,
  buildSetAuditSubmission,
  groupBatchesByDayAndSlot,
} from './set-audit-content.helpers';

describe('groupBatchesByDayAndSlot', () => {
  it('sorts days ascending and slots in workflow order', () => {
    const result = groupBatchesByDayAndSlot([
      { id: 'batch_3', day_number: 2, slot: 'evening' },
      { id: 'batch_1', day_number: 1, slot: 'bedtime' },
      { id: 'batch_2', day_number: 1, slot: 'morning' },
      { id: 'batch_4', day_number: 2, slot: 'prn' },
    ]);

    expect(result).toEqual([
      {
        dayNumber: 1,
        slots: [
          {
            slot: 'morning',
            slotLabel: '朝食後',
            batches: [{ id: 'batch_2', day_number: 1, slot: 'morning' }],
          },
          {
            slot: 'bedtime',
            slotLabel: '眠前',
            batches: [{ id: 'batch_1', day_number: 1, slot: 'bedtime' }],
          },
        ],
      },
      {
        dayNumber: 2,
        slots: [
          {
            slot: 'evening',
            slotLabel: '夕食後',
            batches: [{ id: 'batch_3', day_number: 2, slot: 'evening' }],
          },
          {
            slot: 'prn',
            slotLabel: '頓用',
            batches: [{ id: 'batch_4', day_number: 2, slot: 'prn' }],
          },
        ],
      },
    ]);
  });
});

describe('buildSetAuditSubmission', () => {
  it('returns pending while unreviewed slots remain', () => {
    const result = buildSetAuditSubmission({
      allSlotKeys: ['1-morning', '1-noon'],
      localApproval: new Map([['1-morning', true]]),
      rejectReasonsByDay: new Map(),
    });

    expect(result).toEqual({
      kind: 'pending',
      message: '未鑑査のスロットがあります',
    });
  });

  it('builds an approved payload when every slot is approved', () => {
    const result = buildSetAuditSubmission({
      allSlotKeys: ['1-morning', '1-noon'],
      localApproval: new Map([
        ['1-morning', true],
        ['1-noon', true],
      ]),
      rejectReasonsByDay: new Map(),
    });

    expect(result).toEqual({
      kind: 'ready',
      payload: {
        result: 'approved',
        approved_scope: {
          '1-morning': true,
          '1-noon': true,
        },
      },
    });
  });

  it('builds a partial approval payload with approved scope and reject reason', () => {
    const result = buildSetAuditSubmission({
      allSlotKeys: ['1-morning', '1-noon', '2-evening'],
      localApproval: new Map([
        ['1-morning', true],
        ['1-noon', false],
        ['2-evening', true],
      ]),
      rejectReasonsByDay: new Map([[1, '数量誤り']]),
    });

    expect(result).toEqual({
      kind: 'ready',
      payload: {
        result: 'partial_approved',
        approved_scope: {
          '1-morning': true,
          '2-evening': true,
        },
        reject_reason: '数量誤り',
      },
    });
  });

  it('builds a rejected payload and falls back to the default reason', () => {
    const result = buildSetAuditSubmission({
      allSlotKeys: ['1-morning', '2-evening'],
      localApproval: new Map([
        ['1-morning', false],
        ['2-evening', false],
      ]),
      rejectReasonsByDay: new Map(),
    });

    expect(result).toEqual({
      kind: 'ready',
      payload: {
        result: 'rejected',
        reject_reason: '差戻し理由未記入',
      },
    });
  });
});

describe('buildSetAuditHydrationState', () => {
  it('hydrates a saved partial approval into slot approval state', () => {
    const result = buildSetAuditHydrationState({
      allSlotKeys: ['1-morning', '1-noon', '2-evening'],
      latestAudit: {
        result: 'partial_approved',
        approved_scope: {
          '1-morning': true,
          '2-evening': true,
        },
        reject_reason: '数量誤り',
      },
    });

    expect(result.localApproval).toEqual(
      new Map([
        ['1-morning', true],
        ['1-noon', false],
        ['2-evening', true],
      ]),
    );
    expect(result.rejectReasonsByDay).toEqual(new Map([[1, '数量誤り']]));
  });

  it('avoids hydrating rejected slots when the current batches may have changed', () => {
    const result = buildSetAuditHydrationState({
      allSlotKeys: ['1-morning', '1-noon'],
      latestAudit: {
        result: 'partial_approved',
        approved_scope: {
          '1-morning': true,
        },
        reject_reason: '数量誤り',
      },
      allowHydration: false,
    });

    expect(result.localApproval).toEqual(new Map());
    expect(result.rejectReasonsByDay).toEqual(new Map());
  });

  it('avoids hydrating fully approved slots when the current batches may have changed', () => {
    const result = buildSetAuditHydrationState({
      allSlotKeys: ['1-morning', '1-noon'],
      latestAudit: {
        result: 'approved',
        approved_scope: null,
        reject_reason: null,
      },
      allowHydration: false,
    });

    expect(result.localApproval).toEqual(new Map());
    expect(result.rejectReasonsByDay).toEqual(new Map());
  });
});
