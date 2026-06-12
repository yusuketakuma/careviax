/**
 * P0-43 車両マスターの表示射影・フォーム⇔モデル変換(純関数)。
 * UI コンポーネント(vehicles-content.tsx)から分離して vitest で検証する。
 */

export type VehicleTravelMode = 'DRIVE' | 'BICYCLE' | 'WALK' | 'TWO_WHEELER';

/** GET /api/visit-vehicle-resources の一覧 1 件分の射影。 */
export type VehicleResource = {
  id: string;
  site_id: string;
  label: string;
  vehicle_code: string | null;
  travel_mode: VehicleTravelMode;
  max_stops: number;
  max_route_duration_minutes: number | null;
  available: boolean;
  notes: string | null;
  site?: { id: string; name: string } | null;
};

/** 右カラム「詳細を編集」のフォーム状態(入力中は全て文字列で保持)。 */
export type VehicleFormState = {
  label: string;
  vehicleCode: string;
  travelMode: VehicleTravelMode;
  notes: string;
  availability: 'active' | 'inactive';
  maxStops: string;
};

export const TRAVEL_MODE_LABELS: Record<VehicleTravelMode, string> = {
  DRIVE: '自動車',
  BICYCLE: '自転車',
  WALK: '徒歩',
  TWO_WHEELER: 'バイク・原付',
};

/** 一覧右端の稼働状態ラベル(有効=緑 / 停止中=橙)。 */
export function vehicleAvailabilityLabel(available: boolean): string {
  return available ? '有効' : '停止中';
}

export const EMPTY_VEHICLE_FORM: VehicleFormState = {
  label: '',
  vehicleCode: '',
  travelMode: 'DRIVE',
  notes: '',
  availability: 'active',
  maxStops: '8',
};

/** モデル → フォーム。未選択(null)は空フォームを返す。 */
export function toVehicleFormState(vehicle: VehicleResource | null): VehicleFormState {
  if (!vehicle) return { ...EMPTY_VEHICLE_FORM };
  return {
    label: vehicle.label,
    vehicleCode: vehicle.vehicle_code ?? '',
    travelMode: vehicle.travel_mode,
    notes: vehicle.notes ?? '',
    availability: vehicle.available ? 'active' : 'inactive',
    maxStops: String(vehicle.max_stops),
  };
}

export type VehicleSavePayload = {
  label: string;
  vehicle_code: string;
  travel_mode: VehicleTravelMode;
  notes: string;
  available: boolean;
  max_stops: number;
};

export type VehicleSaveResult =
  | { ok: true; payload: VehicleSavePayload }
  | { ok: false; message: string };

/**
 * フォーム → PATCH ペイロード。
 * 空文字の vehicle_code / notes はサーバー側スキーマが null に正規化する。
 */
export function buildVehicleSavePayload(form: VehicleFormState): VehicleSaveResult {
  const label = form.label.trim();
  if (!label) {
    return { ok: false, message: '名称を入力してください' };
  }

  const maxStops = Number(form.maxStops);
  if (!Number.isInteger(maxStops) || maxStops < 1 || maxStops > 50) {
    return { ok: false, message: '最大訪問件数は1〜50の整数で入力してください' };
  }

  return {
    ok: true,
    payload: {
      label,
      vehicle_code: form.vehicleCode.trim(),
      travel_mode: form.travelMode,
      notes: form.notes.trim(),
      available: form.availability === 'active',
      max_stops: maxStops,
    },
  };
}

/** 左カラム「カテゴリ」の 1 区分。href が null のものは準備中(リンクなし)。 */
export type MasterCategoryLink = {
  key: string;
  label: string;
  href: string | null;
  current: boolean;
};

/**
 * target(p0_43)の 7 区分を実在マスターページへ対応付ける。
 * タグは対応する管理画面が未実装のため準備中とする。
 */
export const MASTER_CATEGORY_LINKS: readonly MasterCategoryLink[] = [
  { key: 'drugs', label: '薬剤', href: '/admin/drug-masters', current: false },
  { key: 'institutions', label: '医療機関', href: '/admin/institutions', current: false },
  { key: 'facilities', label: '施設', href: '/admin/facilities', current: false },
  { key: 'staff', label: 'スタッフ', href: '/admin/staff', current: false },
  { key: 'vehicles', label: '車両', href: '/admin/vehicles', current: true },
  { key: 'tags', label: 'タグ', href: null, current: false },
  { key: 'documents', label: '帳票', href: '/admin/document-templates', current: false },
] as const;
