/**
 * p0_24 施設モード・訪問パケットの表示モデル(純関数)。
 * visit-preparations の facility_parallel_context を
 * 部屋カード列(状態ラベル付き)とパケット箇条書きへ変換する。
 */

export type FacilityPacketPatient = {
  schedule_id: string;
  patient_name: string;
  unit_name: string | null;
  route_order: number | null;
  schedule_status: string;
  preparation_blockers_count: number;
  visit_record_id: string | null;
};

const STATUS_LABELS: Record<string, string> = {
  completed: '完了',
  in_progress: '訪問中',
  departed: '訪問中',
  ready: '出発準備OK',
};

/** 工程の近似状態: 記録済み=報告待ち、それ以外は schedule_status から。 */
export function facilityPacketStatusLabel(patient: FacilityPacketPatient): string {
  if (patient.schedule_status === 'completed') return STATUS_LABELS.completed;
  if (patient.visit_record_id) return '報告待ち';
  return STATUS_LABELS[patient.schedule_status] ?? '訪問準備';
}

/** 巡回順(route_order)→ 部屋番号 → 名前 の順で並べる。 */
export function sortFacilityPacketPatients(
  patients: FacilityPacketPatient[],
): FacilityPacketPatient[] {
  return [...patients].sort((left, right) => {
    const leftOrder = left.route_order ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = right.route_order ?? Number.MAX_SAFE_INTEGER;
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    const unitCompare = (left.unit_name ?? '').localeCompare(right.unit_name ?? '', 'ja');
    if (unitCompare !== 0) return unitCompare;
    return left.patient_name.localeCompare(right.patient_name, 'ja');
  });
}

/** 施設メモ(自由文)を箇条書き項目へ(改行・読点区切りはそのまま、空行除去)。 */
export function splitFacilityPacketNotes(notes: string | null | undefined): string[] {
  if (!notes) return [];
  return notes
    .split(/\r?\n/)
    .map((line) => line.replace(/^[・\-\s]+/, '').trim())
    .filter((line) => line.length > 0);
}
