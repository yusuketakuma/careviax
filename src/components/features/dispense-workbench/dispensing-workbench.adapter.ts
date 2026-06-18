/**
 * 調剤ワークベンチ データ取得境界（計画 §4 / §11-6 / §14）
 *
 * **既定はモック（USE_MOCK=true）で現行 UI を一切変えない。** 実データパスはゲートの裏に
 * 追加し、フラグで opt-in する。コンポーネントはこのアダプタのみを呼ぶ（seed/logic を直接
 * import しない設計上の単一境界）。
 *
 * - 同期 loadPatients/loadWorkbench/loadCalendar: 従来どおり seed を返す（view が module-load
 *   時に loadPatients() を呼ぶ初期化経路を壊さないため温存）。
 * - 非同期 loadPatientsAsync/loadWorkbenchAsync: USE_MOCK=false 時のみ実 API を fetch し、
 *   from-api で公開型へ写像して返す。fetch 失敗 / 未認証 / 該当無しは空状態 / null を返し、
 *   実データ画面で seed/mock 患者を操作可能にしない。
 *
 * 段階1b スコープは dispense / audit の読取のみ。set / seta（カレンダー）はモック継続。
 */

import { buildPatients } from './dispensing-workbench.seed';
import { buildModel, calc } from './dispensing-workbench.logic';
import {
  patientsFromApi,
  workbenchFromApi,
  writeContextFromApi,
  cellMetaFromCalendar,
  calendarWorkbenchStateFromApi,
} from './dispensing-workbench.from-api';
import type {
  CalcResult,
  Group,
  Phase,
  SeedPatient,
  WorkbenchModel,
} from './dispensing-workbench.types';
import type {
  DispenseWorkbenchData,
  DispenseWorkbenchPatientsResponse,
} from '@/lib/dispensing/dispense-workbench-shared';
import {
  WorkbenchConflictError,
  WorkbenchWriteError,
  MOCK_WRITE_NOOP,
  type MockWriteNoop,
  type CalendarMatrixResponse,
  type SetBatchDto,
  type SubmitDispenseResultsInput,
  type SubmitDispenseAuditInput,
  type UpdatePrescriptionLinesInput,
  type CellMutationInput,
  type SubmitSetAuditInput,
  type CreateCycleHoldInput,
  type WorkbenchWriteContextPatch,
} from './dispensing-workbench.write-types';
import { DISPENSE_SAFETY_CHECKLIST_ACK } from '@/lib/dispensing/safety-checklist';

/**
 * 既定はモック固定。実データを使う場合のみ false にする（環境変数 opt-in）。
 * NEXT_PUBLIC_WORKBENCH_USE_REAL_DATA='1' のときだけ実データパスを有効化し、
 * 未設定・その他の値は従来どおりモック（現行 UI 不変）。
 */
const USE_MOCK =
  typeof process !== 'undefined' ? process.env.NEXT_PUBLIC_WORKBENCH_USE_REAL_DATA !== '1' : true;

/** 実データパスが有効か（シェルがゲート判定に使用）。 */
export function isRealDataEnabled(): boolean {
  return !USE_MOCK;
}

// ── 同期（モック）API: 既存 view 初期化経路を温存 ──

/** 患者リスト（左ペイン用・同期モック）。段階1は seed 全件 */
export function loadPatients(): SeedPatient[] {
  return buildPatients();
}

/** 工程ワークベンチ（同期モック）。seed→buildModel */
export function loadWorkbench(
  _phase: Phase,
  patientId: string,
): { patient: SeedPatient | undefined; groups: Group[] } {
  const patients = buildPatients();
  const model = buildModel(patients);
  return { patient: patients.find((p) => p.id === patientId), groups: model[patientId] ?? [] };
}

/** カレンダー（7日×用法・同期モック継続）。seed→model→calc */
export function loadCalendar(patientId: string): CalcResult {
  const model: WorkbenchModel = buildModel(buildPatients());
  return calc(model, patientId);
}

// ── 非同期（実データ）API: USE_MOCK ゲートの裏 ──

/** 安全な JSON fetch。非 2xx / 例外は null（呼び出し側が fail-closed する）。 */
async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/**
 * 患者リスト（実データ）。USE_MOCK 時は seed 全件、実データ fetch 失敗時は空配列。
 * 実データ画面では seed/mock 患者を表示・操作可能にしない。
 */
export async function loadPatientsAsync(): Promise<SeedPatient[]> {
  const { patients } = await loadWorkbenchPatientRowsAsync();
  return patients;
}

