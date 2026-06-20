import { describe, expect, it } from 'vitest';
import {
  facilityPacketStatusLabel,
  sortFacilityPacketPatients,
  splitFacilityPacketNotes,
  type FacilityPacketPatient,
} from './facility-packet';

function buildPatient(overrides: Partial<FacilityPacketPatient> = {}): FacilityPacketPatient {
  return {
    schedule_id: 'sched_1',
    patient_name: '小川 タケ',
    unit_name: '101',
    route_order: 1,
    schedule_status: 'planned',
    preparation_blockers_count: 0,
    visit_record_id: null,
    ...overrides,
  };
}

describe('facilityPacketStatusLabel', () => {
  it('maps schedule progress to room-card labels', () => {
    expect(facilityPacketStatusLabel(buildPatient())).toBe('訪問準備');
    expect(facilityPacketStatusLabel(buildPatient({ schedule_status: 'ready' }))).toBe(
      '出発準備OK',
    );
    expect(facilityPacketStatusLabel(buildPatient({ schedule_status: 'in_progress' }))).toBe(
      '訪問中',
    );
    expect(facilityPacketStatusLabel(buildPatient({ schedule_status: 'completed' }))).toBe('完了');
  });

  it('labels recorded visits as waiting for the report', () => {
    expect(facilityPacketStatusLabel(buildPatient({ visit_record_id: 'rec_1' }))).toBe('報告待ち');
    expect(
      facilityPacketStatusLabel(
        buildPatient({ visit_record_id: 'rec_1', schedule_status: 'completed' }),
      ),
    ).toBe('完了');
  });
});

describe('sortFacilityPacketPatients', () => {
  it('orders by route order, then unit, then name', () => {
    const sorted = sortFacilityPacketPatients([
      buildPatient({ schedule_id: 'c', route_order: null, unit_name: '301' }),
      buildPatient({ schedule_id: 'b', route_order: 2, unit_name: '202' }),
      buildPatient({ schedule_id: 'a', route_order: 1, unit_name: '101' }),
    ]);

    expect(sorted.map((patient) => patient.schedule_id)).toEqual(['a', 'b', 'c']);
  });
});

describe('splitFacilityPacketNotes', () => {
  it('splits lines and strips leading bullets', () => {
    expect(
      splitFacilityPacketNotes(
        '・入館方法:受付で名簿記入\n駐車場:建物裏2台分\n\n- 申し送り:夕食後薬の声かけ',
      ),
    ).toEqual(['入館方法:受付で名簿記入', '駐車場:建物裏2台分', '申し送り:夕食後薬の声かけ']);
  });

  it('returns an empty list for missing notes', () => {
    expect(splitFacilityPacketNotes(null)).toEqual([]);
    expect(splitFacilityPacketNotes('  ')).toEqual([]);
  });
});
