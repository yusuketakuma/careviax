# 担当者・拠点命名の抽象化規約（W0-13）

- 目的: 現行スキーマの一部は「薬剤師」「薬局」という職種・業態名がモデル名・カラム名に直接焼き込まれている。在宅訪問薬局に閉じている間は問題にならないが、将来の水平展開（医科訪問診療・訪問看護など）を見据えると、担当者/拠点の**役割**と**職種**を型・カラムの命名レベルで混同しないことが重要になる。本メモは命名規約と、現状の焼き込み箇所の棚卸しを行う。
- 前提: Monolith First を維持する。本メモは**命名規約のみ**を定めるドキュメントであり、既存 schema / DB カラムのリネームは行わない（後述 §3 の移行方針を参照）。`docs/design/core-modularization-notes.md`（W0-7、pharmacy-partnership の N 者化等）とは独立した観点だが、同じ「水平展開の土台を壊さない」目的を共有する。

---

## 1. 規約

**新規に追加するモデル名・カラム名・TypeScript の props/型では、職種名（薬剤師/薬局 等）を焼き込まない。**

- 担当者を指す FK カラムは `<role>_id`（例: `pharmacist_id`）ではなく、役割ベースの汎用名を使う。
  - 主担当/副担当という**役割**を表したいだけなら: `assignee_id` / `primary_assignee_id` / `backup_assignee_id`
  - 「事務等」のように職種を問わない担当者スロットを増やす場合も同様に `staff_id` ではなく `assignee_id` 系に寄せる（既存の `primary_staff_id` は職種非依存の名前として既に規約に沿っているため踏襲元にしてよい）。
- 拠点・組織単位のモデルは `Pharmacy*` ではなく `CareSite` 系（例: `CareSite`、`CareSiteInsuranceConfig`）を使う。「薬局」という業態固有の属性（`dispensing_fee_category` 等）はモデル自体の名前ではなく、モデル内のフィールド／将来の業態別サブタイプで表現する。
- 例外的に許容してよいケース:
  - **実際に職種そのものを表す列挙型・マスタ**（例: `UserRole.pharmacist`、`ProfessionTypeEnum` の値、`ContactRelation`/`role` に自由記述で入る `"physician/nurse/pharmacist/..."` 等）は対象外。これらは「誰が薬剤師であるか」を表現するための語彙そのものであり、抽象化すると意味が失われる。
  - **請求・法制度上、薬局という業態に本質的に紐づく概念**（`PharmacyContract`、`PharmacyInvoice`、調剤報酬まわりの `dispensing_fee_category` 等）は無理に一般化しない。`docs/design/core-modularization-notes.md` §2 が示す通り、「誰が関与しているか（連携・可視性）」の層と「誰が誰に請求するか（契約・精算）」の層は区別し、後者は薬局固有のドメイン語彙のままでよい。
- 理由:
  - 医科訪問診療・訪問看護など隣接ドメインへの水平展開時、`pharmacist_id` という名前のカラムに医師/看護師の ID を入れることになり、命名と実体が乖離する（レビュー時の誤読・誤代入のリスクが上がる）。
  - `ExternalProfessional` + `CareTeamLink`（`prisma/schema/patient.prisma:232-255`、`prisma/schema/organization.prisma:445-471`）は既に「組織 × 職種」を一般化した土台として稼働しており、新規の職種焼き込みカラムはこの土台と重複・非整合になりやすい。
  - `assigneeId` という汎用命名は `src/app/(dashboard)/search/advanced-filter.shared.ts:14,27,130` で既にフロント側フィルタの語彙として採用されており、規約の方向性は既存コードとも整合する。

---

## 2. 既存の焼き込み一覧（確認済み・2026-07-03 時点）

`prisma/schema/*.prisma`（全 14 ファイル）を対象に、モデル定義（`^model.*Pharmac|^model.*Partner`）とフィールド名（`pharmacist`/`pharmacy` を含むカラム、大小無視）を grep して実際に確認した結果、`pharmacist`/`Pharmacy` を含むカラム・モデルは以下の通り。担当タスク指示で挙がっていた `visit.prisma:118,174,194` は実物確認の結果 `118,173,194` が正しい行番号だったため、以下は実測値で記載する。列挙型の値リテラル（`base_pharmacy`/`partner_pharmacy` 等、§1 の例外に該当する職種・役割語彙）と、単純な逆参照配列フィールド（例: `Organization.sites PharmacySite[]`）は本棚卸しの対象外とする（型名自体は §2.2 のモデル名リネームで解消されるため）。

### 2.1 担当者カラム（役割が職種名で焼き込まれている FK）