export async function loadWorkbenchPatientRowsAsync(
  options: { includeSetPlan?: boolean } = {},
): Promise<{
  patients: SeedPatient[];
  rows: DispenseWorkbenchPatientRow[];
}> {
  if (USE_MOCK) return { patients: buildPatients(), rows: [] };
  const path = options.includeSetPlan
    ? '/api/dispense-workbench/patients?include_set_plan=1'
    : '/api/dispense-workbench/patients';
  const body = await fetchJson<DispenseWorkbenchPatientsResponse>(path);
  if (!body || !Array.isArray(body.data) || body.data.length === 0) {
    return { patients: [], rows: [] };
  }
  return { patients: patientsFromApi(body.data), rows: body.data };
}

/** dispense-tasks リスト API の最小レスポンス（id/status/cycle_id のみ参照）。 */
type DispenseTaskListResponse = {
  data: { id: string; status: string; cycle_id: string }[];
};

type DispenseWorkbenchPatientRow = DispenseWorkbenchPatientsResponse['data'][number];

/** 監査・完了済を後回しにして「進行中の調剤タスク」を優先選択する順序。 */
const ACTIVE_TASK_STATUS_PRIORITY = ['in_progress', 'pending', 'open', 'ready'];

/** cycle_id から代表の DispenseTask id を解決（無ければ null）。 */
async function resolveTaskId(cycleId: string): Promise<string | null> {
  const body = await fetchJson<DispenseTaskListResponse>(
    `/api/dispense-tasks?cycle_id=${encodeURIComponent(cycleId)}`,
  );
  const tasks = body?.data;
  if (!tasks || tasks.length === 0) return null;
  const ranked = [...tasks].sort((a, b) => {
    const ra = ACTIVE_TASK_STATUS_PRIORITY.indexOf(a.status);
    const rb = ACTIVE_TASK_STATUS_PRIORITY.indexOf(b.status);
    return (ra === -1 ? Number.MAX_SAFE_INTEGER : ra) - (rb === -1 ? Number.MAX_SAFE_INTEGER : rb);
  });
  return ranked[0]?.id ?? null;
}

/**
 * 工程ワークベンチ（実データ・dispense|audit の読取のみ）。
 * patientId → 患者リスト行の cycle_id → DispenseTask 解決 →
 * GET /api/dispense-tasks/[id]/workbench → from-api で写像。
 * 解決不能 / fetch 失敗 / 未認証は null（呼び出し側が空状態へ倒して mock 操作を閉じる）。
 */
export async function loadWorkbenchAsync(
  _phase: Phase,
  patientId: string,
  options: { patientRows?: DispenseWorkbenchPatientRow[] } = {},
): Promise<{
  patient: SeedPatient;
  groups: Group[];
  done: Record<string, boolean>;
  audit: Record<string, boolean>;
  quantityConfirmedByDid: Record<string, boolean>;
  writeContext: WorkbenchWriteContextPatch;
} | null> {
  if (USE_MOCK) return null;
  const listRows = options.patientRows ?? (await loadWorkbenchPatientRowsAsync()).rows;
  const row = listRows.find((r) => r.patient_id === patientId);
  if (!row || !row.cycle_id) return null;
  const taskId = await resolveTaskId(row.cycle_id);
  if (!taskId) return null;
  const data = await fetchJson<DispenseWorkbenchData>(
    `/api/dispense-tasks/${encodeURIComponent(taskId)}/workbench`,
  );
  if (!data) return null;
  const { patient, groups, done, audit, quantityConfirmedByDid } = workbenchFromApi(data);
  // 書込結線の id 束（task_id / cycle_id / cycle.version / グループ割当）を同時に返し、
  // シェルが setWriteContext で store に充填できるようにする（mutations hook が読む）。
  return {
    patient,
    groups,
    done,
    audit,
    quantityConfirmedByDid,
    writeContext: writeContextFromApi(data),
  };
}

/**
 * カレンダー（実データ・set/seta 読取）。USE_MOCK 時は null（呼び出し側が seed 継続）。
 * fetch 失敗 / 未認証 / 該当無しも null。
 */
export async function loadCalendarAsync(planId: string): Promise<CalendarMatrixResponse | null> {
  if (USE_MOCK) return null;
  const body = await fetchJson<{ data: CalendarMatrixResponse }>(
    `/api/set-plans/${encodeURIComponent(planId)}/calendar`,
  );
  return body?.data ?? null;
}

/**
 * カレンダー読取 + writeContext 充填用の束（set/seta フェーズのシェルが使用）。
 * USE_MOCK 時 / 取得失敗時は null（実データシェル側は空状態へ倒す）。
 * 戻り値の writeContext は planId / cellMeta（batch_id・version アンカー）を持つ。
 */
