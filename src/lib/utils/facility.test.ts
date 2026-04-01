import { describe, expect, it } from 'vitest';
import { deriveFacilityLabel } from './facility';

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
});
