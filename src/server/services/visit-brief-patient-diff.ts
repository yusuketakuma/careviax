import { readJsonObject } from '@/lib/db/json';
import {
  describeRevisionValue,
  isJsonEqual,
  sortJsonArrayStable,
} from '@/server/services/patient-field-revision';
import {
  adlLabels,
  careLevelLabels,
  dementiaLabels,
  specialProcedureLabels,
} from '@/lib/patient/home-visit-intake';
import type {
  VisitBriefPatientChange,
  VisitBriefPatientChangeCategory,
  VisitBriefPatientChangeType,
} from '@/types/visit-brief';

/**
 * 前回訪問の患者状態スナップショット(VisitRecord.patient_state_snapshot)と現在の
 * スナップショット(buildPatientStateSnapshot 出力)を比較し、前回訪問以降の患者属性変更を返す純関数。
 *
 * 方針:
 * - どちらかが null/非オブジェクトなら [](初回訪問 / slice④導入前の旧記録のグレースフル)。
 * - 既知フィールドのみ比較しスキーマドリフトに耐性を持たせる。
 * - care_team / medical_procedure / narcotic は CareCase 単位(home_visit_intake/care_team_links)のため
 *   両 snapshot の case_id が食い違う場合は比較しない(別ケース比較による偽差分回避)。
 * - 集合(連絡先/保険/医療処置/多職種)は sortJsonArrayStable + isJsonEqual で順序非依存に比較する。
 * - 機微情報(電話/保険番号/住所)は生値を previous/current に出さず field_label + change_type のみ。
 *   主病名(病名)と多職種スタッフ名は薬学業務上の必須情報で、同一 assignment スコープ内の薬剤師向け
 *   ビュー(baseline_context 等でも既出)のため生値表示とする(識別子系=電話/番号/住所のみマスク)。
 * - 比較対象スコープ(意図的): 居住=address/facility/unit、保険=種別/申請状態/負担割合(有効期間 valid_from/until や
 *   building_id は対象外)。臨床的に重要な軸はカバーし、識別子の細部はノイズ回避のため除外している。
 * - caseId 選定: 現在側は caseIds[0] で構築されるが、前回 snapshot と case が食い違っても caseComparable
 *   ガードが case 依存カテゴリ(care_team/medical_procedure/narcotic)をスキップするため誤差分は出ない。
 */
export function diffPatientStateSnapshots(
  previous: unknown,
  current: unknown
): VisitBriefPatientChange[] {
  const prev = readJsonObject(previous);
  const cur = readJsonObject(current);
  if (!prev || !cur) return [];

  const out: VisitBriefPatientChange[] = [];

  const prevCaseId = typeof prev.case_id === 'string' ? prev.case_id : null;
  const curCaseId = typeof cur.case_id === 'string' ? cur.case_id : null;
  const caseComparable = !(prevCaseId && curCaseId && prevCaseId !== curCaseId);

  // 1. 主病名(conditions の is_primary)
  pushScalar(out, 'primary_condition', '主病名', primaryConditionName(prev), primaryConditionName(cur));

  // 2. 介護度/ADL/認知症度/嚥下/感染隔離(scheduling_preference を SSOT とする)
  const prevPref = readJsonObject(prev.scheduling_preference);
  const curPref = readJsonObject(cur.scheduling_preference);
  pushScalar(out, 'care_level', '介護度', prevPref?.care_level, curPref?.care_level, {
    labelMap: careLevelLabels,
  });
  pushScalar(out, 'care_level', 'ADL', prevPref?.adl_level, curPref?.adl_level, {
    labelMap: adlLabels,
  });
  pushScalar(out, 'care_level', '認知症度', prevPref?.dementia_level, curPref?.dementia_level, {
    labelMap: dementiaLabels,
  });
  pushScalar(out, 'care_level', '嚥下', prevPref?.swallowing_route, curPref?.swallowing_route);
  pushScalar(out, 'care_level', '感染隔離', prevPref?.infection_isolation, curPref?.infection_isolation);

  // 3. 連絡先(主電話は機微 + 連絡先一覧は件数のみ)
  const prevPatient = readJsonObject(prev.patient);
  const curPatient = readJsonObject(cur.patient);
  pushScalar(out, 'contact', '連絡先(電話)', prevPatient?.phone, curPatient?.phone, {
    sensitive: true,
  });
  pushContactSetChange(out, prev.contacts, cur.contacts);

  // 4. 居住(住所等は機微: 生値非露出)
  pushResidenceChange(out, prev.primary_residence, cur.primary_residence);

  // 5. 保険(番号は機微: 非機微 projection で比較)
  pushInsuranceChange(out, prev.insurances, cur.insurances);

  // 6. CareCase 単位(同一ケース時のみ)
  if (caseComparable) {
    const prevHvi = readJsonObject(prev.home_visit_intake);
    const curHvi = readJsonObject(cur.home_visit_intake);
    pushScalar(out, 'narcotic', '麻薬(ベース)', prevHvi?.narcotics_base, curHvi?.narcotics_base);
    pushScalar(out, 'narcotic', '麻薬(レスキュー)', prevHvi?.narcotics_rescue, curHvi?.narcotics_rescue);
    pushProcedureSetChange(out, prevHvi?.special_medical_procedures, curHvi?.special_medical_procedures);
    pushCareTeamChange(out, prev.care_team_links, cur.care_team_links);
  }

  return out;
}

