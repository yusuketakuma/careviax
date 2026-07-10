# Scope and Users — 利用者・業務・医療コンテキスト（Phase 1）

調査日: 2026-07-11 / 読み取り専用調査（repo 内根拠のみ、web 調査なし）

規則: 各主張に file path を付す。repo から確定できない事項は **Assumption**（推測・未確定）/ **Evidence**（根拠）/ **Review required**（専門家・人間レビュー要）を明示し、推測で確定しない。

---

## 1. 対象組織・提供形態

- **対象組織**: 在宅訪問に強い保険薬局（法人 Organization + 店舗 PharmacySite の 2 階層）。
  - Evidence: `CLAUDE.md`（「在宅訪問に強い保険薬局向けの業務・連携プラットフォーム」）、`prisma/schema/organization.prisma`（`model Organization` に corporate_number=法人番号、店舗は PharmacySite。seed は「サンプル薬局」+「サンプル薬局 本店」`prisma/seed.ts:100-126`）。
- **提供形態**: SaaS・初日からマルチテナント。テナント分離は Prisma + PostgreSQL RLS（`SET LOCAL app.current_org_id`）とアプリ層フィルタの二重防御。
  - Evidence: `docs/decisions.md`（D-02/D-08/D-09）、`CLAUDE.md`（Data Access: Prisma + PostgreSQL RLS）、`src/lib/db/rls.ts`、`prisma/rls-policies.sql`。
- **インフラ**: AWS 全面採用（ISMAP 準拠、ap-northeast-1 固定）。Amplify Hosting / RDS PostgreSQL / Cognito(MFA TOTP) / S3(Object Lock) / SES / CloudTrail / KMS。
  - Evidence: `CLAUDE.md`（Architecture 節）、`docs/decisions.md` D-09。
- **運営者（プラットフォーム事業者）アクセス**: テナント横断アクセスは「監査付き break-glass」のみ。PlatformOperator（platform_support / platform_admin / platform_owner の 3 段）+ 時間制限付き BreakGlassSession（MFA 再認証・理由必須・read_only 既定・RLS を target org に pin、BYPASSRLS 不使用）。無記録バックドアは設計上禁止。
  - Evidence: `prisma/schema/platform.prisma:17-80`、`src/app/platform/`（運営者コンソール画面）、`docs/design/platform-operator-console-design.md`（schema コメントの参照先）。
- **薬局間連携（B2B）**: 提携薬局間の契約・請求（PharmacyContract / PharmacyInvoice）、協力訪問依頼、パートナー訪問記録の取込みを持つ。
  - Evidence: `prisma/schema/pharmacy-partnership.prisma:625`（PharmacyInvoice）、`src/app/api/pharmacy-partnerships/`、`src/app/api/partner-visit-records/`。

## 2. 対象業務（機能スコープ）

`src/app/(dashboard)/` 配下の画面群と API から確認できる業務ドメイン:

| 業務 | 主要画面/API | Evidence |
| --- | --- | --- |
| 処方受付（紙/QR/電子処方箋キャッシュ） | `prescriptions/new`, `qr-scan`, PrescriptionIntake | `src/app/(dashboard)/prescriptions/`, `prisma/schema/prescription.prisma:163` |
| 調剤ワークフロー（8ステップ: 調剤→調剤監査→セット→セット監査） | `dispense`, `audit`, `set`, `set-audit`, `workflow`, dispense-workbench | `src/lib/auth/permission-matrix.ts:24-32`, `prisma/schema/prescription.prisma`（DispenseTask/DispenseAudit/SetPlan/SetAudit）, `src/lib/dispensing/dispense-workbench-shared.ts` |
| 疑義照会 | InquiryRecord | `prisma/schema/prescription.prisma:257` |
| 在宅訪問（スケジュール・ルート・訪問記録） | `schedules`, `visits`, VisitSchedule/VisitRecord/VisitInstruction | `prisma/schema/visit.prisma:114,205,248`, `src/app/(dashboard)/visits/` |
| 薬歴（構造化 SOAP + レガシー文字列 SOAP 併存） | VisitRecord.structured_soap / soap_* | `prisma/schema/visit.prisma:216-228`, `src/lib/validations/structured-soap.ts` |
| 報告書（医師/ケアマネ/看護/施設/家族/内部記録の 6 種自動生成・確定・送付） | `reports`, CareReport | `prisma/schema/communication.prisma:19-26,405`, `src/app/(dashboard)/reports/` |
| 多職種連携（発信/受信/照会/会議/外部共有） | `communications`, `conferences`, `external`, `referrals`, TracingReport/PatientSelfReport/CommunicationRequest | `prisma/schema/communication.prisma`, `src/app/(dashboard)/communications/` |
| 算定・請求（候補表示+検証、自動算定しない） | `billing`, BillingCandidate/BillingEvidence/BillingRule | `docs/decisions.md` D-05, `prisma/schema/admin.prisma:56-163`, `src/app/(dashboard)/billing/` |
| 会計（患者請求・集金、家族/代理人支払者） | billing-collection | `src/lib/validations/billing-collection.ts:208` |
| 医薬品マスタ・在庫（4層モデル、SSK/HOT/PMDA 等） | drug-masters, pharmacy-drug-stocks | `docs/decisions.md` D-07, `CLAUDE.md` 医薬品マスタ表, `prisma/schema/drug.prisma` |
| 処方安全チェック（CDS） | `api/cds/check` | `src/app/api/cds/check/route.ts`, `src/server/cds/checker.ts` |
| 事務支援・薬剤師⇔事務連絡（handoff/clerk-support） | `handoff`, `clerk-support` | `src/app/(dashboard)/handoff/`, `src/app/(dashboard)/clerk-support/`, `prisma/schema/communication.prisma:709-733` |
| インシデント報告・監査ログレビュー | `admin`, IncidentReport/AuditLog/AuditLogReview | `prisma/schema/admin.prisma:189,218,474` |
| PCAポンプ（麻薬持続注入ポンプ）レンタル管理 | pca-pumps / pca-pump-rentals | `prisma/schema/pca-pump.prisma`, `src/app/api/pca-pumps/` |

- Assumption: 外来（店頭）調剤も 8 ステップワークフローで扱えるが、プロダクトの主眼は在宅（訪問・報告書・多職種連携・居宅療養/在宅訪問薬剤管理指導の算定）。Evidence: `docs/visit-report-collab-spec.md:7`（算定対象 = 薬剤師居宅療養管理指導費 + 在宅患者訪問薬剤管理指導料）。外来算定（調剤報酬全般）を主対象とする記述は未発見。**Review required**: 外来業務のスコープ確定は業務側判断。

## 3. 利用者ロールと権限モデル

### 3.1 テナント内ロール（MemberRole）

Evidence: `prisma/schema/organization.prisma:1-9`、`src/lib/auth/permission-matrix.ts`。

| ロール | 概要（permission-matrix より） |
| --- | --- |
| owner / admin | 全権限（canAdmin=true。owner と admin の差は matrix 上なし） |
| pharmacist | 調剤4工程・訪問・報告書作成(canAuthorReport)・送付・請求管理・共有管理まで全業務可。canAdmin のみ false |
| pharmacist_trainee | 調剤・セットは可、**監査(canAuditDispense/canAuditSet)は不可**。送付・請求・共有管理不可 |
| clerk（事務） | 閲覧+連携/事務系書き込み(canReport)とダッシュボードのみ。調剤4工程・訪問・**臨床報告書の作成(canAuthorReport)** は不可（`permission-matrix.ts:106-109` に意図がコメント化） |
| driver | canVisit 含め全 false（配送要員。画面権限は実質なし） |
| external_viewer | 全 false（外部閲覧者。外部アクセスは ExternalAccessGrant 経由 `prisma/schema/communication.prisma:592`） |

- **org-wide アクセスは意図的仕様**: 薬剤師はテナント内全患者にフルアクセス、事務は全患者 read-all。need-to-know 型の患者別アクセス制御は採用していない（clerk の臨床報告書 authoring のみ canAuthorReport で遮断）。
  - Evidence: `src/lib/auth/permission-matrix.ts`（患者単位の絞り込みを持たない capability 型権限）、権限チェックは `requireAuthContext(permission: ...)` 型（例 `src/app/api/cds/check/route.ts:22-25`）。プロジェクト記憶（careviax-access-model-orgwide）とも一致。
  - Review required: この設計をリスク受容として明文化するか（3省2GL のアクセス最小化との整合説明）はコンプライアンス文書側の課題（`docs/ui-ux-refresh/02-compliance-applicability.md` で扱う）。
