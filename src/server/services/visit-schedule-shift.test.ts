import { describe, expect, it } from 'vitest';
import {
  timeStringToMinutes,
  validateScheduleTimeDatesFitShift,
  validateScheduleTimeStringsFitShift,
} from './visit-schedule-shift';

describe('visit-schedule-shift', () => {
  it('validates schedule strings against a pharmacist shift window', () => {
    expect(timeStringToMinutes('09:30')).toBe(570);
    expect(
      validateScheduleTimeStringsFitShift(
        {
          site_id: 'site_1',
          available: true,
          available_from: new Date('1970-01-01T09:00:00'),
          available_to: new Date('1970-01-01T18:00:00'),
        },
        '09:30',
        '10:30',
      ),
    ).toBeNull();
    expect(
      validateScheduleTimeStringsFitShift(
        {
          site_id: 'site_1',
          available: true,
          available_from: new Date('1970-01-01T09:00:00'),
          available_to: new Date('1970-01-01T18:00:00'),
        },
        '08:30',
        '09:30',
      ),
    ).toBe('訪問開始時刻が薬剤師シフトの開始前です');
  });

  it('keeps local time semantics for Prisma time Date values', () => {
    expect(
      validateScheduleTimeDatesFitShift(
        {
          site_id: 'site_1',
          available: true,
          available_from: new Date('1970-01-01T09:00:00'),
          available_to: new Date('1970-01-01T18:00:00'),
        },
        new Date('1970-01-01T10:00:00'),
        new Date('1970-01-01T11:00:00'),
      ),
    ).toBeNull();
  });

  it('rejects unavailable shifts before checking time windows', () => {
    expect(
      validateScheduleTimeStringsFitShift(
        {
          site_id: 'site_1',
          available: false,
          available_from: null,
          available_to: null,
        },
        undefined,
        undefined,
      ),
    ).toBe('選択した薬剤師は指定日のシフトが休みです');
  });
});
