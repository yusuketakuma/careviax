import { describe, expect, it } from 'vitest';
import {
  generatePackagingGroups,
  parseFrequencyToSlots,
} from '../packaging-group';

// ── parseFrequencyToSlots ──

describe('parseFrequencyToSlots', () => {
  it('"毎食後" → morning, noon, evening', () => {
    expect(parseFrequencyToSlots('毎食後')).toEqual(['morning', 'noon', 'evening']);
  });

  it('"1日3回" → morning, noon, evening', () => {
    expect(parseFrequencyToSlots('1日3回')).toEqual(['morning', 'noon', 'evening']);
  });

  it('"朝夕食後" → morning, evening', () => {
    expect(parseFrequencyToSlots('朝夕食後')).toEqual(['morning', 'evening']);
  });

  it('"1日1回朝食後" → morning', () => {
    expect(parseFrequencyToSlots('1日1回朝食後')).toEqual(['morning']);
  });

  it('"就寝前" → bedtime', () => {
    expect(parseFrequencyToSlots('就寝前')).toEqual(['bedtime']);
  });

  it('"頓服" → prn', () => {
    expect(parseFrequencyToSlots('頓服')).toEqual(['prn']);
  });

  it('empty string → []', () => {
    expect(parseFrequencyToSlots('')).toEqual([]);
  });

  it('"1日2回" → morning, evening', () => {
    expect(parseFrequencyToSlots('1日2回')).toEqual(['morning', 'evening']);
  });

  it('"朝食後" → morning only', () => {
    expect(parseFrequencyToSlots('朝食後')).toEqual(['morning']);
  });

  it('"眠前" → bedtime', () => {
    expect(parseFrequencyToSlots('眠前')).toEqual(['bedtime']);
  });

  it('"疼痛時" → prn', () => {
    expect(parseFrequencyToSlots('疼痛時')).toEqual(['prn']);
  });

  it('unknown frequency → []', () => {
    expect(parseFrequencyToSlots('特殊用法')).toEqual([]);
  });
});

// ── generatePackagingGroups ──

function makeLine(overrides: {
  id: string;
  drug_name: string;
  frequency: string;
  route?: string | null;
  packaging_instruction_tags?: string[];
}) {
  return {
    id: overrides.id,
    drug_name: overrides.drug_name,
    frequency: overrides.frequency,
    route: overrides.route ?? 'internal',
    packaging_instruction_tags: overrides.packaging_instruction_tags ?? [],
  };
}