- **薬剤師免許の束縛**: 報告書確定者は PharmacistCredential（免許）に束縛される実装がある（`prisma/schema/communication.prisma:429-433` finalized_pharmacist_credential_*）。
- **多職種（外部関係者）**: ProfessionTypeEnum に physician/nurse/care_manager/PT/OT/ST/管理栄養士/歯科等 13 職種（`prisma/schema/organization.prisma:23-38`）。CareTeamLink で患者に紐付く（`prisma/schema/patient.prisma:244`）。外部職種はシステムの直接ユーザーではなく連携先（外部共有は ExternalAccessGrant / external-share）。
- **認証**: Cognito + next-auth v4、TOTP MFA、セッション 30 分。詳細は `docs/ui-ux-refresh/phase0/03-auth-and-permissions.md`。

### 3.2 seed に見る想定ユーザー像

Evidence: `prisma/seed.ts:262-400`。owner「山田 太郎」、pharmacist「佐藤 恵」、clerk「鈴木 さくら」「田中 真」+ 患者 5 名（例「佐藤 花子」`prisma/seed.ts:417-500`）+ 一括デモ患者オプション（`prisma/seed.ts:924`）。小規模〜中規模の 1 店舗薬局チームが基本単位。

## 4. 利用環境・デバイス

- **Mobile First / Workflow First** が設計原則（`CLAUDE.md` Design Principles）。
- **訪問時 = capture-first デバイス（スマホ/タブレット）、帰着後 = PC でオーサリング**という役割分担。横向きタブレットが md+ ブレークポイントで PC レイアウトになる矛盾の解消（capture/authoring 明示トグル）が仕様化されている（`docs/visit-report-collab-spec.md:97-100` §2.1）。
- **タッチターゲット 44px 以上**（WCAG AA、`CLAUDE.md` アクセシビリティ）。Button variant が coarse=44px / desktop compact をエンコードし test-lock 済（`src/components/ui/button.tsx` 系、プロジェクト記憶 careviax-button-touch-target-variant-contract）。
- **患家は電波不安定前提**: PWA(Serwist) + Dexie(IndexedDB) + AES-GCM 暗号化下書き。屋外・片手・グローブ操作前提（高輝度モード/大型フォント等は仕様段階 `docs/visit-report-collab-spec.md:118-128`）。
  - Evidence: `src/app/sw.ts`, `src/lib/stores/offline-db.ts`, `src/lib/offline/crypto.ts`, `src/lib/offline/evidence-drafts.ts`。
- Assumption: 店内業務（調剤ワークベンチ、レセコン風 4 工程、F12→Enter キーボード操作）はデスクトップ PC 前提。Evidence: `src/app/(dashboard)/dispense/` ほかワークベンチ画面、ConfirmDialog autoFocus 設計（プロジェクト記憶）。明文の「デバイス要件書」は未発見 → Review required: 対応デバイス・最小画面幅の正式定義。

## 5. 患者情報・処方情報の範囲

- **患者**: 基本属性（Patient/Gender）、居所（Residence、施設種別 FacilityTypeEnum: nursing_home/group_home/assisted_living/clinic/hospital/day_service/home 等）、ケース（CareCase）、連絡先/家族（ContactParty）、ケアチーム（CareTeamLink）、患者状態（PatientCondition）、同意（ConsentRecord）、薬学的管理指導計画（ManagementPlan）、保険（PatientInsurance、医療/介護 InsuranceType）、検査値（PatientLabObservation、腎機能等 LabAnalyteCode）、医療処置（PatientMedicalProcedure）、麻薬使用（PatientNarcoticUse）、包装プロファイル。
  - Evidence: `prisma/schema/patient.prisma:1-660`、`prisma/schema/organization.prisma:10-21`。
- **処方**: 処方取込（PrescriptionIntake、紙/QR/電子処方箋の PrescriptionSourceType）、処方行（PrescriptionLine）、調剤サイクル（MedicationCycle）、QR 読取ドラフト（QrScanDraft、JAHIS 電子お薬手帳 Ver.2.5 = D-01）、JAHIS 補足レコード。
  - Evidence: `prisma/schema/prescription.prisma:1-640`、`docs/decisions.md` D-01。
