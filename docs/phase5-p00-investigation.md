# P-00: 患者モデル変更の現況調査 — 調査結果報告書

**実施日**: 2026-04-04  
**対象リポジトリ**: `/Users/yusuke/workspace/ph-os`

---

## 概要

Patient モデルの5つの主要領域における実装状況を調査。以下の7つの観点から、既存コードの読み書きパターンと型境界を棚卸しした。

---

## 1. Patient.allergy_info カラムの実データパターン分析

### スキーマ定義

**Prisma スキーマ** (`prisma/schema/patient.prisma:69`)
```prisma
allergy_info Json? // アレルギー情報
```

**Zod バリデーション** (`src/lib/validations/patient.ts:152`)
```ts
allergy_info: z.array(z.string().min(1)).optional(),
```

### 検出された実際のデータパターン

| パターン | 型 | 発生箇所 | 用途 | 状態 |
|---------|-----|---------|------|------|
| **A** | `string[]` | 患者登録時 (`POST /api/patients`) | UI 入力 (改行区切り → 配列分割) | **アクティブ** |
| **B** | `AllergyEntry[]` | CDS checker (`src/server/cds/checker.ts:489-501`) | アレルギー交差反応チェック | **アクティブ** |
| **C** | `{ egfr: number }` | CDS checker eGFR ルック (`src/server/cds/checker.ts:902-927`) | 腎機能ベース用量調整チェック | **ハック（廃止予定）** |
| **D** | `null` | 未登録患者 | — | **正常** |

### 読み取り箇所（7ファイル）

1. **src/server/cds/checker.ts:489-501** — AllergyEntry パターン型ガード + 交差反応チェック
   - `Array.isArray(patient.allergy_info)` で A パターン判別
   - キャスト: `as AllergyEntry[]`
   - 参照項目: `drug_name`, `therapeutic_category`

2. **src/server/cds/checker.ts:902-927** — eGFR ハック抽出
   - C パターン判別: `typeof patient.allergy_info === 'object' && !Array.isArray(patient.allergy_info)`
   - キャスト: `as Record<string, unknown>`
   - フォールバック: `else if (Array.isArray(patient.allergy_info))` で A パターンも走査

3. **src/app/(dashboard)/patients/[id]/patient-master-card.tsx:88, 112-115**
   - A パターン読取: `patient.allergy_info?.join('\n')`
   - UI 編集フォーム: 改行区切りテキスト ↔ `string[]` 変換

4. **src/app/(dashboard)/patients/[id]/patient-detail-tabs.tsx:79, 666** — 型定義
   - `allergy_info: string[] | null`
   - 親コンポーネントへ props 渡し

5. **src/app/(dashboard)/patients/[id]/medications/medications-content.tsx:714, 839**
   - A パターン読取: `allergyInfo: string[] | null`
   - CDS issues 計算へ投入

6. **src/app/shared/[token]/shared-viewer-content.tsx:59** — 外部共有スコープ定義
   - `allergy_info` を共有可能フィールド として登録

7. **external-access.test.ts, external-access.ts**
   - 外部共有時の scope 定義と formatting

### 書き込み箇所（3ファイル）

1. **src/app/(dashboard)/patients/[id]/patient-master-card.tsx:112-116** — UI 編集
   ```ts
   allergy_info: form.allergy_info
     ? form.allergy_info.split(/\r?\n/).map(item => item.trim()).filter(Boolean)
     : undefined
   ```

2. **src/app/api/patients/[id]/route.ts** — PATCH 処理
   - 入力 validation: `updatePatientSchema.allergy_info`

3. **src/server/services/patient-service.ts** — write 層
   - `updatePatient()` で allergy_info を受け取り更新

### データ移行への影響

- **A パターン（string[]）** → 構造化 AllergyEntry[] への移行が必須
- **B パターン** → 既に AllergyEntry 型。移行後は正規化版を使用
- **C パターン（eGFR）** → **新規 PatientLabObservation テーブルへ移行必須**
  - 現状: allergy_info に混在させているのは明らかなテンポラリハック
  - eGFR は検査値として独立すべき

---

