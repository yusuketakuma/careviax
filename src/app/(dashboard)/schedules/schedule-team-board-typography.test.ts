import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SUB_TWELVE_PIXEL_CLASS = /text-\[(?:[0-9]|1[01])px\]/g;

describe('schedule team board typography contract', () => {
  it('keeps timeline, safety, vehicle, and inbound labels at 12px or larger', () => {
    const source = readFileSync('src/app/(dashboard)/schedules/schedule-team-board.tsx', 'utf8');

    expect(source.match(SUB_TWELVE_PIXEL_CLASS)).toBeNull();
  });
});
