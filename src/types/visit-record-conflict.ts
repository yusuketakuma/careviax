// ─── VisitRecord 楽観ロック競合スナップショット型 ──────────────────────────
// version 整数比較による楽観ロック(PATCH/POST 409)で使う競合スナップショットの
// 単一ソース。3箇所の平行実装(route.ts サーバ権威版 / sync-engine.ts 防御的
// パース版 / visit-record-form.tsx inline cast)を本ファイルへ集約する。
//
// - VisitRecordConflictServerSnapshot: サーバ権威版。route.ts が DB から読んだ
//   直後の完全な形(全フィールド必須)。
// - VisitRecordConflictServerSnapshotInput: クライアント受信用の緩和版。
//   fetch レスポンス/IndexedDB 由来の信頼できない payload を防御的パースする
//   ための型で、サーバ権威版のフィールド集合を変えず optionality のみ緩める
//   (狭めない)。

export type VisitRecordConflictResidualMedication = {
  drug_master_id: string | null;
  drug_name: string;
  drug_code: string | null;
  prescribed_quantity: number | null;
  prescribed_daily_dose: number | null;
  remaining_quantity: number;
  is_prohibited_reduction: boolean;
};

export type VisitRecordConflictServerSnapshot = {
  id: string;
  version: number;
  patient_id: string;
  visit_date: string;
  outcome_status: string;
  soap_subjective: string | null;
  soap_objective: string | null;
  soap_assessment: string | null;
  soap_plan: string | null;
  next_visit_suggestion_date: string | null;
  residual_medications: VisitRecordConflictResidualMedication[];
};

// クライアント側で防御的パースする際に許容する残薬明細の形。
// drug_name / remaining_quantity / is_prohibited_reduction は必須のまま、
// それ以外(drug_master_id 含む)は optional に緩和する。
export type VisitRecordConflictResidualMedicationInput = Pick<
  VisitRecordConflictResidualMedication,
  'drug_name' | 'remaining_quantity' | 'is_prohibited_reduction'
> &
  Partial<
    Pick<
      VisitRecordConflictResidualMedication,
      'drug_master_id' | 'drug_code' | 'prescribed_quantity' | 'prescribed_daily_dose'
    >
  >;

// クライアント側で防御的パースする際に許容するサーバスナップショットの形。
// id/version/patient_id/visit_date/outcome_status は必須のまま、
// SOAP 各項目・次回訪問提案日・残薬明細は optional に緩和する。
export type VisitRecordConflictServerSnapshotInput = Pick<
  VisitRecordConflictServerSnapshot,
  'id' | 'version' | 'patient_id' | 'visit_date' | 'outcome_status'
> &
  Partial<
    Pick<
      VisitRecordConflictServerSnapshot,
      | 'soap_subjective'
      | 'soap_objective'
      | 'soap_assessment'
      | 'soap_plan'
      | 'next_visit_suggestion_date'
    >
  > & {
    residual_medications?: VisitRecordConflictResidualMedicationInput[];
  };
