import { describe, expect, it } from 'vitest';
import {
  BUSINESS_HOLIDAYS_API_PATH,
  buildBusinessHolidayApiPath,
  buildBusinessHolidaysApiPath,
} from './api-paths';

describe('business holiday API path helpers', () => {
  it('builds the collection API path', () => {
    expect(BUSINESS_HOLIDAYS_API_PATH).toBe('/api/business-holidays');
    expect(buildBusinessHolidaysApiPath()).toBe('/api/business-holidays');
  });

  it('preserves the existing list query path shape for provided empty params', () => {
    expect(buildBusinessHolidaysApiPath(new URLSearchParams())).toBe('/api/business-holidays?');
  });

  it('builds list query paths with encoded search params', () => {
    const params = new URLSearchParams({
      date_from: '2026-01-01',
      date_to: '2026-02-01',
      site_id: 'site/1?mode=x#frag',
    });

    expect(buildBusinessHolidaysApiPath(params)).toBe(
      `/api/business-holidays?${params.toString()}`,
    );
  });

  it('builds detail API paths for normal ids', () => {
    expect(buildBusinessHolidayApiPath('holiday_1')).toBe('/api/business-holidays/holiday_1');
  });

  it('encodes only the holiday id path segment', () => {
    const holidayId = 'holiday/1?mode=x#frag';

    expect(buildBusinessHolidayApiPath(holidayId)).toBe(
      `/api/business-holidays/${encodeURIComponent(holidayId)}`,
    );
  });

  it.each(['.', '..'])('rejects exact dot-segment holiday id %s', (holidayId) => {
    expect(() => buildBusinessHolidayApiPath(holidayId)).toThrow(RangeError);
  });
});