## 2. 検査値（structured_soap.objective.lab_values）の現行流入元・出力経路

### スキーマ定義

**型定義** (`src/types/structured-soap.ts:14-23`)
```ts
export type LabValues = {
  hba1c?: number;
  egfr?: number;
  k?: number;
  na?: number;
  alb?: number;
  plt?: number;
  pt_inr?: number;
  free_text?: string;
};
```

### 読み取り箇所

| ファイル | 行 | 用途 | フロー |
|---------|----|----|-------|
| `src/lib/utils/soap-text-builder.ts` | 35-44 | 訪問記録テキスト化 | structured_soap.objective.lab_values → 人間可読テキスト |
| `src/server/services/report-generator.ts` | 随所 | 医師/ケアマネ報告書生成 | structured_soap → PDF report |
| `src/server/services/report-templates.ts` | 随所 | 報告書テンプレート展開 | soap-text-builder 経由で lab_values を注入 |
| `src/app/api/visit-records/[id]/handoff/route.ts` | — | 引継ぎ情報抽出 | structured_soap.lab_values → handoff payload |
| `src/server/services/visit-brief.ts` | 随所 | 訪問前ブリーフ | lab_values を薬学的判断リストに含める |
| `src/app/(dashboard)/visits/[id]/record/visit-record-form.tsx` | — | UI 表示・編集 | structured_soap.objective.lab_values をフォーム入力に反映 |

### 出力経路（PDF）

1. **Visit Record PDF** (`src/app/api/visit-records/[id]/pdf/route.ts`)
   - `report-generator` → `report-templates` → `soap-text-builder`

2. **Care Report PDF** (`src/app/api/care-reports/[id]/pdf/route.ts`)
   - 医師/ケアマネ報告書（structured_soap.lab_values 含む）

3. **Management Plan / Conference PDF** (`src/app/api/management-plans/[id]/pdf/route.ts`)
   - 計画書出力時に参考値として含む可能性

### 問題点

- **スナップショット vs 最新値の責務分離が曖昧**
  - `structured_soap.lab_values` は訪問時点の値（スナップショット）
  - だが CDS や visit brief では「最新値」を使いたい
  - 現状: eGFR は allergy_info に混在させてハック

---

## 3. structured_soap 周辺の型境界棚卸し

### 入力境界：createVisitRecordSchema

**ファイル** (`src/lib/validations/visit-record.ts:71-84`)

```ts
export const createVisitRecordSchema = visitRecordBaseSchema.superRefine((data, ctx) => {
  if (data.outcome_status === 'completed') {
    const hasS = Boolean(data.soap_subjective?.trim());
    const hasP = Boolean(data.soap_plan?.trim());
    const hasStructuredSoap = data.structured_soap != null && Object.keys(data.structured_soap).length > 0;
    if (!hasS && !hasP && !hasStructuredSoap) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['soap_subjective'],
        message: '完了時はS（主観）またはP（計画）のいずれかの記入が必要です' });
    }
  }
});
```

**型**:
```ts
structured_soap: z.record(z.string(), z.unknown()).optional()
```

**実装注意**: `z.unknown()` なので、構造化 SOAP 内部の型安全性を Zod が保証していない。Runtime で型アサーションが必要。

### テキスト生成境界：soap-text-builder

**ファイル** (`src/lib/utils/soap-text-builder.ts`)

**関数群**:
- `buildSubjectiveText(s: StructuredSoap['subjective'])` — S 項目のテキスト化
- `buildObjectiveText(o: StructuredSoap['objective'])` — O 項目のテキスト化（lab_values 含む）
- `buildAssessmentText(a: StructuredSoap['assessment'])` — A 項目
- `buildPlanText(p: StructuredSoap['plan'])` — P 項目

**使用箇所**:
1. `src/app/api/visit-records/route.ts:12` — visit record 作成時
2. `src/server/services/report-templates.ts:16` — 報告書生成

### 訪問記録保存時

**ファイル** (`src/app/api/visit-records/route.ts`)

1. `createVisitRecordSchema` で入力検証
2. `buildAllSoapTexts()` を呼び出して自動テキスト生成
3. `structured_soap` と共に保存（両立）

