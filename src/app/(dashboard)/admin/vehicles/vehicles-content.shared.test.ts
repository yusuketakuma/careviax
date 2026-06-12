import { describe, expect, it } from 'vitest';
import {
  buildVehicleSavePayload,
  EMPTY_VEHICLE_FORM,
  MASTER_CATEGORY_LINKS,
  toVehicleFormState,
  TRAVEL_MODE_LABELS,
  vehicleAvailabilityLabel,
  type VehicleResource,
} from './vehicles-content.shared';

const vehicle: VehicleResource = {
  id: 'vehicle_1',
  site_id: 'site_1',
  label: '軽バン1号',
  vehicle_code: 'VEH-DEMO-001',
  travel_mode: 'DRIVE',
  max_stops: 8,
  max_route_duration_minutes: null,
  available: true,
  notes: '点検期限 6/21',
  site: { id: 'site_1', name: '本店' },
};

describe('toVehicleFormState', () => {
  it('projects a vehicle model into the edit form state', () => {
    expect(toVehicleFormState(vehicle)).toEqual({
      label: '軽バン1号',
      vehicleCode: 'VEH-DEMO-001',
      travelMode: 'DRIVE',
      notes: '点検期限 6/21',
      availability: 'active',
      maxStops: '8',
    });
  });

  it('normalizes nullable fields and unavailable state', () => {
    expect(
      toVehicleFormState({
        ...vehicle,
        vehicle_code: null,
        notes: null,
        available: false,
        max_stops: 4,
      }),
    ).toEqual({
      label: '軽バン1号',
      vehicleCode: '',
      travelMode: 'DRIVE',
      notes: '',
      availability: 'inactive',
      maxStops: '4',
    });
  });

  it('returns the empty form for null', () => {
    expect(toVehicleFormState(null)).toEqual(EMPTY_VEHICLE_FORM);
  });
});

describe('buildVehicleSavePayload', () => {
  it('builds a trimmed PATCH payload from the form state', () => {
    const result = buildVehicleSavePayload({
      label: ' 軽バン1号 ',
      vehicleCode: ' VEH-DEMO-001 ',
      travelMode: 'BICYCLE',
      notes: ' 雨天時は利用不可 ',
      availability: 'inactive',
      maxStops: '4',
    });

    expect(result).toEqual({
      ok: true,
      payload: {
        label: '軽バン1号',
        vehicle_code: 'VEH-DEMO-001',
        travel_mode: 'BICYCLE',
        notes: '雨天時は利用不可',
        available: false,
        max_stops: 4,
      },
    });
  });

  it('keeps cleared optional fields as empty strings for server-side null normalization', () => {
    const result = buildVehicleSavePayload({
      ...EMPTY_VEHICLE_FORM,
      label: '軽バン2号',
    });

    expect(result).toEqual({
      ok: true,
      payload: {
        label: '軽バン2号',
        vehicle_code: '',
        travel_mode: 'DRIVE',
        notes: '',
        available: true,
        max_stops: 8,
      },
    });
  });

  it('rejects a blank label', () => {
    const result = buildVehicleSavePayload({ ...EMPTY_VEHICLE_FORM, label: '  ' });
    expect(result).toEqual({ ok: false, message: '名称を入力してください' });
  });

  it.each(['0', '51', '1.5', 'abc', ''])('rejects invalid max stops %s', (maxStops) => {
    const result = buildVehicleSavePayload({
      ...EMPTY_VEHICLE_FORM,
      label: '軽バン1号',
      maxStops,
    });
    expect(result).toEqual({
      ok: false,
      message: '最大訪問件数は1〜50の整数で入力してください',
    });
  });
});

describe('vehicleAvailabilityLabel', () => {
  it('labels availability states', () => {
    expect(vehicleAvailabilityLabel(true)).toBe('有効');
    expect(vehicleAvailabilityLabel(false)).toBe('停止中');
  });
});

describe('MASTER_CATEGORY_LINKS', () => {
  it('covers the 7 target categories in order', () => {
    expect(MASTER_CATEGORY_LINKS.map((category) => category.label)).toEqual([
      '薬剤',
      '医療機関',
      '施設',
      'スタッフ',
      '車両',
      'タグ',
      '帳票',
    ]);
  });

  it('marks only the vehicles category as current', () => {
    const current = MASTER_CATEGORY_LINKS.filter((category) => category.current);
    expect(current).toHaveLength(1);
    expect(current[0]).toMatchObject({ key: 'vehicles', href: '/admin/vehicles' });
  });

  it('keeps only the tags category as preparing', () => {
    const preparing = MASTER_CATEGORY_LINKS.filter((category) => category.href === null);
    expect(preparing.map((category) => category.key)).toEqual(['tags']);
  });
});

describe('TRAVEL_MODE_LABELS', () => {
  it('labels all travel modes in Japanese', () => {
    expect(TRAVEL_MODE_LABELS).toEqual({
      DRIVE: '自動車',
      BICYCLE: '自転車',
      WALK: '徒歩',
      TWO_WHEELER: 'バイク・原付',
    });
  });
});
