# コアモジュール化 設計メモ（W0-7）

- 目的: 訪問トリガの一般化とパートナー連携の N 者化について、将来の一般化方向と境界を先に固定する。**本メモは設計文書のみで、コード変更は含まない**。
- 前提: Monolith First を維持する。ここで扱う一般化はいずれも Wave 3 以降のスコープであり、現時点の schema / API 契約には手を入れない。境界を早期に固定しておくことで、Wave 1-2 の実装が後から破壊的に作り直しにならないようにするのが狙い。
- 対象読者: 今後 VisitSchedule / MedicationCycle 周りの拡張、または多職種・多施設連携（pharmacy-partnership 系）の拡張を行う実装者。

---

## 1. 訪問駆動トリガの一般化（VisitSchedule.cycle_id → MedicationCycle 直結の疎化）

### 1.1 現状（実 schema）

`prisma/schema/visit.prisma`:

```prisma
model VisitSchedule {
  id                            String                @id @default(cuid())
  org_id                        String
  cycle_id                      String?                              // L106
  cycle                         MedicationCycle?      @relation(fields: [cycle_id], references: [id])  // L107
  case_id                       String                               // L108（必須。訪問は必ず CareCase 配下）
  case_                         CareCase              @relation(fields: [case_id], references: [id])   // L109
  ...
}
```

（`prisma/schema/visit.prisma:103-164`、`cycle_id`/`cycle` は L106-107）

同一パターンが `VisitScheduleProposal` にも重複している:

```prisma
model VisitScheduleProposal {
  ...
  cycle_id                      String?                              // L275
  cycle                         MedicationCycle?      @relation(fields: [cycle_id], references: [id])  // L276
  case_id                       String                               // L277
  case_                         CareCase              @relation(fields: [case_id], references: [id])   // L278
  ...
}
```

（`prisma/schema/visit.prisma:270-324`、`cycle_id`/`cycle` は L275-276）

`MedicationCycle` 本体は `prisma/schema/prescription.prisma:112-141`。`visit_schedules VisitSchedule[]` / `visit_schedule_proposals VisitScheduleProposal[]` を逆参照として持つ（同ファイル L132-133）。

**重要な既存事実**: `cycle_id` は現在も **nullable（`String?`）** であり、必須の FK ではない。運用コード側でもこれを前提にしている:

- `src/server/services/visit-schedule-planner.ts:2060` — `cycle_id: cycle?.id ?? null,`（cycle が無い訪問生成を既に許容）
- `src/server/services/visit-schedule-service.ts:476` — `...(rest.cycle_id ? { cycle_id: rest.cycle_id } : {}),`（更新時も cycle_id 未指定を許容）

つまり「訪問は必ず投薬サイクルに紐づく」という強制は DB 制約レベルでは既に存在しない。ただし **意味的な一般化はされていない**: `cycle_id` というカラム名・型が `MedicationCycle` 一本に決め打ちされているため、「サイクルが無い訪問」を表現する語彙が `null` しかなく、「そもそも何が訪問を駆動しているか」を構造的に記録できない。

### 1.2 問題

在宅訪問薬局ドメインでは訪問 = 投薬サイクル（調剤→配送→算定）の一部として自然に発生するため `MedicationCycle` への直結は妥当だった。しかし多職種連携（医科訪問診療、訪問看護）を第一級で扱う場合、訪問はサイクル無しで成立する:

- **医科訪問診療**: 診療計画・往診スケジュールが駆動する訪問で、投薬サイクルの存在を前提としない（処方が発生しない回もある）。
- **訪問看護**: 看護計画（ケアプラン単位の訪問）が駆動する訪問で、薬局側 `MedicationCycle` とは独立したライフサイクルを持つ。

現状の `cycle_id: String?` はこれらを「サイクル無し（null）」としてしか表現できず、「このカラムは何の代わりに null なのか」「他にどんな driver があり得るのか」がスキーマから読み取れない。将来これらのドメインを取り込む際、`VisitSchedule` に `nursing_care_plan_id`・`physician_visit_plan_id` のような専用カラムを都度追加していくと、`VisitSchedule` / `VisitScheduleProposal` の両方に同種のカラムが線形に増殖し、駆動源ごとの分岐ロジックが呼び出し側に散らばる。

### 1.3 将来設計（Wave 3 以降）

2 案を比較検討する。

**案 A: `driver_type` + `driver_ref`（discriminator + 非FKポインタ）**

```prisma
enum VisitDriverType {
  medication_cycle
  nursing_care_plan
  physician_visit_plan
  ad_hoc            // ドライバ無しの単発訪問（現状の null 相当）
}

model VisitSchedule {
  driver_type   VisitDriverType  @default(medication_cycle)
  driver_ref_id String?          // 参照先 ID（型は driver_type で決まる、FK制約なし）
  cycle_id      String?          // 後方互換のため当面残す（driver_type=medication_cycle 時のみ意味を持つ）
  ...
}
```