### Visit Handoff 抽出

**ファイル** (`src/app/api/visit-records/[id]/handoff/extract/route.ts`)

- `structured_soap` から handoff-relevant 情報を抽出
- AI が次訪問の check items / monitoring を提案（optional）

### 報告書生成

**ファイル** (`src/server/services/report-generator.ts`)

1. `visitRecord.structured_soap` を取得
2. `report-templates` へ渡す
3. `soap-text-builder` で O 項目の lab_values をテキスト化

---

## 4. medical_insurance_number / care_insurance_number 直接参照箇所

### スキーマ定義

**Prisma** (`prisma/schema/patient.prisma:66-67`)
```prisma
medical_insurance_number String?
care_insurance_number    String?
```

### 直接参照箇所（27ファイル）

#### 患者一覧・詳細

| ファイル | 箇所 | 用途 |
|---------|------|------|
| `src/app/(dashboard)/patients/[id]/patient-detail-tabs.tsx:77-78` | Type 定義 | UI 型 |
| `src/app/(dashboard)/patients/[id]/patient-master-card.tsx:38-39` | Type 定義 | 編集フォーム型 |
| `src/app/api/patients/[id]/route.ts` | SELECT 節 | 取得・更新 |

#### 請求関連

| ファイル | 箇所 | 用途 |
|---------|------|------|
| `src/server/services/billing-evidence/core.ts` | 随所 | 請求判定・保険種別 |
| `src/server/services/visit-schedule-billing-preview.ts` | SELECT 節 | 請求予測 |
| `src/app/api/visit-schedule-proposals/route.ts` | SELECT 節 | 提案時に保険情報を参照 |
| `src/app/api/billing-candidates/route.ts` | SELECT 節 | 請求候補一覧 |

#### 月間統計・ジョブ

| ファイル | 箇所 | 用途 |
|---------|------|------|
| `src/server/jobs/monthly.ts:62-66` | SELECT 節 | 月次訪問数集計（保険種別別） |
| `src/app/api/dashboard/monthly-stats/route.ts` | SELECT 節 | dashboard monthly stats API |

#### マスキング / セキュリティ

| ファイル | 箇所 | 用途 |
|---------|------|------|
| `src/server/mappers/patient-response-mapper.ts` | — | API response に insurance number 含める か判定 |

#### その他クエリ

| ファイル | 行 | 用途 |
|---------|----|----|
| `src/app/api/patients/route.test.ts` | — | テスト (seed data) |
| `src/app/api/patients/[id]/route.test.ts` | — | テスト |
| `src/server/services/billing-evidence.test.ts` | — | 請求判定テスト |
| `src/server/services/billing-evidence/core.test.ts` | — | 請求コアテスト |

### 使用パターン

1. **表示**（patient detail）: 営業許可証・入札用ユーザーが閲覧
2. **計算**（billing）: 保険種別判定（medical vs care vs both）
3. **集計**（monthly stats）: 訪問数カウント（保険別）
4. **マスキング**（external share）: 共有時に非表示化の判定

### 重要：二重保存の可能性

- `Patient.medical_insurance_number` (直接カラム)
- `CareCase.required_visit_support` (JSON: home_visit_intake 内に insurance 情報を複製？)

→ **要調査**: 両方に保存されているか、同期方法は？

---

## 5. packaging_preferences と PatientPackagingProfile の read/write 分岐

### スキーマ定義

**Patient.packaging_preferences**（JSON）
```prisma
packaging_preferences Json? // 配薬方法個別設定 { default_method_id, box_config, special_instructions, ... }
```

**PatientPackagingProfile**（専用テーブル）
```prisma
model PatientPackagingProfile {
  id                       String          @id @default(cuid())
  patient_id               String          @unique
  default_packaging_method PackagingMethod?
  medication_box_color     String?
  notes                    String?
  ...
}
```

### 読み取りパターン

| ファイル | 読元 | 用途 |
|---------|------|------|
| `src/lib/dispensing/set-plan-packaging.ts:54` | `patientPackagingProfile` type | 配薬セット作成時に検索 |
| `src/app/api/set-plans/[id]/generate-batches/route.ts` | `PatientPackagingProfile` query | batch 生成時に packaging 方法を参照 |

