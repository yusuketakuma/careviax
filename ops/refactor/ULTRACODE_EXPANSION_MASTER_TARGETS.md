# Ultracode Expansion — Consolidated Master Target List — 2026-07-02

**目的**: 2026-07-02 の ultracode findings (F01-F78) を、Claude×Codex の相互レビューで拡張・炙り出した
修正対象の統合台帳。**read-only 成果物。実装はユーザー GO 後。**

## 由来と収束

| ラウンド           | 主体             | 成果                                                                     | ledger                                      |
| ------------------ | ---------------- | ------------------------------------------------------------------------ | ------------------------------------------- |
| 元                 | Claude(79-agent) | F01-F78 (57確定)                                                         | `ULTRACODE_FINDINGS_20260702.md`            |
| R1 拡張            | Claude workflow  | CE01-CE19 (19確定)                                                       | `ULTRACODE_EXPANSION_ROUND1_CLAUDE.md`      |
| R2 近接掃引        | Claude workflow  | N01-N33 (33確定、RLSクラスター爆発)                                      | `ULTRACODE_EXPANSION_ROUND2_CLAUDE.md`      |
| Codex独立          | Codex            | F79-F89 (11) + CXR候補11                                                 | `ULTRACODE_FINDINGS_20260702.md` 末尾 index |
| R1/R2 相互         | Codex            | Claude CE/N の cross-review + reconciliation                             | `ULTRACODE_EXPANSION_ROUND{1,2}_CODEX.md`   |
| Codex cross-review | **Claude**       | F79-F89 独立検証(9 CONFIRMED/2 PARTIAL/**0 REFUTED**) + neighbor X01-X13 | `ULTRACODE_CROSSREVIEW_CLAUDE_ON_CODEX.md`  |

**収束シグナル**: 相互 cross-review で確定項目の refute はゼロ。新規発見は R2 (RLS 33) → cross-review (13) → CXR(11) と逓減。
両者が同一欠陥に独立到達（例 X01↔CXR2-SEC01、X02↔CXR1-MSR01、N11↔F79、CE05↔F83）＝高信頼。

## Reconciliation（重複統合・実装前に保持）

- **CE05 ⊂ F83**: F83-create(重複pending) と CE05/F83-decision(承認却下race) に分割。CE05を独立3件目にしない。
- **N11 ⊂ F79**: FormularyTemplate RLS は F79 に内包。
- **N02 / N13 / N15 → 1クラスタ**: Facility/FacilityContact/ExternalProfessional の SSOT drift。
- **N04 / N09 → 1クラスタ**: PharmacyCooperationMessage/Thread SSOT drift。
- **N24 ≠ F77**: 同ファイル report-reminders.ts だが別欠陥(F77=unbounded OR / N24=JST月境界)。
- **X01 ↔ CXR2-SEC01**: GET /api/external-access の権限、両者独立到達。
- **X02 ↔ CXR1-MSR01**: CDS allergy 未解決スキップ、両者独立到達。

---

## EPIC 1 — DB テナント分離 / RLS ★最重要・flag（3省2ガイドライン準拠）

**根本原因**: `prisma/rls-policies.sql` SSOT と migration/failsafe に org-scoped 表を全網羅する検証が無い
(`src/tools/rls-policy-contract.test.ts` はハードコード allowlist)。→ **個別修正の前に RLS contract 再設計スライスを1本**（Codex 推奨 #2、Claude 同意）。

### 1a. RLS 完全欠落（migration にも SSOT にも RLS 無し = 本番でも DB層 backstop 欠如）

| ID         | テーブル                                         | 種別                                        | 備考                                                             |
| ---------- | ------------------------------------------------ | ------------------------------------------- | ---------------------------------------------------------------- |
| F79        | FormularyChangeRequest + FormularyTemplate(=N11) | org business config                         | 全consumer org_id filter済、latent backstop欠如(Claude: safety4) |
| N01        | PatientPackagingProfile                          | **患者PHI**                                 | 最重要。RLS皆無、Claude grep検証済                               |
| N06        | VisitScheduleOverride                            | 訪問scope                                   |                                                                  |
| N07        | VisitScheduleContactLog                          | 連絡記録                                    |                                                                  |
| N12        | FacilityUnit                                     | tenant master                               | 親Facilityと不整合                                               |
| N14        | BillingRule                                      | 請求                                        |                                                                  |
| N17        | PharmacySiteInsuranceConfig                      | 保険config                                  |                                                                  |
| N28        | PackagingMethodMaster                            |                                             |                                                                  |
| N29        | BusinessHoliday                                  |                                             |                                                                  |
| N33        | NotificationRule                                 |                                             |                                                                  |
| CXR2-RLS01 | PrescriberInstitution                            | **要design判定**(global master かも)        | 意図確認先行                                                     |
| CXR2-RLS02 | User                                             | **要design判定**(auth/global identity かも) | RLSバグ未確定、design review                                     |

### 1b. SSOT drift（migration は ENABLE+POLICY+FORCE 済、rls-policies.sql に 0 行 = SSOT/監査/再provision/contract-testのみ影響、完全migration本番は保護）

| ID          | テーブル                                                             |
| ----------- | -------------------------------------------------------------------- |
| CE04        | PatientSelfReport, CommunityActivity（FORCE のみ欠落、ENABLEは有り） |
| N02/N13/N15 | Facility, FacilityContact, ExternalProfessional                      |
| N03         | JahisSupplementalRecord（処方PHI、Claude grep検証済）                |
| N04/N09     | PharmacyCooperationMessage(+Thread)                                  |
| N05         | SavedView                                                            |
| N08         | PatientCondition（医療PHI）                                          |
| N31         | UatFeedback                                                          |

---

## EPIC 2 — CDS 医療安全 false-negative ★高・flag/fix

| ID         | 欠陥                                                                                                           | class     |
| ---------- | -------------------------------------------------------------------------------------------------------------- | --------- |
| F81        | checkInteractions/checkDuplicates が drug_master_id=null の現行薬を無言スキップ、data-quality alert 無し       | fix       |
| X02        | CDS allergy cross-check が drug_code=null の処方行を無言スキップ（name-based allergy match 抑制）              | flag high |
| X03        | 完全未解決の処方行が全 CDS check から脱落、identity-unresolved alert 無し（処方行版F81）                       | flag high |
| F82        | PatientCondition(problem-list) が CDS 禁忌チェックに渡らない（緑内障/重症筋無力症等）※renalは既カバー(X04参照) | flag      |
| X04        | checkRenalDoseAdjustment が eGFR 未記録時に silent-clean（coverage notice 無し）                               | fix       |
| X05        | 添付文書の禁忌/副作用/高齢者 alert が unsorted で slice(0,3) 切り捨て→臨床重要項目が落ちる                     | flag      |
| CXR1-MSR01 | CDS が legacy string/object allergy_info を無視（他コードは allergy-present 扱い）                             | flag      |
| CXR1-MSR02 | 手動 MedicationProfile が master_id と drug_name 不整合可、CDS は code照合だが name表示                        | flag      |

> 方針: 一致ロジックの厳格化より **「識別不能なので CDS 不完全」の data-quality alert 追加** が主。allergy は false-negative の害が桁違い([[careviax-cds-allergy-yj-ingredient-prefix]])。

---

## EPIC 3 — 認可 / 外部共有 / 患者識別 ★高・flag

| ID             | 欠陥                                                                                                                                         | Claude補正                                                                                                                |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| F80            | POST /api/external-access が canReport gate（canManagePatientSharing でない）→ pharmacist_trainee が medication_list/allergy 外部grant発行可 | 実行可能ロールは**trainee**(clerkはscope validationで既遮断)。score23                                                     |
| X01/CXR2-SEC01 | GET /api/external-access が canReport で全org grant列挙                                                                                      | grant発行と同権限問題                                                                                                     |
| F87            | prescriber-institutions/suggestion が patient_id/case_id を access check 無しで受理                                                          | **IDOR到達不可**に降格(canReportは設計上org-wide [[careviax-access-model-orgwide]])。残る実質はPHI no-store(X13)。score18 |
| F88            | care-reports の patient_id filter が q 検索の matched set で object-spread 上書き→同名別患者の報告書混入                                     | score22、確定                                                                                                             |
| F89            | QR match fetch失敗が no-match+新規患者CTA に化ける / capture が患者未確定でsave                                                              | captureのdraft.patientIdはsync時未使用でリスクは限定的(Claude補正)。QR側は要対応                                          |

---

## EPIC 4 — 並行性 / check-then-act ★中〜高・fix/flag

| ID          | 欠陥                                                                                                       |
| ----------- | ---------------------------------------------------------------------------------------------------------- |
| CE05/F83    | pharmacy-drug-stock-requests decision が id-only where（status再assert無し）+ create重複(non-unique index) |
| CE06        | dispense-results PATCH の version楽観ロックが update where から欠落                                        |
| F84         | ConsentRecord active重複が並行作成可（partial unique 無し）                                                |
| F85         | PatientInsurance active期間overlap が並行書込で保護なし                                                    |
| N16         | visit-billing-candidates generate が billing-lock を update where で再assertせず既請求candidate上書き      |
| N27         | pca-pump-rentals PATCH が別tx read後 id-only update                                                        |
| N32         | pca-pumps PATCH が open-rental/pending-inspection guard を FOR UPDATE 無しで read                          |
| X06         | communication-requests reply/queue dedup が tx外read-before-create                                         |
| X07         | visit-schedule-proposals duplicate-open guard が check-then-act                                            |
| X08         | management-plans "single approved per case" が DB制約無し+supersede非atomic                                |
| X09         | pharmacy-sites insurance-configs のperiod overlap check が tx外                                            |
| X10         | business-holidays 重複check が findFirst-then-create                                                       |
| CXR1-CONC01 | dispense-results partial_dispense WorkflowException 重複open可                                             |
| CXR1-CONC02 | patient-insurance の stale DELETE（他者修正後に消す）                                                      |

---

## EPIC 5 — タイムゾーン / 日付境界 ★中・fix

CE03, CE07(要contract判定: due_date=deadline instant か date-only sentinel か), CE08(@db.Date境界、CDS-FNとは呼ばない), CE09, CE10,
CE15, CE16, N19, N20, N24, N26, N30, CXR2-TZ01(operational-policy audit月), CXR2-TZ02(monthly jobs)
→ **helper/列型で束ねる**: japanDayInstantRange / japanMonthInstantRange / utcDateFromLocalKey(@db.Date) / getUTC\*(recurrence)。

---

## EPIC 6 — FE false-empty / offline 信頼性 ★中・fix

- **false-empty(残)**: N10(admin/realtime 上部KPI), N22(notifications 未同期行), CXR2-FE01(evidence gallery)
- **PCA安全ゲート**: CE01(返却検品待ちquery崩壊→未検品ポンプ再貸出) ★safety5
- **visit readiness**: CE02(prep失敗でchecklist偽完了) ★safety5
- **offline lifecycle epic**(Codex推奨#3): CE12(reconnectでprocessSyncQueue未呼), CE13(sync store未bootstrap→偽「同期済み」), CE14(scope_id dedup無し重複queue), N21(evidence draft page-scoped sync), N25(MAX_RETRIES stuck), F89-capture
- ※ 元 F14/F27(cockpit rail) は **commit abde9163 で修正済**

---

## EPIC 7 — セキュリティ / no-store（secret/PHI キャッシュ）★中・flag

| ID  | endpoint                                                             |
| --- | -------------------------------------------------------------------- | ------- |
| F86 | webhook 署名secret 201応答が cacheable                               | score24 |
| X11 | /api/me/mfa/setup が TOTP secret を no-store 無しで返す              |
| X12 | /api/me/mfa/verify が one-time recovery codes を no-store 無しで返す |
| X13 | prescriber-institutions/[id] GET が患者名(PHI)を no-store 無しで返す |

> Codex推奨: route-catalog 単位の no-store/PHI-audit ポリシー epic。

---

## EPIC 8 — パフォーマンス（unbounded / latest-per-group / N+1）★低〜中・fix

CE11(inventory-forecast), N18(set-plans全件DL), N23(dispense-workbench), N17(daily expiry job), CXR2-PERF01(medication-sets workspace)

- 元 F34/F43/F45/F46/F70/F73/F74/F76/F77。→ ranking/tie-break equivalence test 付きで束ねる。

---

## 既に commit 済み（本ループ内、緑gated、保持）

- `6a63f247` drug-masters formulary fail-close（Slice C、Claude承認済）
- `abde9163` cockpit rail fail-close（元 F14/F27）
- `c6f8e2a9` medications allergy fetch surface / `27124fee` safety banner fetch surface（Slice A/B）

## 実装ガードレール（着手時）

1. **flag クラス（RLS/auth/security/migration/PHI/並行）は BLOCKED.md ハードストップ → 人間承認必須。**
2. EPIC 1 は個別行の前に **RLS contract 再設計スライス**（漏れ再発防止）。
3. maker/checker 分離、objective gate（lint/typecheck/test/build）、1スライス1コミット、LOCK 規律。
4. CXR2-RLS01/RLS02 は **design判定先行**（global master/auth identity なら RLS 不要=非バグ）。
5. TZ/offline/perf は epic 単位で helper/lifecycle をまとめて。