| #   | ファイル:行                                         | モデル                  | カラム                                                          | 備考                                                                                                                                                       |
| --- | --------------------------------------------------- | ----------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `prisma/schema/patient.prisma:116`                  | `Patient`               | `primary_pharmacist_id`                                         | 主担当薬剤師 (user_id)。同モデルに職種非依存の `primary_staff_id`（L118）が既に併存                                                                        |
| 2   | `prisma/schema/patient.prisma:117`                  | `Patient`               | `backup_pharmacist_id`                                          | 副担当薬剤師 (user_id)                                                                                                                                     |
| 3   | `prisma/schema/patient.prisma:186`                  | `CareCase`              | `primary_pharmacist_id`                                         | 上記 Patient と同型の重複定義                                                                                                                              |
| 4   | `prisma/schema/patient.prisma:187`                  | `CareCase`              | `backup_pharmacist_id`                                          | 同上                                                                                                                                                       |
| 5   | `prisma/schema/visit.prisma:118`                    | `VisitSchedule`         | `pharmacist_id`                                                 | 訪問担当者。`@@index` も L155/161/162 で `pharmacist_id` を参照                                                                                            |
| 6   | `prisma/schema/visit.prisma:173`                    | `FacilityVisitBatch`    | `pharmacist_id`                                                 | 施設バッチ訪問の担当者                                                                                                                                     |
| 7   | `prisma/schema/visit.prisma:194`                    | `VisitRecord`           | `pharmacist_id`                                                 | 訪問記録の担当者                                                                                                                                           |
| 8   | `prisma/schema/visit.prisma:288`                    | `VisitScheduleProposal` | `proposed_pharmacist_id`                                        | 提案訪問の担当者候補。`@@index` は L323                                                                                                                    |
| 9   | `prisma/schema/pharmacy-partnership.prisma:426-427` | `PartnerVisitRecord`    | `pharmacist_id` / `pharmacist_name`                             | パートナー薬局側の訪問記録担当者（非FK・自由入力の name 併記）                                                                                             |
| 10  | `prisma/schema/pharmacy-partnership.prisma:463-464` | `ClaimCooperationNote`  | `dispensing_pharmacy_id` / `dispensing_pharmacy_name`           | 調剤薬局側の担当。業態（調剤）に紐づく請求文脈なので §1 の例外に近いが、`_id`/`_name` ペアは担当者ではなく組織を指しており、拠点命名の§2.2と合わせて要検討 |
| 11  | `prisma/schema/admin.prisma:167`                    | `AuditLog`              | `actor_pharmacy_id`                                             | 監査ログの行為者が所属する薬局。行為者自体は `actor_id`（L166、職種非依存）だが所属側だけ焼き込まれている                                                  |
| 12  | `prisma/schema/pharmacy-partnership.prisma:169`     | `PharmacyPartnership`   | `partner_pharmacy_id`                                           | 提携先パートナー薬局の参照                                                                                                                                 |
| 13  | `prisma/schema/pharmacy-partnership.prisma:333`     | `PharmacyVisitRequest`  | `partner_pharmacy_id`                                           | 同上（訪問依頼側）                                                                                                                                         |
| 14  | `prisma/schema/pharmacy-partnership.prisma:420-421` | `PartnerVisitRecord`    | `owner_partner_pharmacy_id` / `owner_partner_pharmacy`          | 記録の帰属先パートナー薬局                                                                                                                                 |
| 15  | `prisma/schema/pharmacy-partnership.prisma:460`     | `ClaimCooperationNote`  | `partner_pharmacy_name`                                         | パートナー薬局名（自由入力）。同モデルの `dispensing_pharmacy_id`/`_name`（#10）と対になる項目                                                             |
| 16  | `prisma/schema/pharmacy-partnership.prisma:214-215` | `PatientShareCase`      | `base_pharmacy_approved_by` / `base_pharmacy_approved_at`       | ベース側薬局の承認者・承認日時                                                                                                                             |
| 17  | `prisma/schema/pharmacy-partnership.prisma:216-217` | `PatientShareCase`      | `partner_pharmacy_approved_by` / `partner_pharmacy_approved_at` | パートナー側薬局の承認者・承認日時                                                                                                                         |

### 2.2 拠点・資格・連携モデル名（職種・業態が型名に焼き込まれている）