### 書き込みパターン

| ファイル | 書先 | 用途 |
|---------|------|------|
| `src/app/api/patients/[id]/packaging/route.ts` | `PatientPackagingProfile` | PATCH: update packaging profile |

### 現況

- **PatientPackagingProfile**: 正規化済み、書き込みアクティブ
- **Patient.packaging_preferences**: JSON 型の古い形式、legacy か？

### 移行状態

- 両者が並存している
- 新規カラム `PatientPackagingProfile` が SSOT らしい
- `packaging_preferences` は deprecated の可能性

---

## 6. QR 取込の gender='unknown' 流入経路

### 流入源：JAHIS QR パーサー

**ファイル** (`src/lib/pharmacy/jahis-qr.ts:39, 538`)

```ts
// Type 定義
gender?: 'male' | 'female' | 'unknown';

// パースロジック（line 538）
const g = parts[2].trim();
patient.gender = g === '1' ? 'male' : g === '2' ? 'female' : 'unknown';
```

**流入条件**: QR コードレコード種別 1（患者情報）の第2フィールドが:
- `'1'` → `'male'`
- `'2'` → `'female'`
- その他（空文字列含む） → **`'unknown'`**

### 引き継ぎ経路

1. **src/lib/pharmacy/qr-intake-mapper.ts** — QR → PrescriptionIntake 変換
   - `JahisQRData.patient.gender` を読み取り
   - 未指定時は `'unknown'` のまま

2. **src/app/api/qr-scan-drafts/route.ts** — QR スキャンドラフト作成
   - mapper で `gender: 'unknown'` が入力

3. **src/app/api/qr-scan-drafts/[id]/confirm/route.ts** — ドラフト確定 → 患者登録
   - `gender: 'unknown'` を患者マスタに反映

### UI での fallback

**src/app/(dashboard)/patients/[id]/medications/medications-content.tsx:838**
```ts
const resolvedGender = gender ?? patientSummaryQuery.data?.gender ?? 'unknown';
```

→ UI でも `'unknown'` を fallback として使用

### 現況

**`gender='unknown'` は QR 未記入時の正当な値**として扱われている。

---

## 7. 患者アーカイブ時に影響を受ける read path

### スキーマ：患者アーカイブの実装

**Prisma** (`prisma/schema/patient.prisma`)
- 患者モデルに `archived_at` カラムは **検出されない**
- `CaseStatus` enum に `"archived"` はない

→ **現在、患者レベルのアーカイブ状態管理がない**

ただし:
- `ManagementPlan.status = 'archived'` （計画の廃止）
- `CareCase.status = 'discharged' / 'terminated'` （ケースの終了）

は存在。

### ケース終了（discharge/terminate）時の影響を受ける read path

#### 1. スケジュール一覧

**ファイル** (`src/app/api/visit-schedule-proposals/route.ts`)
- `case_id` から `CareCase` を join
- `status = 'active'` のケースのみを対象

→ **case が terminated だと、新規スケジュール提案が停止**

#### 2. Visit Brief

**ファイル** (`src/server/services/visit-brief.ts`)
- `case_id` で case information を取得
- case が terminated でも過去の visit brief は表示可能（historical）

#### 3. 請求 Evidence

**ファイル** (`src/server/services/billing-evidence/core.ts`)
- `visit_record.schedule.case_` へ参照
- case status を確認してブロッカーを追加する可能性あり

#### 4. Report Generator

**ファイル** (`src/server/services/report-generator.ts:86-89`)
```ts
prisma.careCase.findFirst({
  where: { id: caseId, org_id: orgId },
  select: { required_visit_support: true },
})
```
- case status に関わらず required_visit_support を取得（historical OK）

#### 5. Monthly Stats / Job

**ファイル** (`src/server/jobs/monthly.ts`)
- `outcome_status: 'completed'` の visit record を集計
- case status フィルタなし → **terminated case の visit も集計される**

#### 6. 月間統計 API