- **服薬・残薬**: MedicationProfile / ResidualMedication / 服薬在庫イベント・スナップショット / MedicationIssue / Intervention。
  - Evidence: `prisma/schema/medication.prisma:179-467`。
- **薬歴に相当する記録**: 訪問記録の構造化 SOAP（薬学的評価シート 7 項目）+ レガシー文字列 SOAP の二重保存（canonical 化は将来 P7）。
  - Evidence: `prisma/schema/visit.prisma:216-228`、`docs/visit-report-collab-spec.md:201`。
- 全データは要配慮個人情報（APPI）として扱い、端末保持 PHI は AES-GCM 暗号化・鍵欠如 fail-close（`docs/visit-report-collab-spec.md:135,229-231`、`src/lib/offline/crypto.ts`）。

## 6. 薬歴・調剤・会計・請求・在宅・フォローアップの対象範囲

- **薬歴**: 訪問記録内の structured_soap が実質の薬歴 SSOT。法定記載 6 項目の網羅強制・オン資取得薬剤情報欄は**未実装（仕様のギャップ項目）**（`docs/visit-report-collab-spec.md:24`）。独立した「薬歴簿」画面/モデルは未発見。Assumption: 薬歴＝訪問記録+報告書+服薬記録の複合で構成する設計。Review required: 薬機法/調剤録・薬歴の法定要件との対応表。
- **調剤**: レセコン風 4 工程ワークベンチ（調剤→調剤監査→セット→セット監査）で `/dispense` `/audit` `/set` `/set-audit` を置換済（プロジェクト記憶 chouzai-workbench-replacement、`src/app/(dashboard)/workflow/`、DispenseAuditResult/SetAuditResult/RejectCode enum `prisma/schema/prescription.prisma:29-79`）。工程権限はフラグ制御（D-08）。
- **会計**: 患者請求・集金（支払者=本人/家族/代理人/その他、続柄必須バリデーション `src/lib/validations/billing-collection.ts:208`）。Assumption: レジ・POS 的な窓口会計機能はなく、集金記録が主。Review required: 会計業務の正確なスコープ。
- **請求（レセプト算定）**: 自動算定せず「候補表示 + 3 層バリデーション」（D-05）。BillingRule/BillingCandidate/BillingEvidence + billing-requirement-validator。対象算定は居宅療養管理指導費（介護）+ 在宅患者訪問薬剤管理指導料（医療）で、32 要件中 充足5/部分16/未充足11 と自己評価されている（`docs/visit-report-collab-spec.md:15-51`）。レセプト摘要欄文字列（ClaimRecord）は**計画のみ**（同 :34,327）。算定数値は告示原文未確認のものは fail-close 方針（同 :87-93）。
- **在宅**: 訪問スケジュール（VisitSchedule、施設一括 FacilityVisitBatch）、ルート最適化（Google Routes API = D-10）、訪問前準備（VisitPreparation）、医師指示（VisitInstruction、有効期間付き — schema 実装済 `prisma/schema/visit.prisma:248-278`）、特別患者ステータス（SpecialPatientStatus、がん末期等 — schema 実装済 同 :280-308）。
- **フォローアップ**: 患者自己報告（PatientSelfReport）、トレーシングレポート（TracingReport）、服薬フォロー系の communication-requests、次回訪問提案日（VisitRecord.next_visit_suggestion_date）。
  - Evidence: `prisma/schema/communication.prisma:613,636`、`prisma/schema/visit.prisma:224`。

## 7. 記録の保存・確定・承認・修正・監査の流れ