| #   | ファイル:行                                     | モデル名                           | 備考                                                                                                                         |
| --- | ----------------------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 18  | `prisma/schema/organization.prisma:102`         | `PharmacySite`                     | 拠点そのもの。`CareSite` 相当が新設の器                                                                                      |
| 19  | `prisma/schema/organization.prisma:165`         | `PharmacySiteInsuranceConfig`      | `PharmacySite` に従属。保険種別×改定年度の算定設定                                                                           |
| 20  | `prisma/schema/organization.prisma:271`         | `PharmacistCredential`             | ユーザーの資格情報。`role` は `User`/`Membership` 側にあるため、モデル名だけが職種決め打ち                                   |
| 21  | `prisma/schema/organization.prisma:289`         | `PharmacistShift`                  | シフト管理                                                                                                                   |
| 22  | `prisma/schema/organization.prisma:309`         | `PharmacistShiftTemplate`          | シフトテンプレート                                                                                                           |
| 23  | `prisma/schema/pharmacy-partnership.prisma:132` | `PartnerPharmacy`                  | 提携先薬局そのもの（拠点マスタではなく相手方組織の台帳）。フィールド `pharmacy_code`（L136）はモデル名のリネームで併せて解消 |
| 24  | `prisma/schema/pharmacy-partnership.prisma:163` | `PharmacyPartnership`              | ベース拠点⇄パートナー薬局の提携関係。請求・契約（`PharmacyContract` 等）とは別レイヤーで §1 の例外に該当しない               |
| 25  | `prisma/schema/pharmacy-partnership.prisma:325` | `PharmacyVisitRequest`             | パートナー薬局への訪問依頼                                                                                                   |
| 26  | `prisma/schema/pharmacy-partnership.prisma:371` | `PharmacyCooperationMessageThread` | 連携メッセージスレッド                                                                                                       |
| 27  | `prisma/schema/pharmacy-partnership.prisma:394` | `PharmacyCooperationMessage`       | 連携メッセージ本体                                                                                                           |
| 28  | `prisma/schema/organization.prisma:346`         | `PharmacyOperatingHours`           | 拠点の営業時間。`PharmacySite` への FK（`site_id`）は L359 — 下記の「FK 一覧」に既出                                         |
| 29  | `prisma/schema/drug.prisma:188`                 | `PharmacyDrugStock`                | 拠点別の医薬品在庫。`PharmacySite` への FK（`site_id`）は L192 — 下記の「FK 一覧」に既出                                     |

`PharmacySite` 型を参照する FK（`site PharmacySite @relation(...)`）は `drug.prisma:192`、`organization.prisma:144,169,239,257,293,313,332,359`、`visit.prisma:81,111,280`、`pharmacy-partnership.prisma:168` など多数あるが、これらはリレーション先の型名がそのまま伝播しているだけで、個別の焼き込み判断ではなく §2.2 の 12 モデル名を直すことで自動的に解消される。

**担当タスク指示の「既存13箇所」について**: 実測の結果、上記の通り 29 箇所（担当者カラム 17 + モデル名 12）に整理された。指示にあった `visit.prisma:174` は実際には `173` が `pharmacist_id` であり、`organization.prisma` の `PharmacySite` 等（`等` に該当する `PharmacySiteInsuranceConfig`/`PharmacistCredential`/`PharmacistShift`/`PharmacistShiftTemplate`/`PharmacyOperatingHours`）に加え、`pharmacy-partnership.prisma`・`drug.prisma` 側の `PartnerPharmacy`/`PharmacyPartnership`/`PharmacyVisitRequest`/`PharmacyCooperationMessageThread`/`PharmacyCooperationMessage`/`PharmacyDrugStock` を含めると数が大きくずれるため、概数ではなく実測の一覧を正とする。

### 2.3 方針

- **DB リネーム（マイグレーション）は将来のゲートに委ねる**。上記 29 箇所は稼働中の本番相当スキーマであり、RLS ポリシー・API contract・フロントの camelCase フィールド参照（例: `pharmacistId`、`primaryPharmacistId`、`partnerPharmacyId`）が広範囲に依存している。無計画なリネームは破壊的変更になるため、本タスクではリネームしない。
- 当面は**新規追加分のみ**本規約（§1）を適用する。既存 29 箇所は現状維持し、水平展開（医科訪問診療・訪問看護）の実装が具体化し、影響範囲の洗い出しと migration 計画（`@map` によるカラム名エイリアスや、段階的な新カラム追加 → 移行 → 旧カラム削除の二段階リネーム）が立てられた時点で改めて着手する。
- 新規モデル/カラムのレビュー時は、本メモ §2 の一覧を「ここまでは許容された既存負債」として扱い、新たに同じパターン（`<role>_id`/`Pharmacy*`）を追加しないことをレビュー基準とする。

---

## 3. TypeScript 側の型エイリアス指針

