/**
 * p0_24 施設モード・訪問パケットの表示モデル(純関数)。
 * visit-preparations の facility_parallel_context を
 * 部屋カード列(状態ラベル付き)とパケット箇条書きへ変換する。
 *
 * 施設訪問パケットの申し送りメモは FacilityVisitBatch.notes(自由文)に保存する。
 * スキーマ凍結のため専用カラムは追加できないので、構造化メモは下記の
 * 明示的な JSON 形(__type: 'facility_packet_memo')を notes に直列化して保存し、
 * 表示・編集時にパースして 5 項目(入館 / 駐車 / ナースステーション / カート / 申し送り)へ復元する。
 * 旧データ(構造化前の自由文)は legacy 行として読み戻せるよう後方互換で扱う。
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

/* ------------------------------------------------------------------ */
/* 構造化メモ(入館 / 駐車 / ナースステーション / カート / 申し送り)        */
/* ------------------------------------------------------------------ */

/** notes に直列化した構造化メモを識別するためのマーカー。 */
const FACILITY_PACKET_MEMO_TYPE = 'facility_packet_memo' as const;

/** 構造化メモの 5 項目。すべて任意入力(未入力は空文字)。 */
export type FacilityPacketMemo = {
  /** 入館方法 */
  entry: string;
  /** 駐車場 */
  parking: string;
  /** ナースステーション */
  nurse_station: string;
  /** 服薬カート */
  cart: string;
  /** 申し送り */
  handoff: string;
};

type SerializedFacilityPacketMemo = FacilityPacketMemo & {
  __type: typeof FACILITY_PACKET_MEMO_TYPE;
};

/** 表示用の項目定義(ラベルと並び順の SSOT)。 */
export const FACILITY_PACKET_MEMO_FIELDS: ReadonlyArray<{
  key: keyof FacilityPacketMemo;
  label: string;
}> = [
  { key: 'entry', label: '入館方法' },
  { key: 'parking', label: '駐車場' },
  { key: 'nurse_station', label: 'ナースステーション' },
  { key: 'cart', label: '服薬カート' },
  { key: 'handoff', label: '申し送り' },
];

export function emptyFacilityPacketMemo(): FacilityPacketMemo {
  return { entry: '', parking: '', nurse_station: '', cart: '', handoff: '' };
}

function asTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * notes(自由文 or 構造化 JSON)を 5 項目の構造化メモへ復元する。
 * - 構造化 JSON(__type マーカー付き)なら各項目へマップ。
 * - 旧データ(自由文「ラベル：値」)は先頭ラベル一致で各項目へ振り分け、
 *   一致しない行は申し送り欄へ集約する(情報を失わないため)。
 */
export function parseFacilityPacketMemo(notes: string | null | undefined): FacilityPacketMemo {
  const memo = emptyFacilityPacketMemo();
  if (!notes) return memo;

  const trimmed = notes.trim();
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as Partial<SerializedFacilityPacketMemo>;
      if (parsed && parsed.__type === FACILITY_PACKET_MEMO_TYPE) {
        return {
          entry: asTrimmedString(parsed.entry),
          parking: asTrimmedString(parsed.parking),
          nurse_station: asTrimmedString(parsed.nurse_station),
          cart: asTrimmedString(parsed.cart),
          handoff: asTrimmedString(parsed.handoff),
        };
      }
    } catch {
      // JSON でなければ自由文として後段で処理する
    }
  }

  // 後方互換: 旧自由文を「ラベル：値」で振り分ける。
  const labelToKey = new Map<string, keyof FacilityPacketMemo>(
    FACILITY_PACKET_MEMO_FIELDS.map((field) => [field.label, field.key]),
  );
  const leftovers: string[] = [];
  for (const line of splitFacilityPacketNotes(trimmed)) {
    const separatorIndex = line.search(/[：:]/);
    if (separatorIndex > 0) {
      const label = line.slice(0, separatorIndex).trim();
      const value = line.slice(separatorIndex + 1).trim();
      const key = labelToKey.get(label);
      if (key) {
        memo[key] = memo[key] ? `${memo[key]}\n${value}` : value;
        continue;
      }
    }
    leftovers.push(line);
  }
  if (leftovers.length > 0) {
    const joined = leftovers.join('\n');
    memo.handoff = memo.handoff ? `${memo.handoff}\n${joined}` : joined;
  }
  return memo;
}

/** 構造化メモが全項目空かどうか。 */
export function isFacilityPacketMemoEmpty(memo: FacilityPacketMemo): boolean {
  return FACILITY_PACKET_MEMO_FIELDS.every((field) => memo[field.key].trim().length === 0);
}

/**
 * 構造化メモを notes へ保存する文字列に直列化する。
 * 全項目空なら null(notes クリア)を返す。
 */
export function serializeFacilityPacketMemo(memo: FacilityPacketMemo): string | null {
  const normalized: FacilityPacketMemo = {
    entry: memo.entry.trim(),
    parking: memo.parking.trim(),
    nurse_station: memo.nurse_station.trim(),
    cart: memo.cart.trim(),
    handoff: memo.handoff.trim(),
  };
  if (isFacilityPacketMemoEmpty(normalized)) return null;
  const serialized: SerializedFacilityPacketMemo = {
    __type: FACILITY_PACKET_MEMO_TYPE,
    ...normalized,
  };
  return JSON.stringify(serialized);
}

/** 表示用: 入力済み項目のみ {ラベル, 値} の配列へ。 */
export function facilityPacketMemoDisplayItems(
  memo: FacilityPacketMemo,
): Array<{ key: keyof FacilityPacketMemo; label: string; value: string }> {
  return FACILITY_PACKET_MEMO_FIELDS.filter((field) => memo[field.key].trim().length > 0).map(
    (field) => ({ key: field.key, label: field.label, value: memo[field.key].trim() }),
  );
}

/**
 * notes を「人が読める」テキストへ正規化する(構造化 facility-packet メモを
 * 別画面に表示する際に、生の JSON 文字列がそのまま出ないようにするためのプロジェクション)。
 * - 構造化 JSON メモ → 「ラベル：値」の複数行へ。
 * - 旧自由文 → そのまま返す(表示の後方互換)。
 */
export function facilityPacketMemoToDisplayText(notes: string | null | undefined): string | null {
  if (!notes) return null;
  if (notes.trim().startsWith('{')) {
    const items = facilityPacketMemoDisplayItems(parseFacilityPacketMemo(notes));
    return items.length > 0 ? items.map((item) => `${item.label}：${item.value}`).join('\n') : null;
  }
  return notes;
}