export async function loadCalendarWriteContextAsync(
  patientId: string,
  planId: string,
): Promise<{
  matrix: CalendarMatrixResponse;
  calendarState: ReturnType<typeof calendarWorkbenchStateFromApi>;
  writeContext: WorkbenchWriteContextPatch;
} | null> {
  const matrix = await loadCalendarAsync(planId);
  if (!matrix) return null;
  return {
    matrix,
    calendarState: calendarWorkbenchStateFromApi(patientId, matrix),
    writeContext: {
      planId,
      cycleId: matrix.cycle_id,
      cycleVersion: matrix.cycle_version,
      cellMeta: cellMetaFromCalendar(patientId, matrix),
    },
  };
}

/**
 * Direct /set or /set-audit entry point.
 *
 * The calendar write/read context cannot be derived from local persisted state.
 * Resolve it for the currently selected patient when that patient exists in the
 * real list. If the current store selection is not a real patient at all (for
 * example the initial seed id after direct entry), choose the first real patient
 * with a SetPlan as the initial queue target. Never fall forward from a real
 * selected patient with no SetPlan to another patient.
 * The dispensing queue's latest cycle is often not the set-plan cycle, so the
 * patients BFF exposes the patient-level latest SetPlan id.
 */
export async function loadSetCalendarForPatientAsync(patientId: string): Promise<{
  patients: SeedPatient[];
  selId: string;
  matrix: CalendarMatrixResponse;
  calendarState: ReturnType<typeof calendarWorkbenchStateFromApi>;
  writeContext: WorkbenchWriteContextPatch;
} | null> {
  if (USE_MOCK) return null;
  const listBody = await fetchJson<DispenseWorkbenchPatientsResponse>(
    '/api/dispense-workbench/patients?include_set_plan=1',
  );
  const listRows = listBody?.data;
  if (!listRows || listRows.length === 0) return null;

  const selectedRow = listRows.find((row) => row.patient_id === patientId);
  const candidates = selectedRow ? [selectedRow] : listRows;

  for (const row of candidates) {
    const planId = row.latest_set_plan_id;
    if (!planId) {
      if (selectedRow) return null;
      continue;
    }

    const calendar = await loadCalendarWriteContextAsync(row.patient_id, planId);
    if (!calendar) {
      if (selectedRow) return null;
      continue;
    }

    return {
      patients: patientsFromApi(listRows),
      selId: row.patient_id,
      ...calendar,
    };
  }

  return null;
}

// ── 書込（実データ）: USE_MOCK ゲートの裏 ──

/**
 * 書込用 JSON fetch。GET 専用の fetchJson とは別に POST/PATCH を扱い、
 * 409 を {@link WorkbenchConflictError}、その他非 2xx を {@link WorkbenchWriteError} へ昇格して throw する
 * （mutations hook が toast / rollback / 解決導線に振り分けるため、ここでは握り潰さない）。
 */
async function mutateJson<T>(url: string, method: 'POST' | 'PATCH', body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      credentials: 'same-origin',
      cache: 'no-store',
      body: JSON.stringify(body),
    });
  } catch {
    throw new WorkbenchWriteError('ネットワークエラーが発生しました', 0);
  }
  if (res.status === 409) {
    let details: unknown = null;
    try {
      details = await res.json();
    } catch {
      details = null;
    }
    throw new WorkbenchConflictError(details, 409);
  }
  if (!res.ok) {
    let message = '保存に失敗しました';
    try {
      const errBody = (await res.json()) as { message?: unknown };
      if (typeof errBody.message === 'string' && errBody.message) message = errBody.message;
    } catch {
      // 本文が JSON でない場合は既定メッセージ
    }
    throw new WorkbenchWriteError(message, res.status);
  }
  return (await res.json()) as T;
}

/** 一包化グループ作成（POST /api/dispense-tasks/[taskId]/groups）。 */
export async function createGroup(
  taskId: string,
  body: { group_key: string; label: string; method: string; slot?: string; sort_order?: number },
): Promise<{ data: { id: string; version?: number } } | MockWriteNoop> {
  if (USE_MOCK) return MOCK_WRITE_NOOP;
  return mutateJson(`/api/dispense-tasks/${encodeURIComponent(taskId)}/groups`, 'POST', body);
}

/** グループ属性の一括更新（PATCH /api/dispense-tasks/[taskId]/groups, groups[]）。 */
export async function updateGroups(
  taskId: string,
  groups: Array<{
    id: string;
    label?: string;
    method?: string;
    slot?: string | null;
    sort_order?: number;
    version: number;
  }>,
): Promise<{ data: unknown } | MockWriteNoop> {
  if (USE_MOCK) return MOCK_WRITE_NOOP;
  return mutateJson(`/api/dispense-tasks/${encodeURIComponent(taskId)}/groups`, 'PATCH', {
    groups,
  });
}