- **確定（finalize）**: CareReport に finalized_at/finalized_by + locked_at/locked_by + 薬剤師免許スナップショット（finalized_pharmacist_credential_*）+ content_hash/pdf_hash が**実装済**（`prisma/schema/communication.prisma:418-437`）。ReportStatus = draft/sent/failed/confirmed/response_waiting（同 :11-17）。
- **修正・取消**: CareReportRevision（版管理）、unlocked_at/unlocked_by/unlock_reason（限定 un-lock）、voided_at/void_reason（無効化）（同 :433-441,465）。確定後訂正ワークフローの UI/運用は仕様 P4 の範囲（`docs/visit-report-collab-spec.md:307-308`）。
- **承認（maker/checker）**: 調剤は二重チェック工程（調剤者と監査者の分離: pharmacist_trainee は監査不可 `permission-matrix.ts:86-99`）。報告書は薬剤師のみ作成・確定（canAuthorReport、`docs/visit-report-collab-spec.md:50`）。
- **同時編集**: 楽観ロック（version + 409 Conflict = D-14、VisitRecord.version `prisma/schema/visit.prisma:232`）。
- **監査**: AuditLog（全操作）+ AuditLogReview（監査ログの定期レビュー台帳）+ AWS CloudTrail。監査ログ保存 5 年方針（`prisma/schema/admin.prisma:189-237`、`docs/visit-report-collab-spec.md:223`）。
- **保存**: 確定 PDF は S3 Object Lock（WORM）。保存年限は現状「一律 5 年方針」で、医療 3 年/介護完結後 2 年/自治体指定の起算点別 retention は**未実装（仕様ギャップ RPT-002）**（`docs/visit-report-collab-spec.md:25,215-223`）。電子署名・認定 TSA は未実装・将来 P8（同 :48,225-226）。
- Review required: 真正性 3 基準（MHLW v6.0 第7章）への適合宣言は、確定後訂正ワークフロー・retention 構造化の実装完了と専門家レビューを待つこと（仕様自身が partial と自己評価 同 :45）。

## 8. 電子処方箋・オンライン資格確認・レセプトとの関係（実装済か計画か）

| 連携 | 状態 | Evidence |
| --- | --- | --- |
| 電子処方箋管理サービス | **契約(IF)のみ実装、実接続は Phase 3 予定。現状 provider='stub'**（'mhlw' は未接続の設定値） | `src/server/adapters/e-prescription/index.ts:11-12,271,499-502`、UI/API は `src/app/api/patients/[id]/prescriptions/e-prescription/route.ts` |
| オンライン資格確認 | **同上（stub、Phase 3 で実接続予定）** | `src/server/adapters/qualification-check/index.ts:6-7,133,247-250`、`src/app/api/patients/[id]/qualification-check/route.ts` |
| レセプト（レセコン連携） | **claims-export アダプタ。provider='stub'\|'rececom'、未設定時 stub フォールバック**。PH-OS 自身はレセプト電算出力を持たず候補+根拠を出す設計（D-05/D-12 責任分界） | `src/server/adapters/claims-export/index.ts:65,211-254`、`prisma/schema/admin.prisma:388`（SourceOfTruthMatrix） |
| 電子お薬手帳 | QR 読取（JAHIS Ver.2.5）は実装済（読取専用キャッシュ = D-04 Ph1a） | `docs/decisions.md` D-01/D-04、`prisma/schema/prescription.prisma:594-640`（QrScanDraft/JahisSupplementalRecord） |

- Assumption: 「実装済の外部実接続はゼロ（すべて stub アダプタ）」。FHIR/LINE/SMS/realtime アダプタも存在するが実接続状態は未確認（`src/server/adapters/`）。Review required: 各アダプタの本番接続計画と認証局・ベンダ選定。

## 9. 非常時・オフライン業務継続要件

- **オフライン（患家・移動中）**: PWA + Dexie + 暗号化下書き（SOAP/エビデンス/音声メモ）+ 同期エンジン（409 競合退避）+ オフライン専用ページ + 同期状況画面。
  - Evidence: `src/lib/stores/offline-db.ts`、`src/lib/offline/`（crypto/evidence-drafts/voice-memo-drafts/cache-policy）、`src/app/offline/page.tsx`、`src/app/(dashboard)/offline-sync/`、`docs/visit-report-collab-spec.md:130-135` §2.4。
  - 端末鍵欠如時は fail-close（PHI を平文保持しない）。inbound の訪問前 prefetch は**計画（P6）**。
- **災害・障害時（事業者側 BCP）**: IT-BCP 文書 + RTO 4 時間/RPO 24 時間 + 年次復旧訓練 + 机上演習、バックアップ復旧ドリル手順。
  - Evidence: `docs/compliance/it-bcp.md`、`docs/compliance/three-ministry-guideline-mapping.md:90-92`、`docs/backup-recovery-drill.md`。