この pattern には既存の先例がある: `pharmacy-partnership.prisma` の `PatientShareCorrectionRequest` が `target_owner` / `target_type` / `target_id`（`String?`、FK 無し）で「対象の種類と ID を discriminator + 非FK ポインタで表す」構造を既に採用している（`prisma/schema/pharmacy-partnership.prisma:296-323`、特に `target_type String` L303 と `target_id String? ` L304）。同じ語彙をそのまま踏襲できる。

- 長所: マイグレーション容易（既存 `cycle_id` はそのまま残し、`driver_type='medication_cycle'` かつ `driver_ref_id = cycle_id` として読み替え可能）。カラム追加コストが低い。
- 短所: `driver_ref_id` は FK ではないため参照整合性を DB 側で保証できない（アプリ層 or トリガでの検証が必要）。

**案 B: 中間テーブル `VisitDriver`**

```prisma
model VisitDriver {
  id                String          @id @default(cuid())
  org_id            String
  driver_type       VisitDriverType
  cycle_id          String?         // driver_type=medication_cycle
  cycle             MedicationCycle? @relation(fields: [cycle_id], references: [id])
  nursing_plan_id   String?         // driver_type=nursing_care_plan（将来モデル）
  physician_plan_id String?         // driver_type=physician_visit_plan（将来モデル）
  ...
  visit_schedules   VisitSchedule[]
}

model VisitSchedule {
  driver_id String?
  driver    VisitDriver? @relation(fields: [driver_id], references: [id])
  ...
}
```

- 長所: driver 種別ごとに型付き FK を持てるため参照整合性が DB レベルで保証される。`VisitSchedule` と `VisitScheduleProposal` の両方が同じ `VisitDriver` を指せるため、現状 2 モデルに重複している `cycle_id`/`cycle` 定義（L106-107 と L275-276）を一本化できる副次効果もある。
- 短所: 1 段の JOIN が増える。既存 `cycle_id` からの移行が案 A よりやや大掛かり（`VisitDriver` レコードを訪問ごとに作る移行スクリプトが要る）。

**推奨**: 案 B（中間 `VisitDriver`）を本命とする。理由は (a) `VisitSchedule` と `VisitScheduleProposal` の重複解消も同時に狙えること、(b) 将来 driver 種別が増えるたびに `VisitSchedule` 本体を触らずに済むこと。ただし Wave 3 着手時点で医科訪問診療・訪問看護のドメインモデル（`physician_visit_plan` / `nursing_care_plan` に相当するテーブル）がまだ存在しないため、着手順序としては「対象ドメインのモデルが具体化してから `VisitDriver` を切る」のが安全（先に抽象化すると空箱の抽象になりやすい）。

移行時は `cycle_id` を deprecated 扱いにしつつ当面残し、読み取り側は `driver_type='medication_cycle' ? cycle_id : null` のフォールバックで後方互換を保つ。

---

## 2. pharmacy-partnership base/partner 2 者固定の N 者連携への一般化

### 2.1 現状（実 schema）

`prisma/schema/pharmacy-partnership.prisma` は薬局間連携を **base 薬局 1 × partner 薬局 1 の 2 者固定** でモデル化している:

```prisma
model PharmacyPartnership {
  id                  String                    @id @default(cuid())
  org_id              String
  base_site_id        String                                    // L167（自社サイト、1つ）
  base_site           PharmacySite  @relation("BaseSitePharmacyPartnerships", ...)  // L168
  partner_pharmacy_id String                                    // L169（外部薬局、1つ）
  partner_pharmacy    PartnerPharmacy @relation(...)             // L170
  status              PharmacyPartnershipStatus @default(draft)  // L171
  ...
}
```

（`prisma/schema/pharmacy-partnership.prisma:163-195`）

この 2 者関係を起点に、`PatientShareCase`（L197-240、`partnership_id` 経由で base/partner を継承）→ `PharmacyContract`（L479-510）→ `PharmacyContractVersion`（L512-541）→ `PharmacyContractFeeRule`（L543-565）→ `VisitBillingCandidate`（L567-593）→ `PharmacyInvoice` / `PharmacyInvoiceItem`（L595-656）という**独立した請求パイプライン全体**が base/partner 2 者を前提に連鎖している。`PharmacyVisitRequest`（L325-369）、`PharmacyCooperationMessageThread`（L371-392）、`PartnerVisitRecord`（L412-452）も同様に `partnership_id` 起点。

一方、多職種連携は既に別の、より汎用的な土台を持っている:

- `ProfessionTypeEnum`（`prisma/schema/organization.prisma:22-36`）— physician / nurse / care_manager / medical_social_worker / physical_therapist / occupational_therapist / speech_therapist / registered_dietitian / dentist / dental_hygienist / home_helper / care_staff / other の **13 職種**を既に列挙。
- `ExternalProfessional`（`prisma/schema/organization.prisma:445-471`）— `profession_type: ProfessionTypeEnum`、`organization_name`、`facility_id` を持つ「組織 × 職種」の外部関係者マスタ。
- `CareTeamLink`（`prisma/schema/patient.prisma:232-255`）— `case_id` に対して `external_professional_id`（nullable、`ExternalProfessional` への FK）+ `role`（フリーテキスト） + `is_primary` で **1 ケースに N 人の関係者を紐づけられる** 中間テーブル。既に N 者対応済み。
- `PatientMcsLink`（`prisma/schema/patient.prisma:391-416`）— 外部多職種連携システム（MCS = 医療介護連携システム、`docs/phase5-p00-investigation.md:510` 参照）との患者単位リンク。