const CARE_TEAM_ROLE_LABELS: Record<string, string> = {
  physician: '主治医',
  nurse: '訪問看護',
  care_manager: 'ケアマネ',
  pharmacist: '薬剤師',
  other: 'その他',
};

function isAbsent(value: unknown): boolean {
  // boolean の false(麻薬なし/感染隔離なし等)は「無し」として扱い、false→true を added と判定する
  return value === null || value === undefined || value === '' || value === false;
}

function changeType(prev: unknown, cur: unknown): VisitBriefPatientChangeType {
  const hasPrev = !isAbsent(prev);
  const hasCur = !isAbsent(cur);
  if (!hasPrev && hasCur) return 'added';
  if (hasPrev && !hasCur) return 'removed';
  return 'changed';
}

function normalizeScalar(value: unknown): unknown {
  return isAbsent(value) ? null : value;
}

// 集合カテゴリ(連絡先/保険)の件数差から change_type を決める(0→N=added, N→0=removed, それ以外=changed)
function setChangeType(prevLength: number, curLength: number): VisitBriefPatientChangeType {
  if (prevLength === 0 && curLength > 0) return 'added';
  if (prevLength > 0 && curLength === 0) return 'removed';
  return 'changed';
}

function pushScalar(
  out: VisitBriefPatientChange[],
  category: VisitBriefPatientChangeCategory,
  fieldLabel: string,
  prev: unknown,
  cur: unknown,
  options?: { sensitive?: boolean; labelMap?: Record<string, string> }
): void {
  if (isJsonEqual(normalizeScalar(prev), normalizeScalar(cur))) return;
  const type = changeType(prev, cur);
  if (options?.sensitive) {
    out.push({ category, field_label: fieldLabel, previous: null, current: null, change_type: type });
    return;
  }
  const label = (value: unknown): string => {
    if (!isAbsent(value) && options?.labelMap && typeof value === 'string' && options.labelMap[value]) {
      return options.labelMap[value];
    }
    return describeRevisionValue(value);
  };
  out.push({
    category,
    field_label: fieldLabel,
    previous: label(prev),
    current: label(cur),
    change_type: type,
  });
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

function toObjectArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => readJsonObject(item))
    .filter((item): item is Record<string, unknown> => item !== null);
}

function primaryConditionName(snapshot: Record<string, unknown>): string | null {
  const conditions = toObjectArray(snapshot.conditions);
  const primary = conditions.find((c) => c.is_primary === true);
  return primary && typeof primary.name === 'string' ? primary.name : null;
}

function pushContactSetChange(
  out: VisitBriefPatientChange[],
  prevValue: unknown,
  curValue: unknown
): void {
  // 電話番号(機微)は比較キーから除外し、名前+続柄で集合一致を判定する
  const project = (value: unknown) =>
    sortJsonArrayStable(
      toObjectArray(value).map((c) => ({ name: c.name ?? null, relation: c.relation ?? null }))
    );
  const prev = project(prevValue);
  const cur = project(curValue);
  if (isJsonEqual(prev, cur)) return;
  out.push({
    category: 'contact',
    field_label: '連絡先一覧',
    previous: `${prev.length}件`,
    current: `${cur.length}件`,
    change_type: setChangeType(prev.length, cur.length),
  });
}