- **外部システム障害時の暫定運用**: SourceOfTruthMatrix と responsibility-matrix に entity 別の障害時暫定運用・復旧手順を定義。
  - Evidence: `docs/compliance/responsibility-matrix.md:10,23`。
- Review required: 「システム全停止時の紙運用への切替手順（薬局側 BCP）」はユーザー向け運用文書として未確認。UI 上の非常時モード（読み取り専用ミラー等）も未発見。

## 10. 患者安全へ直接影響する機能一覧（高リスク操作）

UI/UX 監査（Phase 5 の use-error risk register）で最優先に扱うべき操作:

1. **調剤監査・セット監査の合否判定**（DispenseAudit/SetAudit、差戻し RejectCode、pharmacist_trainee は監査不可）— `prisma/schema/prescription.prisma:29-79,341,471`
2. **疑義照会の記録と処方変更反映**（InquiryRecord）— `prisma/schema/prescription.prisma:257`
3. **CDS アラートの表示・抑制・無視**（相互作用/重複/アレルギー/腎/PIM/麻薬/日数上限。false-negative の害が最大）— `src/server/cds/checker.ts`
4. **訪問記録（構造化 SOAP）の完了ゲートと確定**（記載漏れ→臨床/算定双方に影響）— `src/lib/validations/structured-soap.ts`、`docs/visit-report-collab-spec.md:140-141`
5. **報告書の確定（finalize）・un-lock・void**（薬剤師免許束縛、確定後改ざん防止）— `prisma/schema/communication.prisma:418-441`
6. **オフライン下書きの同期競合解決**（409 退避。取り違え・消失リスク）— `src/app/(dashboard)/offline-sync/`、D-14
7. **サイクル保留/例外処理**（CycleHold/WorkflowException — 調剤中断・再開の取り違え）— `prisma/schema/prescription.prisma:546,571`
8. **麻薬関連**（PatientNarcoticUse、PCA ポンプレンタル・投与記録、麻薬区分 CDS）— `prisma/schema/patient.prisma:636`、`prisma/schema/pca-pump.prisma`
9. **残薬・服薬在庫の記録**（持参判定・服用量に影響）— `prisma/schema/medication.prisma:203-342`
10. **患者取り違え防止に関わる患者ヘッダ/検索**（PatientHeader は全画面共通の患者識別 SSOT）— `src/components/features/patients/`（プロジェクト記憶 careviax-patientheader-reuse）
11. **QR 読取による処方取込**（誤読・別患者への紐付け）— `src/app/(dashboard)/qr-scan/`
12. **破壊的操作の確認ダイアログ**（二重確認・autoFocusConfirm は F12→Enter 運用の意図設計）— `CLAUDE.md` エラー防止、ConfirmDialog
- **代理入力について**: 「事務による薬剤師記録の代理入力」機能は**未発見**。clerk は canAuthorReport=false で臨床記載を遮断し、薬剤師⇔事務の連絡は handoff ハブで行う設計（`src/lib/auth/permission-matrix.ts:106-109`、`prisma/schema/communication.prisma:709-733`）。Assumption: 代理入力は非対応が現仕様。Review required: 業務上の代理入力ニーズ（口頭指示の記録等）の要否。

## 11. 医療機器プログラム（SaMD）該当性を検討すべき機能

`src/server/cds/checker.ts`（`/api/cds/check` から呼出）に**実装済**の判定ロジック。AlertType enum（`prisma/schema/drug.prisma:13-23`）と対応:

| 機能 | 実装箇所 | 備考 |
| --- | --- | --- |
| 薬物相互作用チェック（禁忌=critical） | `checker.ts:585-660`（DrugInteraction マスタ照合） | PMDA 添付文書由来（`CLAUDE.md` マスタ表） |
| 重複投薬チェック | `checker.ts:689-706` | |
| アレルギー交差チェック（allergy_cross） | `checker.ts:1102-1219`（YJ 先頭7桁 prefix + name 照合、非構造 allergy_info は fail-visible） | false-negative 回避設計（プロジェクト記憶 careviax-cds-allergy-yj-ingredient-prefix） |
| 腎機能別用量アラート（renal_dose） | `checker.ts:1625-1710`（検査値 PatientLabObservation 連動） | JSNP 由来手動構造化データ |
| 高齢者 PIM アラート（pim_elderly） | `checker.ts:1546-1597` | 厚労省 PIM リスト由来 |
| ハイリスク薬・麻薬・投与日数上限 | `checker.ts:752,1268` ほか（is_high_risk/is_narcotic/max_days） | |
| 算定要件ゲート（claimable 判定） | billing-requirement-validator 系 | 診断/治療でなく事務判定 — SaMD 非該当の可能性が高いが整理は必要 |