- Prisma Client は snake_case カラムを camelCase フィールド名に自動変換するため、既存の職種焼き込みカラムは TS 側でも `pharmacistId` / `primaryPharmacistId` 等としてそのまま露出する。**既存コードのリネームは不要**（§2.3 の通り DB 側を変えないため）。
- **新規に書く TypeScript コード**（API route の入出力型、フォーム props、UI state 等）では、以下を指針とする。
  - 担当者 ID を保持する新規 props/型は `assigneeId: string` / `primaryAssigneeId: string | null` のような役割ベースの名前を使う。既存の `src/app/(dashboard)/search/advanced-filter.shared.ts:14` の `assigneeId: string | null` をそのまま踏襲元にしてよい。
  - 職種非依存の ID を表す軽量な型エイリアスが必要な場合は、既存の `src/types/*.ts` の命名スタイル（機能単位のファイルに `type` を直接 export、追加の ID ブランド型基盤は現状無し）に合わせ、たとえば `export type AssigneeId = string;` のような素の alias を該当機能の型ファイルに定義する。プロジェクト全体で共有する `AssigneeId`/`CareSiteId` 型を新設する場合は `src/types/` 直下ではなく、実際に複数機能から参照される段階で共通化する（YAGNI。使用実績が無いうちから共通型ファイルを先回りで作らない）。
  - 新規モデルに対応する型・コンポーネント props で拠点を指す場合は `siteId` / `careSiteId` のように呼び、`pharmacySiteId` のような職種焼き込みの新規命名を増やさない。既存 API が `siteId` を返す箇所（`pharmacist_id` 系と異なりこちらは既に職種非依存）はそのまま。
  - 職種そのものを表す値（§1 の例外）は引き続き `role: MemberRole` / `professionType: ProfessionTypeEnum` のように明示的な職種語彙を使ってよい。「担当者=誰か」と「その担当者の職種は何か」を分けて表現できることが目的であり、職種情報自体を隠す規約ではない。

---

## 4. 非対象・注意点

- 本メモは命名規約とドキュメント化のみ。Prisma schema・マイグレーション・アプリケーションコードへの変更は一切含まない。
- `CLAUDE.md` は変更しない。
- 請求・契約パイプライン固有の語彙（`PharmacyContract`/`PharmacyInvoice`/`dispensing_fee_category` 等）は §1 の例外規定により対象外。誤って一般化しないこと。

---

## 5. 権限マトリクスの Core/Pharmacy 分離と ProfessionTypeEnum との対応（W2-M2）

- `src/lib/auth/permission-matrix.ts` の `Permission` 型は `CorePermission`（職種非依存の共通ケイパビリティ）と `PharmacyPermission`（8ステップ調剤ワークフロー固有のケイパビリティ）に**型レベルのみ**分離済み（`Permission = CorePermission & PharmacyPermission`）。`ROLE_PERMISSIONS` の実値・`hasPermission()` の挙動・`PermissionKey`（既存 export 名）は完全互換で、本分離による振る舞いの変更は一切ない。
- `MemberRole`（`prisma/schema/organization.prisma:1-9`）は組織内メンバーの**役割**（owner/admin/pharmacist/pharmacist_trainee/clerk/driver/external_viewer）を表し、`ProfessionTypeEnum`（同ファイル L22-36）は `ExternalProfessional`/`CareTeamLink` 経由で連携する**外部専門職の職種**（physician/nurse/care_manager/...）を表す。両者は現状 1:1 の対応表ではなく、別レイヤーの列挙型である点に注意。
- 将来、在宅訪問看護・訪問診療などへの水平展開で `MemberRole` に `nurse`/`physician` 相当のロールを追加する場合の受け皿は以下の通り:
  - `CorePermission`（`canVisit`/`canReport`/`canAuthorReport`/`canSendCareReport`/`canManageBilling`/`canManagePatientSharing`/`canViewDashboard`/`canAdmin`）は職種を問わず共通に付与しうるケイパビリティであり、そのまま流用できる。
  - `PharmacyPermission`（`canDispense`/`canAuditDispense`/`canSet`/`canAuditSet`）は調剤（dispense/set 工程＋監査）に固有のため、nurse/physician ロールには通常 `false` 固定、または業態別の並行ケイパビリティ型（例: 将来の `VisitCarePermission`）として別途新設する想定であり、`PharmacyPermission` を無理に汎用化しない（§1 の「請求・法制度上、業態に本質的に紐づく概念は無理に一般化しない」方針と整合）。
  - `ProfessionTypeEnum` の値のうち、既に `phosRoleFromMemberRole()`（`src/lib/auth/phos-role.ts`）が `MemberRole → UserRole`（PHOS 契約側の職種列挙）にマップしている `pharmacist`/`clerk`/`driver` 系以外（`physician`/`nurse`/`care_manager`/`medical_social_worker`/`physical_therapist`/`occupational_therapist`/`speech_therapist`/`registered_dietitian`/`dentist`/`dental_hygienist`/`home_helper`/`care_staff`/`other`）は現状 `MemberRole` に対応するロールが存在しない（`ExternalProfessional` 経由の外部連携者としてのみ表現される）。`MemberRole` へのロール追加が具体化した時点で、`member-roles.ts`/`phos-role.ts`/`permission-matrix.ts` の switch/`ROLE_PERMISSIONS` を拡張する（本メモは受け皿の型を用意するのみで、実装は行わない）。