describe('generatePackagingGroups', () => {
  it('single internal drug "朝食後" → group_morning, slot=morning', () => {
    const lines = [makeLine({ id: 'l1', drug_name: 'アムロジピン錠5mg', frequency: '朝食後' })];
    const result = generatePackagingGroups(lines);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      lineId: 'l1',
      groupId: 'group_morning',
      groupLabel: '朝食後',
      slot: 'morning',
      isCrushProhibited: false,
    });
  });

  it('single drug with "毎食後" → 3 assignments (morning, noon, evening)', () => {
    const lines = [makeLine({ id: 'l1', drug_name: '薬A', frequency: '毎食後' })];
    const result = generatePackagingGroups(lines);

    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({ lineId: 'l1', groupId: 'group_morning', slot: 'morning' });
    expect(result[1]).toMatchObject({ lineId: 'l1', groupId: 'group_noon', slot: 'noon' });
    expect(result[2]).toMatchObject({ lineId: 'l1', groupId: 'group_evening', slot: 'evening' });
  });

  it('multiple drugs with "毎食後" → 3 assignments each (6 total)', () => {
    const lines = [
      makeLine({ id: 'l1', drug_name: '薬A', frequency: '毎食後' }),
      makeLine({ id: 'l2', drug_name: '薬B', frequency: '毎食後' }),
    ];
    const result = generatePackagingGroups(lines);

    expect(result).toHaveLength(6);
    const l1Results = result.filter((r) => r.lineId === 'l1');
    const l2Results = result.filter((r) => r.lineId === 'l2');
    expect(l1Results.map((r) => r.slot)).toEqual(['morning', 'noon', 'evening']);
    expect(l2Results.map((r) => r.slot)).toEqual(['morning', 'noon', 'evening']);
  });

  it('external route drug → ungrouped, groupId=null', () => {
    const lines = [makeLine({ id: 'l1', drug_name: '外用薬', frequency: '1日1回', route: 'external' })];
    const result = generatePackagingGroups(lines);

    expect(result[0]).toMatchObject({
      lineId: 'l1',
      groupId: null,
      slot: null,
    });
  });

  it('injection route drug → ungrouped, groupId=null', () => {
    const lines = [makeLine({ id: 'l1', drug_name: '注射薬', frequency: '1日1回', route: 'injection' })];
    const result = generatePackagingGroups(lines);

    expect(result[0]).toMatchObject({
      lineId: 'l1',
      groupId: null,
      slot: null,
    });
  });

  it('PRN drug "頓服" → ungrouped, groupLabel="頓服"', () => {
    const lines = [makeLine({ id: 'l1', drug_name: 'ロキソプロフェン錠60mg', frequency: '頓服' })];
    const result = generatePackagingGroups(lines);

    expect(result[0]).toMatchObject({
      lineId: 'l1',
      groupId: null,
      groupLabel: '頓服',
      slot: null,
    });
  });

  it('unknown frequency → ungrouped', () => {
    const lines = [makeLine({ id: 'l1', drug_name: '薬X', frequency: '特殊用法' })];
    const result = generatePackagingGroups(lines);

    expect(result[0]).toMatchObject({
      lineId: 'l1',
      groupId: null,
      slot: null,
    });
  });

  it('crush_prohibited tag detection → isCrushProhibited=true', () => {
    const lines = [
      makeLine({
        id: 'l1',
        drug_name: '腸溶錠',
        frequency: '朝食後',
        packaging_instruction_tags: ['crush_prohibited'],
      }),
    ];
    const result = generatePackagingGroups(lines);

    expect(result[0].isCrushProhibited).toBe(true);
  });

  it('mixed: internal + external + PRN → correct grouping', () => {
    const lines = [
      makeLine({ id: 'l1', drug_name: '内服薬', frequency: '朝食後', route: 'internal' }),
      makeLine({ id: 'l2', drug_name: '外用薬', frequency: '1日2回', route: 'external' }),
      makeLine({ id: 'l3', drug_name: '頓服薬', frequency: '頓服', route: 'internal' }),
    ];
    const result = generatePackagingGroups(lines);

    expect(result).toHaveLength(3);

    const internal = result.find((r) => r.lineId === 'l1');
    expect(internal).toMatchObject({ groupId: 'group_morning', slot: 'morning' });

    const external = result.find((r) => r.lineId === 'l2');
    expect(external).toMatchObject({ groupId: null, slot: null });

    const prn = result.find((r) => r.lineId === 'l3');
    expect(prn).toMatchObject({ groupId: null, groupLabel: '頓服', slot: null });
  });

  it('empty lines → empty result', () => {
    const result = generatePackagingGroups([]);
    expect(result).toHaveLength(0);
  });

  it('"朝夕食後" → 2 assignments (morning, evening)', () => {
    const lines = [makeLine({ id: 'l1', drug_name: '薬A', frequency: '朝夕食後' })];
    const result = generatePackagingGroups(lines);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ lineId: 'l1', groupId: 'group_morning', slot: 'morning' });
    expect(result[1]).toMatchObject({ lineId: 'l1', groupId: 'group_evening', slot: 'evening' });
  });

  it('null route treated as internal → grouped by frequency', () => {
    const lines = [makeLine({ id: 'l1', drug_name: '薬A', frequency: '朝食後', route: null })];
    const result = generatePackagingGroups(lines);

    expect(result[0]).toMatchObject({
      groupId: 'group_morning',
      slot: 'morning',
    });
  });

  it('no crush_prohibited tag → isCrushProhibited=false', () => {
    const lines = [
      makeLine({
        id: 'l1',
        drug_name: '通常錠',
        frequency: '朝食後',
        packaging_instruction_tags: ['special_storage'],
      }),
    ];
    const result = generatePackagingGroups(lines);

    expect(result[0].isCrushProhibited).toBe(false);
  });
});