- ルールは DrugAlertRule（hybrid org-scoped、FORCE RLS）でテナント管理可能（`prisma/schema/drug.prisma:203`）。
- **Review required（重要）**: 上記 CDS は「公知のマスタ照合 + 薬剤師の最終判断支援」であり、プログラム医療機器該当性ガイドライン上の該非判定（①疾病の診断・治療・予防への寄与、②リスク蓋然性）を薬事専門家がレビューすること。特に腎機能用量（患者検査値から個別患者への投与量調整を示唆）は該当性検討の優先度が高い。本 repo 内に該非判定文書は未発見（Phase 1 の `phase1/g6-appi-and-samd.md` が調査枠として存在 `docs/ui-ux-refresh/phase1/`）。
- Assumption: 現状のアラートは「情報提供 + 薬剤師判断」ポジションで、自動的な投与量計算・治療推奨は行っていない（checker.ts は照合とアラート生成のみ）。ただし UI 文言・表示強度によって位置づけが変わるため、Phase 5 監査で文言を精査する。

## 12. 専門家レビューが必要な領域（集約）

1. **算定要件の数値・解釈**（単位/点数/回数上限/間隔/加算、告示・留意事項通知の原文確認。未確定は fail-close 運用）— `docs/visit-report-collab-spec.md:337-352` 未決事項
2. **SaMD 該非判定**（CDS 全般、特に腎機能用量・アレルギー交差）— §11
3. **3省2GL 真正性・保存性の適合**（確定後訂正 WF、保存年限起算点、電子署名/TSA）— §7
4. **org-wide アクセスモデルのリスク受容の明文化**（アクセス最小化との整合）— §3.1
5. **APPI 第三者提供**（多職種共有 outbound/inbound/onward sharing の同意根拠）— `docs/visit-report-collab-spec.md:190-191,228-231`
6. **薬歴の法定要件対応**（調剤録・薬歴記載事項と structured_soap のマッピング）— §6
7. **オンライン資格確認・電子処方箋の実接続要件**（医療機関等向けセキュリティ、ベンダ選定）— §8
8. **薬局側 BCP（紙運用切替）の運用文書**— §9
9. **麻薬管理（PCA ポンプ・持続注射加算エビデンス）の業務適合**— §10、`docs/visit-report-collab-spec.md:39-41`

## 13. 未確定事項サマリ（Assumption / Review required 一覧）

| # | 種別 | 内容 | 参照 |
| --- | --- | --- | --- |
| A-1 | Assumption | 主対象は在宅業務。外来調剤はワークフロー上扱えるが算定スコープ外 | §2 |
| A-2 | Assumption | 店内ワークベンチはデスクトップ PC 前提（正式なデバイス要件書は未発見） | §4 |
| A-3 | Assumption | 外部実接続は全て stub（電子処方箋/オン資/レセコン/FHIR/SMS/LINE） | §8 |
| A-4 | Assumption | 代理入力機能は非対応が現仕様（handoff ハブで代替） | §10 |
| A-5 | Assumption | CDS は情報提供ポジション（自動治療推奨なし） | §11 |
| R-1 | Review required | 算定数値の告示原文確認（fail-close 運用の解除条件） | §12-1 |
| R-2 | Review required | SaMD 該非判定（薬事専門家） | §12-2 |
| R-3 | Review required | 3省2GL 真正性/保存性適合宣言（実装完了待ち） | §12-3 |
| R-4 | Review required | org-wide アクセスのリスク受容明文化 | §12-4 |
| R-5 | Review required | 薬歴の法定要件マッピング | §12-6 |
| R-6 | Review required | 会計業務・外来業務・デバイス要件の正式スコープ確定（業務側） | §2, §4, §6 |