/** 処方明細のグループ割当（PATCH /api/dispense-tasks/[taskId]/groups, assignments[]）。 */
export async function assignLinesToGroup(
  taskId: string,
  assignments: Array<{
    line_id: string;
    packaging_group_id: string | null;
    expected_packaging_group_id: string | null;
  }>,
): Promise<{ data: unknown } | MockWriteNoop> {
  if (USE_MOCK) return MOCK_WRITE_NOOP;
  return mutateJson(`/api/dispense-tasks/${encodeURIComponent(taskId)}/groups`, 'PATCH', {
    assignments,
  });
}

/** 処方明細編集（PATCH /api/prescription-lines/[lineId]）。did === line_id。 */
export async function updatePrescriptionLine(
  lineId: string,
  body: {
    expected_updated_at: string;
    start_date?: string | null;
    end_date?: string | null;
    days?: number;
    frequency?: string;
    dose?: string;
    quantity?: number | null;
    unit?: string | null;
  },
): Promise<{ data: unknown } | MockWriteNoop> {
  if (USE_MOCK) return MOCK_WRITE_NOOP;
  return mutateJson(`/api/prescription-lines/${encodeURIComponent(lineId)}`, 'PATCH', body);
}

/** 処方明細の一括期間編集（PATCH /api/dispense-tasks/[taskId]/lines）。 */
export async function updatePrescriptionLines(
  input: UpdatePrescriptionLinesInput,
): Promise<{ data: unknown } | MockWriteNoop> {
  if (USE_MOCK) return MOCK_WRITE_NOOP;
  return mutateJson(`/api/dispense-tasks/${encodeURIComponent(input.taskId)}/lines`, 'PATCH', {
    client_action_id: input.client_action_id,
    packaging_group_id: input.packaging_group_id,
    lines: input.lines,
  });
}

/** 調剤完了（POST /api/dispense-results）。OCC は expected_version=cycle.version。 */
export async function submitDispenseResults(
  input: SubmitDispenseResultsInput,
): Promise<{ task_id: string } | MockWriteNoop> {
  if (USE_MOCK) return MOCK_WRITE_NOOP;
  return mutateJson('/api/dispense-results', 'POST', {
    ...input,
    safety_checklist: DISPENSE_SAFETY_CHECKLIST_ACK,
  });
}

/** 調剤監査完了（POST /api/dispense-audits）。 */
export async function submitDispenseAudit(
  input: SubmitDispenseAuditInput,
): Promise<{ data: unknown } | MockWriteNoop> {
  if (USE_MOCK) return MOCK_WRITE_NOOP;
  return mutateJson('/api/dispense-audits', 'POST', input);
}

/** セル set/hold/clear（PATCH /api/set-plans/[planId]/batches/cell）。 */
export async function mutateCell(
  planId: string,
  input: CellMutationInput,
): Promise<{ data: SetBatchDto | { batches: SetBatchDto[] } } | MockWriteNoop> {
  if (USE_MOCK) return MOCK_WRITE_NOOP;
  return mutateJson(`/api/set-plans/${encodeURIComponent(planId)}/batches/cell`, 'PATCH', input);
}

/** 一括セット（POST /api/set-plans/[planId]/batches/bulk-set）。 */
export async function bulkSetCells(
  planId: string,
  cells: Array<{ batch_id: string; expected_version?: number }>,
): Promise<{ data: { count: number; batches: SetBatchDto[] } } | MockWriteNoop> {
  if (USE_MOCK) return MOCK_WRITE_NOOP;
  return mutateJson(`/api/set-plans/${encodeURIComponent(planId)}/batches/bulk-set`, 'POST', {
    cells,
  });
}

/** セット監査 OK/部分/NG（POST /api/set-audits）。 */
export async function submitSetAudit(
  input: SubmitSetAuditInput,
): Promise<{ data: unknown } | MockWriteNoop> {
  if (USE_MOCK) return MOCK_WRITE_NOOP;
  return mutateJson('/api/set-audits', 'POST', input);
}

/** 構造化保留 作成（POST /api/cycle-holds）。 */
export async function createCycleHold(
  input: CreateCycleHoldInput,
): Promise<{ data: { id: string } } | MockWriteNoop> {
  if (USE_MOCK) return MOCK_WRITE_NOOP;
  return mutateJson('/api/cycle-holds', 'POST', input);
}

/** 構造化保留 解決（PATCH /api/cycle-holds）。 */
export async function resolveCycleHold(input: {
  id: string;
  note?: string;
}): Promise<{ data: { id: string; resolved: boolean } } | MockWriteNoop> {
  if (USE_MOCK) return MOCK_WRITE_NOOP;
  return mutateJson('/api/cycle-holds', 'PATCH', input);
}
