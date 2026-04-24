import { describe, expect, it } from 'vitest';
import { deriveFacilityLabel, deriveVisitPlaceGroup } from './facility';

describe('deriveFacilityLabel', () => {
  it('prefers building ids when present', () => {
    expect(
      deriveFacilityLabel({
        building_id: 'facility_alpha',
        address: '東京都千代田区1-1-1',
      })
    ).toBe('facility_alpha');
  });

  it('falls back to address when no building id exists', () => {
    expect(
      deriveFacilityLabel({
        building_id: null,
        address: '東京都墨田区2-2-2',
      })
    ).toBe('東京都墨田区2-2-2');
  });

  it('returns null when residence data is missing', () => {
    expect(deriveFacilityLabel(null)).toBeNull();
  });

  it('builds facility groups while keeping unit details out of the grouping key', () => {
    expect(
      deriveVisitPlaceGroup({
        facility_id: 'facility_1',
        facility_unit_id: 'unit_2',
        building_id: '青空ホーム',
        address: '東京都千代田区1-1-1',
        unit_name: '2F 東',
      }),
    ).toEqual({
      key: 'facility:facility_1',
      label: '青空ホーム',
      kind: 'facility',
    });
  });

  it('groups different units in the same facility together', () => {
    const eastUnit = deriveVisitPlaceGroup({
      facility_id: 'facility_1',
      facility_unit_id: 'unit_east',
      building_id: '青空ホーム',
      unit_name: '2F 東',
    });
    const westUnit = deriveVisitPlaceGroup({
      facility_id: 'facility_1',
      facility_unit_id: 'unit_west',
      building_id: '青空ホーム',
      unit_name: '3F 西',
    });

    expect(eastUnit?.key).toBe(westUnit?.key);
  });

  it('builds individual-home co-resident groups from building ids', () => {
    expect(
      deriveVisitPlaceGroup({
        building_id: '山田家',
        address: '東京都港区1-1-1',
        unit_name: '1F',
      }),
    ).toEqual({
      key: 'home_group:山田家',
      label: '山田家',
      kind: 'home_group',
    });
  });
});