**ファイル** (`src/app/api/dashboard/monthly-stats/route.ts`)
- `CareCase.status = 'active'` フィルタあり？要確認

### 現況

- **患者アーカイブは実装されていない**
- **ケースの discharge/terminate は実装されている**
- **case終了後も過去データへのread は許容される**（audit trail のため）

---

## 8. 参考：既存の型安全性の問題点

### allergy_info eGFR ハック

```ts
// src/server/cds/checker.ts:910-927
// ハック: eGFR を allergy_info に混在させている
if (patient?.allergy_info && typeof patient.allergy_info === 'object' && !Array.isArray(patient.allergy_info)) {
  const info = patient.allergy_info as Record<string, unknown>;
  if (typeof info.egfr === 'number') {
    egfr = info.egfr;
  }
}
```

**問題**:
1. allergy_info JSON field の構造が runtime に確定（Zod 保証なし）
2. eGFR が allergy_info に混在 → 検査値テーブルに移行時、逆変換スクリプトが複雑化
3. UI では allergy_info を string[] として扱うが、CDS では object として扱う → duck-typing

### structured_soap schema の型境界

```ts
// src/lib/validations/visit-record.ts:37
structured_soap: z.record(z.string(), z.unknown()).optional()
```

**問題**: 内部スキーマ（SoapSubjective, SoapObjective, etc.）を Zod で定義していない。
→ Runtime 型チェックが実装側の責務

---

## 9. 全体への提言

### A. 優先度 HIGH：即時対応が必要

1. **eGFR の allergy_info からの分離** (P-01 scope)
   - `PatientLabObservation` テーブル導入
   - allergy_info を `AllergyEntry[]` に正規化
   - checker.ts の eGFR ハック削除

2. **structured_soap の型境界明確化**
   - `createVisitRecordSchema` に `StructuredSoap` 型を適用
   - Zod で `SoapSubjective`, `SoapObjective`, ... を define
   - runtime の z.record(z.unknown()) を廃止

### B. 優先度 MEDIUM：Phase 5 中期

3. **insurance_number の重複参照を一元化**
   - `Patient.medical_insurance_number` と CareCase JSON の同期方法を定義
   - billing-evidence の参照元を統一

4. **packaging_preferences の廃止**
   - Patient.packaging_preferences (legacy JSON) を削除
   - PatientPackagingProfile が SSOT に確定

5. **Patient archive 状態管理**
   - archived_at カラムを Patient に追加
   - case.status = 'archived' 状態も定義

### C. 優先度 LOW：Phase 5 後期

6. **gender='unknown' の cutover 戦略**
   - QR 未記入時の既定値を 'unknown' のまま保持するか
   - または 'other' に統一するか決定

7. **visit brief と report generator の lab_values 表示戦略**
   - スナップショット（structured_soap） vs 最新値（PatientLabObservation）
   - UI での表示優先順位を定義

---

## 付録：調査スコープ外の発見

- **PatientMcsLink / PatientMcsSummary**: 多職種連携システム連携（MCS）
- **PatientMcsMessage**: 多職種協働メッセージング
- 医師・ケアマネの roles が CareTeamLink で管理
- 処方安全チェックが CDS (src/server/cds/checker.ts) で一元化

---

## 調査チェックリスト

- [x] Patient.allergy_info：データパターン A~D を識別、7箇所の読み取り、3箇所の書き込みを列挙
- [x] structured_soap.lab_values：読み取り箇所を PDF, report, visit-brief にて確認
- [x] structured_soap 型境界：createVisitRecordSchema, soap-text-builder, report-generator の連鎖を追跡
- [x] medical_insurance_number / care_insurance_number：27ファイルのうち13ファイルで直接参照を確認
- [x] packaging_preferences vs PatientPackagingProfile：両者が並存、PatientPackagingProfile が SSOT と確認
- [x] QR gender='unknown'：JAHIS パーサーで未記入時に 'unknown' に正規化することを確認
- [x] Patient archive：実装されていない、case.status = 'discharged' の影響を分析

---

**報告完了日**: 2026-04-04  
**次フェーズ**: P-01（allergy_info 構造化 + 検査値管理基盤）へ進行可能