つまり「主体 = (組織, 職種) の N 者連携」という一般形は `ExternalProfessional` + `CareTeamLink` として**既に存在し、稼働している**。`pharmacy-partnership.prisma` はこれとは完全に独立した並行世界として、薬局同士の 2 者関係だけを別途モデル化している（`CareTeamLink`/`ExternalProfessional` を一切参照しない）。

### 2.2 問題

- `PartnerPharmacy`（L132-161）は実質「組織としての外部薬局」であり、概念的には `ExternalProfessional`（profession_type が薬局・薬剤師系の組織アクター）と同じ粒度のはずだが、別モデル・別テーブルとして重複定義されている。
- `PharmacyPartnership` の base/partner 固定 2 者は、将来「1 患者に対して薬局が 3 社以上関与する」「訪問看護ステーションと薬局とケアマネの 3 者連携を 1 つの共有ケースで扱う」といったケースを表現できない。
- `PatientShareCase`（L197-240）は薬局間の患者共有専用モデルだが、本来これは `CareTeamLink` が既に扱っている「誰がこの患者/ケースに関与しているか」の一部でしかない。両者が並行して存在すると、同じ患者について「誰が関わっているか」を知るために 2 つの独立したテーブル群を横断しないといけなくなる。

ただし、**請求・契約パイプライン（`PharmacyContract` 以降）は現実世界でも本質的に 2 者間の精算行為**であり（請求書は必ず「誰から誰へ」の 2 点間で成立する）、ここを N 者化する必要は無い。一般化すべきは「誰が関与しているか（連携・可視性）」のレイヤーであって、「誰が誰に請求するか（契約・精算）」のレイヤーではない。この 2 層を混同しないことが設計上の要点。

### 2.3 将来設計（Wave 3 以降）

- **土台は `ExternalProfessional` / `CareTeamLink` / `PatientMcsLink` を第一級とする**。`pharmacy-partnership` は独自の主体モデルを持たず、この土台の**特殊ケース（2 者・薬局間・請求ありの連携）**として畳み込む方向を目指す。
  - `PartnerPharmacy` → `ExternalProfessional`（`profession_type` に薬局組織を表す区分を追加、または `organization_name` + 既存 `pharmacist` 相当の profession_type を流用）に段階的に統合する。1:1 の紐付け（`PartnerPharmacy.external_professional_id` を橋渡しカラムとして先に追加し、両モデル併存期間を設ける）から始めるのが安全な移行順序。
  - `PatientShareCase` の「誰が関与しているか」の部分（`base_patient_id` に対する関与者）は `CareTeamLink` の書き込みで代替可能にし、`PatientShareCase` 自体は「共有スコープ・同意状態・請求可否」という薬局間連携固有の属性（`share_scope`、`consent_verified_at` など、L208-211）に専念させる。
  - `PharmacyPartnership` の `base_site_id` / `partner_pharmacy_id` の 2 カラム構造はそのまま維持してよい（請求主体の特定に必要な情報であり、無理に N 者化しない）。将来 N 者連携が必要な場面（例: 3 施設が同一患者の共有ケースに同時関与）は、`CareTeamLink` 側で `case_id` に複数の `ExternalProfessional` を紐づけることで表現し、`PharmacyPartnership`／`PatientShareCase` は「その中で請求が発生する 2 者間の関係」だけを局所的に切り出したビューとして扱う。
- MCS 連携（`PatientMcsLink`）は既に外部システムとの患者単位同期を担っており、CareTeamLink 経由の関与者情報とは独立して残る（MCS 自体が外部の多職種連携基盤であり、CareTeamLink はその国内表現の一つと位置づけられる）。両者の統合要否は本メモの範囲外とし、別途検討する。

### 2.4 非対象・注意点

- 請求・契約（`PharmacyContract` 〜 `PharmacyInvoiceItem`）の N 者化は行わない。2 者間精算のドメインモデルとして現状維持が正しい。
- `PartnerVisitRecord` / `ClaimCooperationNote` 等、既に稼働中の請求関連ワークフローへの破壊的変更はしない。

---

## 3. 共通方針

- 上記 2 件はいずれも **Wave 3 以降** の一般化候補であり、本メモの時点では実装しない（Monolith First 維持）。
- 本メモの目的は「後から見て境界線がどこにあるべきかが分かる」状態を作ることで、Wave 1-2 での実装判断（特に `VisitSchedule` への新規カラム追加、`pharmacy-partnership` 系テーブルへの拡張）が将来の一般化と矛盾しないようにすること。
- 実装着手時は、本メモの案（1章:案B `VisitDriver`、2章: `ExternalProfessional`/`CareTeamLink` を土台とする畳み込み）を出発点としつつ、その時点で判明している要件（医科訪問診療・訪問看護のドメインモデル、N 者連携の実ユースケース）で再検証すること。