function pushResidenceChange(
  out: VisitBriefPatientChange[],
  prevValue: unknown,
  curValue: unknown
): void {
  const project = (value: unknown) => {
    const r = readJsonObject(value);
    if (!r) return null;
    return {
      address: r.address ?? null,
      facility_id: r.facility_id ?? null,
      facility_unit_id: r.facility_unit_id ?? null,
      unit_name: r.unit_name ?? null,
    };
  };
  const prev = project(prevValue);
  const cur = project(curValue);
  if (isJsonEqual(prev, cur)) return;
  // 住所は機微のため生値を出さず変更の事実のみ
  out.push({
    category: 'residence',
    field_label: '居住情報',
    previous: null,
    current: null,
    change_type: changeType(prev, cur),
  });
}

function pushInsuranceChange(
  out: VisitBriefPatientChange[],
  prevValue: unknown,
  curValue: unknown
): void {
  // 保険者番号/公費負担者番号(機微)は除外し、種別/申請状態/負担割合で比較する
  const project = (value: unknown) =>
    sortJsonArrayStable(
      toObjectArray(value).map((i) => ({
        insurance_type: i.insurance_type ?? null,
        application_status: i.application_status ?? null,
        copay_ratio: i.copay_ratio ?? null,
      }))
    );
  const prev = project(prevValue);
  const cur = project(curValue);
  if (isJsonEqual(prev, cur)) return;
  out.push({
    category: 'insurance',
    field_label: '保険',
    previous: `${prev.length}件`,
    current: `${cur.length}件`,
    change_type: setChangeType(prev.length, cur.length),
  });
}

function pushProcedureSetChange(
  out: VisitBriefPatientChange[],
  prevValue: unknown,
  curValue: unknown
): void {
  const prevSet = new Set(toStringArray(prevValue));
  const curSet = new Set(toStringArray(curValue));
  const label = (proc: string) => `医療処置（${specialProcedureLabels[proc] ?? proc}）`;
  for (const proc of curSet) {
    if (!prevSet.has(proc)) {
      out.push({
        category: 'medical_procedure',
        field_label: label(proc),
        previous: null,
        current: 'あり',
        change_type: 'added',
      });
    }
  }
  for (const proc of prevSet) {
    if (!curSet.has(proc)) {
      out.push({
        category: 'medical_procedure',
        field_label: label(proc),
        previous: 'あり',
        current: null,
        change_type: 'removed',
      });
    }
  }
}

function pushCareTeamChange(
  out: VisitBriefPatientChange[],
  prevValue: unknown,
  curValue: unknown
): void {
  const keyOf = (l: Record<string, unknown>) =>
    [
      typeof l.role === 'string' ? l.role : '',
      typeof l.name === 'string' ? l.name : '',
      typeof l.organization_name === 'string' ? l.organization_name : '',
    ].join('|');
  const roleLabel = (l: Record<string, unknown>) => {
    const role =
      typeof l.role === 'string' ? (CARE_TEAM_ROLE_LABELS[l.role] ?? l.role) : '多職種';
    return `多職種（${role}）`;
  };
  const nameOf = (l: Record<string, unknown>) => (typeof l.name === 'string' ? l.name : null);

  const prevMap = new Map(toObjectArray(prevValue).map((l) => [keyOf(l), l] as const));
  const curMap = new Map(toObjectArray(curValue).map((l) => [keyOf(l), l] as const));

  for (const [key, link] of curMap) {
    if (!prevMap.has(key)) {
      out.push({
        category: 'care_team',
        field_label: roleLabel(link),
        previous: null,
        current: nameOf(link),
        change_type: 'added',
      });
    }
  }
  for (const [key, link] of prevMap) {
    if (!curMap.has(key)) {
      out.push({
        category: 'care_team',
        field_label: roleLabel(link),
        previous: nameOf(link),
        current: null,
        change_type: 'removed',
      });
    }
  }
}
