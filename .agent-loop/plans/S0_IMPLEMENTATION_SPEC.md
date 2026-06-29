# S0 Implementation Spec — 調剤Workbench 不可逆Sign-off ConfirmDialog Gating

> ultracode設計WF(w5d1npwvq, 11 agents)成果。recon 5/5 / 敵対blocker+major=11。codex PLAN_REVIEW用 zero-gap spec。
> 生成: 2026-06-28 / status: 実装前(codex壁打ち待ち)

---

All load-bearing claims verified against source. Confirmed: `primary()` does `set({target:null})` at store.ts:601 (pre-dialog store mutation), real-data `onPrimary` returns null at :1112 while demo returns `next` at :1115, setp matches no real-data branch, and `confirm-dialog.tsx` has no ref/onKeyDown/autoFocus wiring. Here is the integrated final spec.

---

# S0 Final Implementation Spec — 調剤Workbench 不可逆Sign-off ConfirmDialog Gating (zero-gap, adversarial-reconciled)

`[VERIFIED]` = re-read from source this pass. Line numbers from `use-workbench-write-handlers.ts` current HEAD.

## 1. CORRECTIONS — finding-by-finding 決着

### C1. 「onPrimary は常に null を返す」は事実誤認 → **採用(訂正)**

`[VERIFIED]` `onPrimary` (`:1003-1116`) は `isRealDataEnabled()` のときのみ null を返す。real-data では gate-ok の `next` が truthy でも内部 mutate 分岐後 `:1112 return null`、demo は real-data ブロックを丸ごとスキップし `:1115 return next`。

- **訂正**: F12経路の `dispensing-workbench.tsx:278 `if (nextPhase) router.push`は撤去しない**。real-data では`onPrimary`が null を返すので :278 は自然に no-op（confirm→commit の`onAdvance`が遷移を担う）。demo では従来どおり`next` を返し :278 が遷移する。二重 push は構造上発生しない。
- **demo の confirm 適用範囲**: onRequestConfirm/commit 配線は **real-data ブロック内のみ**。demo は confirm なしで従来の 1-key F12 を維持し、これを muscle-memory の reference baseline とする。→ OPEN-Q1（demo も gating すべきか）は codex 裁定。

### C2. setp の制御フロー読み違い + 可逆性 → **採用 / S0スコープ外(option b)を既定化**

`[VERIFIED]` real-data で setp は dispense/audit/seta いずれの else-if にも該当せず `:1112 return null` に落ちる（`:1115` 到達は demo のみ）。元spec Site4 の「`:1115 return next`」前提は demo-only 読みで誤り。さらに setp→seta は mutation 無・未永続=可逆（`store.ts:586-603` は gate-ok で `set({target:null})`＋`NEXT_PHASE` 返却のみ、`:601`）。

- **決定**: **setp は S0 から除外**。理由: (1) 制約#1「不可逆 sign-off」に該当しない、(2) 可逆ナビへ confirm は muscle-memory レンズ上の退行、(3) real-data では return-value ナビに乗っておらず onAdvance 未結線のため confirm 化は別途配線新設が必要でコスト過大。Site 4 は「実装しない（理由付き除外）」に格下げ。視覚的工程統一が必要なら別 S。

### C3. golden-image baseline 不在・撮影順序未規定 → **採用(必須手順化)**

`[VERIFIED]` `tools/tests/ui-visual-regression.spec.ts` は dashboard/patients/report のみ。保護4route の baseline は存在しない。Playwright `toHaveScreenshot` は baseline 欠如時に初回自動生成するため、配線変更と同一 commit で初回実行すると「改変後 vs 改変後」になり不変性を一切証明しない。

- **訂正(必須手順)**:
  1. **未改変 HEAD** で `/dispense /audit /set /set-audit` の**閉状態** baseline を `--update-snapshots` で生成し**独立 commit**（実装 commit と物理分離。git stash 往復ではなく別 commit 推奨）。
  2. その後に Site 実装。
  3. open状態スナップショット（dispense / audit麻薬 / audit非麻薬 / seta）は**実装後 commit**で追加。

### C4. StatusClock 等の live 領域が mask 未列挙 → **採用**

`[VERIFIED]` `dispensing-workbench.tsx:67-70` の `StatusClock` が tick で `setClock(formatClock(new Date()))` を更新し chrome 内（`:440` 付近）に描画。未 mask だと閉状態 baseline が常に差分化し不変 gate が機能しない。

- **訂正**: 撮影前に StatusClock（及び患者リボン内の時刻表示）へ `data-testid` を付与し、`toHaveScreenshot(..., { mask: [page.getByTestId('wb-status-clock'), ...] })` で pre/post 同一 mask。患者名/数量等の非決定領域も mask。

### C5. `primary(phase)` が confirm 前に `set({target:null})` する → **採用(test前提を訂正)**

`[VERIFIED]` `store.ts:601` `set({ target: null })` が gate-ok で実行。request 段で `primary(phase)` を呼ぶ設計上、**ダイアログ表示前に選択セル target がクリアされる**。cancel しても target は復元されない。元spec test#3「store 状態無変化」は偽。

- **決定(既定)**: target は揮発 UI 選択状態（`store.ts:608` で persist 除外、PHI でも永続でもない）。`primary(phase)` は gate 判定＋`next` 算出に必須なので request 段に残す。**test#3 のアサーション対象を `done/audit/setCells/auditCells/checks/ng/cells` に限定し、target は除外**。spec から「store 状態無変化」の無条件表現を撤回し「**clinical/書込スライス無変化**」に置換。
- **UX nit**: cancel 後に選択ハイライトが消える。S0 許容（データ損失なし）。→ 完全 no-side-effect を求めるなら `primary` を pure-gate（`calcGate`+`NEXT_PHASE` だけ返す）と `clearTarget()` に分割し target クリアを commit 段へ移す。これは OPEN-Q2 として codex 裁定（既定は test 限定で据え置き）。

### C6. F-key window listener が modal 中も発火（背景遮断は嘘） → **採用(明示ガード追加)**

`[VERIFIED]` `dispensing-workbench.tsx:289-300` は window レベル、ガードは `e.key.startsWith('F')` のみで dialog open 状態を見ない。Radix AlertDialog の modal は focus trap/overlay のみで window keydown 伝播を止めない。→ confirm 表示中も F8-F11（`:264-274` の phase 直行 push）/ F12 再 request が生きる。

- **訂正**: spec の「modal が背景編集/再 request を遮断」根拠を撤回。**二重 mutate を防ぐのは modal ではなく request/commit 分割（mutate は commit でのみ発火）**。加えて `runAction`（または onKey）に **`pendingPrimary !== null` の間は F8-F12（phaseDispense/phaseAudit/phaseSet/phaseSetAudit/next）を no-op にするガード**を新設し、確認中の phase 離脱と F12 churn を抑止。pendingPrimary は `dispensing-workbench.tsx` の state なので `runAction` の dep に追加。

### C7. commitPrimary が version 再 snap するが検証 gate 再実行なし → **採用**

背景 `invalidateWorkbench` の refetch は modal 中も store を setState 差し替えしうる（modal が止めるのはユーザー編集のみ）。request-OK→commit-NG ペイロード送信の窓がある。

- **訂正**: `commitPrimary` で `snap()` 後、**payload collector 再実行に加えて issue collector（quantity/doubleCount/carryPacket）と writeContext 存在＋`primary(phase)` 相当 gate を再検証**。NG なら mutate せず `toast.error` + ダイアログ閉 + `setPendingPrimary(null)`。expected_version の 409 は最終防御として併存。

### C8. cancel/Escape で pendingPrimary が残る → **採用**

`[VERIFIED]` `confirm-dialog.tsx:53-56` `handleOpenChange` は inputValue のみ reset、pendingPrimary は親管理。

- **訂正**: component 側で `open={pendingPrimary !== null}` と `onOpenChange={(o) => { if (!o) setPendingPrimary(null); }}` を対で配線。

### C9. setAudit rejection / cellMutation(clear/hold) / createHold の BE-commit 経路 → **refute(検討済み除外として明記)**

これらは BE 書込だが可逆（`onReturnToSet`=clear、hold は解除可）かつ安全側（承認ではなく差戻し/保留）。制約#1「不可逆 sign-off」の対象外。S0 から除外で妥当。

- **訂正(completeness 記述)**: spec に「`setAudit({result:'rejected'})` / `cellMutation` clear/hold / `createHold` は BE-commit だが**可逆・安全側のため S0 不可逆 sign-off から検討の上除外**」と探索範囲を明記。

### C10. autoFocusConfirm の「button Enter で即確定」未検証 → **採用(belt-and-suspenders)**

`[VERIFIED]` `confirm-dialog.tsx:96-108` の `AlertDialogAction` に ref/onKeyDown 無し。`onOpenAutoFocus` も無い。

- **訂正**: 実装で (a) `AlertDialogContent` に `onOpenAutoFocus` を新設、(b) 確定ボタン/Input に明示 ref、(c) **`AlertDialogAction` にも `onKeyDown={(e)=>{ if(e.key==='Enter' && !isConfirmDisabled) handleConfirm() }}` を付与**（native button Enter 依存にしない）。test6 で focus→Enter を実検証。

### C11. 麻薬-only requiredConfirmText scope → **refute(肯定確認・現設計維持)**

4 site の props 精査の結果、requiredConfirmText は audit∧`narcoticLines.length>0` のみ。`calcGate(audit)` は全行 check を要求するため未 check 麻薬で承認到達不可＝麻薬は承認時必ず `narcoticLines` に含まれ scope 漏れなし。現設計維持。将来 requiredConfirmText を非麻薬へ広げる差分を回帰検出するテスト（test6）を残す。

---

## 2. 共通制御フロー（確定版）

`onPrimary()` を request/commit に分割。**保護グリッド（prescription-grid / medication-calendar-grid）は不変**。3経路は `handlers.onPrimary()` 呼び出しのまま。

### request 段（`onPrimary` 内、real-data ブロックのみ改修）

各 phase ブロック（dispense `:1015-1053` / audit `:1054-1081` / seta `:1082-1111`）で：

1. 既存前段ガードを**そのまま手前に残す**: `isAnyPending`(`:1004`)、`canSubmitRealPrimary`(`:1007`)、`primary(phase)` gate(`:1012`、target クリア副作用込み=C5)、phase 別 issue collector（quantity `:1022` / doubleCount `:1059` / carryPacket `:1086`）。検証 NG は従来どおり `toast.error` + `return null`（ダイアログ出さない）。
2. 検証 OK のとき **`mutations.X.mutate()` を呼ばず** `onRequestConfirm(descriptor)` を呼び `return null`。audit のみ `descriptor.narcoticLines = collectDispenseAuditDoubleCount(s)`（`:392-414` 再利用、`s.audit[did] && drug.isNarcotic` フィルタ済み）を同梱。
3. demo（real-data ブロック外）は不変 → `:1115 return next` → `dispensing-workbench.tsx:278` push。

### commit 段（`commitPrimary(descriptor)` 新規・hook が返す）

ダイアログ `onConfirm` からのみ呼ばれる：

1. `snap()` 再取得。
2. **C7: issue collector + writeContext 存在 + gate を再検証**。NG → `toast.error` + ダイアログ閉 + 親 `setPendingPrimary(null)`、return。
3. payload collector 再実行 → `mutations.X.mutate({..., expected_version: s.writeContext.cycleVersion}, { onSuccess: () => onAdvance?.(descriptor.next), onError: rollback })`。rollback は既存（`:1047-1051` / `:1075-1079` / `:1102-1108`）を移設。

### 配線

- `useWorkbenchWriteHandlers` に新パラメータ `onRequestConfirm(descriptor)`（既存 `onAdvance` と同要領）。
- `dispensing-workbench.tsx`: `const [pendingPrimary, setPendingPrimary] = useState<PendingPrimary | null>(null)`、`onRequestConfirm: setPendingPrimary`。
- ダイアログ: `open={pendingPrimary !== null}`、`onOpenChange={(o)=>{ if(!o) setPendingPrimary(null); }}`（C8）。
- **C6**: `runAction` に `if (pendingPrimary && ['phaseDispense','phaseAudit','phaseSet','phaseSetAudit','next'].includes(action)) return;` ガード。`pendingPrimary` を `runAction` の dep に追加。
- zustand store は変更しない。React Compiler: 手動 `useMemo`/`useCallback` 新設しない。

### 型（`dispensing-workbench.write-types.ts`）

```ts
type PendingPrimary =
  | { phase: 'dispense'; next: Phase }
  | { phase: 'audit'; next: Phase; narcoticLines: AuditNarcoticLine[] } // 空配列=非麻薬
  | { phase: 'seta'; next: Phase };
// setp は S0 除外（C2）。AuditNarcoticLine = collectDispenseAuditDoubleCount() 戻り要素
// (line_id/drug_name/dispensed_quantity/first_count/second_count) 再利用
```

---

## 3. 共有infra A — `confirm-dialog.tsx`（patient-safety overlay / 保護chromeではない）

`autoFocusConfirm?: boolean`（default `false`）を追加。default false で既存バッチ再生成ダイアログ（`dispensing-workbench.tsx:455-464`）を完全据え置き。

- `autoFocusConfirm === true && !requiredConfirmText`: `AlertDialogContent` に `onOpenAutoFocus={(e)=>{ e.preventDefault(); confirmBtnRef.current?.focus(); }}`。`AlertDialogAction` に ref + `onKeyDown(Enter && !isConfirmDisabled → handleConfirm)`（C10）。
- `autoFocusConfirm === true && requiredConfirmText`（麻薬）: `onOpenAutoFocus` で Input ref focus。Input に `onKeyDown(Enter && !e.nativeEvent.isComposing && !isConfirmDisabled → handleConfirm)`（IME 変換確定中の誤発火除外）。確定ボタンは text 一致まで disabled。
- Escape: Radix 既定 close→Cancel 維持（`preventDefault` 入れない）。
- `isConfirmDisabled`(`:50-51`)・`handleConfirm`(`:58-65`)・`handleOpenChange`(`:53-56`) は再利用。

---

## 4. Per-site 最終spec

### Site 1 — Dispense 完了

- **編集**: `use-workbench-write-handlers.ts:1037-1053`。`collectDispenseLines`/`completeDispense.mutate` を `commitPrimary` へ移設。`onPrimary` 内は `:1022-1036` quantity 検証を残し OK で `onRequestConfirm({ phase:'dispense', next })` + `return null`。
- **props**: `variant="destructive"`、`title="調剤を完了します"`、`description="調剤内容を確定し、監査工程へ進みます。確定後は取り消せません。"`、`confirmLabel="調剤完了"`、`cancelLabel="キャンセル"`、`requiredConfirmText` なし、`autoFocusConfirm`。
- **commit**: `snap()` → C7再検証 → `collectDispenseLines(s)` → `completeDispense.mutate({task_id, lines, expected_version}, {onSuccess:()=>onAdvance?.(next), onError: done を clearBooleanKeys(submittedLineIds)})`。
- **narcotic**: 対象外。
- **test**: 後述 1-6。**golden**: 閉=baseline不変、開=新 dispense overlay。

### Site 2 — Audit 承認 + 麻薬 double-confirm

- **編集**: `:1059-1081`。`collectDispenseAuditDoubleCountIssues` 検証(`:1059-1063`、NG=`toast.error(INVALID_AUDIT_DOUBLE_COUNT_MESSAGE)`+`return null`)を手前に残す。OK で `const narcoticLines = collectDispenseAuditDoubleCount(s)`(`:392-414`) → `onRequestConfirm({phase:'audit', next, narcoticLines})` + `return null`。`completeAudit.mutate`(`:1066-1081`) を `commitPrimary` へ移設。
- **麻薬配線**: `is_narcotic`(`from-api.ts:301`)→`Drug.isNarcotic`(`types.ts:151`)→collector が `s.audit[did] && drug.isNarcotic` フィルタ(`:399`)。`narcoticLines.length>0`=このバッチが麻薬を含むフラグ。
- **props 分岐**:
  - 共通: `variant="destructive"`、`confirmLabel="監査承認"`、`autoFocusConfirm`。
  - 非麻薬(`length===0`): `title="監査を承認します"`、`description="監査を承認し確定します。この操作は取り消せません。"`、`requiredConfirmText` なし。Enter 即確定。
  - 麻薬(`length>0`): `title="監査を承認します（麻薬を含む）"`、`requiredConfirmText="麻薬"`、`description="麻薬 ${narcoticLines.length} 件の二重計数を確認のうえ承認します。確定後は取り消せません。"`、`children`= **麻薬line のみ** 列挙（`drug_name`/`dispensed_quantity`/`first_count`/`second_count`、非麻薬line 不出）。autofocus=Input、Enter は Input から。
- **commit**: `snap()` → C7再検証 → `collectDispenseAuditDoubleCount(s)` 再計算 → `completeAudit.mutate({task_id, result:'approved', expected_version, ...(doubleCount.length>0?{double_count}:{})}, {onSuccess, onError: audit を clearBooleanKeys})`。
- **test**: 1-6（麻薬分岐 test5）。**golden**: 閉不変、開=audit麻薬 / audit非麻薬 の2枚。

### Site 3 — Set-audit 承認(seta)

- **編集**: `:1082-1111`。`carryPacketEvidence` 検証(`:1085-1091`、NG=`toast.error`+`return null`)を手前に残す。OK で `onRequestConfirm({phase:'seta', next})` + `return null`。`setAudit.mutate`(`:1092-1110`) を `commitPrimary` へ移設。
- **props**: `variant="destructive"`、`title="セット監査を承認します"`、`description="セット監査を承認し確定します。この操作は取り消せません。"`、`confirmLabel="セット監査承認"`、`autoFocusConfirm`、`requiredConfirmText` なし。
- **commit**: `snap()` → C7再検証 → `collectSetAuditChecklist`/`collectCarryPacketEvidence`/`collectSetAuditCellAudits(s,'ok')` 再計算 → `setAudit.mutate({plan_id, result:'approved', checklist, carry_packet_evidence, ...(cellAudits.length>0?{cell_audits}:{})}, {onSuccess, onError: auditCells/checks/ng を removePatientPrefixed})`。
- **narcotic**: 対象外。**golden**: 閉不変、開=seta overlay。

### Site 4 — setp→seta：**S0 除外（C2）**

mutation 無・未永続=可逆、real-data では return-value ナビに非結線。S0 不可逆 sign-off の対象外。実装しない。視覚統一が必要なら別 S で `variant="default"` 軽量 confirm を別配線で追加。

---

## 5. テスト計画（vitest + Playwright）

**vitest**（`use-workbench-write-handlers` を mutations mock で、`isRealDataEnabled()=true` に設定）site 1-3 各：

1. **前段ガード**: F12/primary 発火直後に `mutations.X.mutate` 未呼出、`onRequestConfirm` が descriptor 付き1回。
2. **confirm後のみ commit**: `commitPrimary(descriptor)` で `mutate` ちょうど1回、`expected_version` 含む正 payload。
3. **cancel/Escape**: ダイアログ閉で `mutate` 未発火、**clinical/書込スライス（done/audit/setCells/auditCells/checks/ng）無変化**（C5: target は除外）。`setPendingPrimary(null)` 呼出（C8）。
4. **検証NG非開**: quantity/doubleCount/carryPacket 欠如時 `onRequestConfirm` 未呼出・`toast.error` のみ。
5. **(audit)麻薬分岐**: 麻薬line含む audit で `descriptor.narcoticLines` が麻薬lineのみ、`requiredConfirmText="麻薬"`、children に麻薬 `drug_name`。非麻薬 audit は `requiredConfirmText` undefined・Enter 即確定。
6. **ConfirmDialog 単体**(`confirm-dialog.test`): `autoFocusConfirm` 無→確定ボタン focus・Enter確定 / 有→Input focus・一致時のみ Enter確定。`autoFocusConfirm` 未指定（バッチ再生成相当）で挙動不変。**F12→Enter 2キー**を固定し将来の非麻薬への requiredConfirmText 拡大を回帰検出（C11）。
7. **(C7)commit再検証**: commit直前に store を NG 状態へ差し替えると `mutate` 未発火・`toast.error`・`setPendingPrimary(null)`。
8. **(C6)F-keyガード**: `pendingPrimary != null` で F8-F12 が no-op。

**Playwright golden**（C3/C4 順序厳守）:

- step0(未改変HEAD・独立commit): `/dispense /audit /set /set-audit` 閉状態 baseline を `--update-snapshots`、`playwright.local.config.ts`(single worker)、`mask=[wb-status-clock, 患者リボン時刻, 非決定領域]`、`animations:'disabled', caret:'hide'`。real-data seed（麻薬line含む audit cycle、患者選択済み）で決定論描画を smoke 確認。
- step1(実装後commit): 閉状態 pre/post ピクセル同一を gate。開状態 overlay 新規追加（dispense / audit麻薬 / audit非麻薬 / seta）。既存バッチ再生成ダイアログ無変化を確認。

---

## 6. OPEN QUESTIONS（codex 裁定要）

- **Q1 (demo gating)**: confirm を real-data 限定にし demo は 1-key F12 を muscle-memory reference として残す（既定）か、demo も commit 経由に統一するか。後者は demo 用 mutate-less commit 分岐（`onAdvance` のみ）の新設が必要。
- **Q2 (target 副作用)**: `primary(phase)` の `set({target:null})`(store.ts:601) を request 段に残し test を書込スライス限定にする（既定・最小変更）か、`primary` を pure-gate＋`clearTarget()` に分割し target クリアを commit 段へ移す（cancel 後ハイライト維持・より純粋だが store API 変更）か。
- **Q3 (麻薬トークン文言)**: `requiredConfirmText="麻薬"` で確定か、施設運用で別トークン（例「承認」）か。1定数差し替え、scope（麻薬line children 列挙）は不変。
- **Q4 (setp 視覚統一)**: S0 で setp 除外（既定）。将来 4工程の確定UIを視覚的に揃える要求が出た場合、別 S で `variant="default"` 軽量 confirm を新配線で追加する方針でよいか。
- **Q5 (golden seed)**: 保護4route を決定論描画する real-data seed（麻薬line含む audit cycle 等）の owner/手順。`adapter.ts:71-79` の `USE_MOCK` 判定下で open snapshot に real-data が必須な点の解決策。

## 7. 実装パーティション（順序）

保護 workbench 共有ファイルが集中するため **単一 lane 逐次**を推奨（並列 worktree は同一 hook/component の競合で golden race を生む）。

1. **(独立commit A・実装前)** golden baseline: StatusClock 等に `data-testid` 付与 → 未改変ロジックで `/dispense /audit /set /set-audit` 閉 baseline を `--update-snapshots` で生成 commit。※ロジック不変、testid 付与のみ。
2. `confirm-dialog.tsx`: `autoFocusConfirm` + ref + onKeyDown（C10）。単体 test6。
3. `dispensing-workbench.write-types.ts`: `PendingPrimary`（setp 除外）。
4. `use-workbench-write-handlers.ts`: `onRequestConfirm` パラメータ追加、site 1-3 を request/commit 分割、`commitPrimary` 新設（C7 再検証込み）。vitest 1-5,7。
5. `dispensing-workbench.tsx`: `pendingPrimary` state、ダイアログ配線（C8）、`runAction` F-key ガード（C6）。**:278 router.push は撤去しない**。vitest8。
6. **(独立commit B・実装後)** 開状態 overlay snapshot 追加、閉状態 pre/post 同一 gate。

- **objective gate**: `pnpm lint`/`typecheck`/`typecheck:no-unused`/`format:check`/`test`/`build` + 保護4route の `test:e2e`(visual)。

## 8. NON-GOALS / YAGNI

- focus-ring 改修（UA focus nit、制約#1、S0 非束ね）。
- per-drug 個別 requiredConfirmText（単一固定トークン "麻薬" + children 列挙で十分）。
- dispense/seta への requiredConfirmText（麻薬非含、制約#5）。
- store スキーマ拡張（pendingPrimary は component useState + hook callback、zustand slice 追加せず）。
- バッチ再生成ダイアログ挙動変更（`autoFocusConfirm` default false で touch しない）。
- 新規 PHASE_ROUTE / API 変更（既存 collector/mutation 再利用）。
- 保護グリッド（prescription-grid / medication-calendar-grid）編集（callback 配線のみ、DOM 不変）。
- **setp confirm（C2 で S0 除外）**。
- setAudit rejection / cellMutation(clear/hold) / createHold の gating（C9: 可逆・安全側、検討の上除外）。

### 関連ファイル（絶対パス）

- `/Users/yusuke/workspace/careviax/src/components/ui/confirm-dialog.tsx`
- `/Users/yusuke/workspace/careviax/src/components/features/dispense-workbench/use-workbench-write-handlers.ts`
- `/Users/yusuke/workspace/careviax/src/components/features/dispense-workbench/dispensing-workbench.tsx`
- `/Users/yusuke/workspace/careviax/src/components/features/dispense-workbench/dispensing-workbench.store.ts`
- `/Users/yusuke/workspace/careviax/src/components/features/dispense-workbench/dispensing-workbench.write-types.ts`
- `/Users/yusuke/workspace/careviax/tools/tests/ui-visual-regression.spec.ts`
- `/Users/yusuke/workspace/careviax/playwright.local.config.ts`

---

## APPENDIX A — 元design spec(敵対レビュー前, 参考)

I have enough grounding. Here is the implementation spec.

---

# S0 Implementation Spec — 調剤Workbench 不可逆Sign-off ConfirmDialog Gating

## 設計の中核(全site共通の制御フロー)

現状 `onPrimary()`(`use-workbench-write-handlers.ts:1003-1116`)は **検証 → そのまま `mutations.X.mutate()`** を同期で実行する単一ファネル。F12(`dispensing-workbench.tsx:276-280` の `runAction('next')`)・処方グリッドの primary ボタン(`prescription-grid.tsx:401`)・カレンダー primary(`medication-calendar-grid.tsx:477-485`)の3経路すべてが `handlers.onPrimary()` に収束する。

confirm を「楽観更新/mutateの前段」に挟むため、`onPrimary` を **request / commit の2段** に割る。**保護グリッド(prescription-grid / medication-calendar-grid)は一切編集しない**(3経路は `handlers.onPrimary()` 呼び出しのまま据え置き → 保護chromeのDOM不変、golden-image安定)。

- **`onPrimary()` (= request 化)**: 既存の前段検証(`isAnyPending` 二重送信ガード `:1004`、`canSubmitRealPrimary` `:1007`、`primary(phase)` ゲート `:1012`、phase別の `collectDispenseQuantityIssues`/`collectDispenseAuditDoubleCountIssues`/`carryPacketEvidence` 検証)は **そのまま手前に残す**。検証 NG は従来どおり `toast.error` + `return null`(ダイアログは出さない)。検証 OK のとき、**`mutations.X.mutate()` を呼ぶ代わりに** `onRequestConfirm(descriptor)` を呼んでダイアログを開き、`return null`。
- **`commitPrimary(descriptor)` (新規・hookが返す)**: ダイアログの `onConfirm` からのみ呼ばれる。**confirm後に初めて** `snap()` で再取得 → phase別 collector を再実行 → `mutations.X.mutate({..., expected_version: s.writeContext.cycleVersion}, { onSuccess: ()=>onAdvance?.(next), onError: rollback })` を発火。再 `snap()` 採用理由: AlertDialog は modal で編集を遮断するが、背景の `invalidateWorkbench` で version が動く可能性があるため、commit 時点の version で送る(stale 409 回避)。
- **配線**: `useWorkbenchWriteHandlers` に `onRequestConfirm(descriptor)` を新パラメータとして渡す(既存 `onAdvance` と同じ要領)。component 側(`dispensing-workbench.tsx`)で `const [pendingPrimary, setPendingPrimary] = useState<PendingPrimary | null>(null)` を持ち、`onRequestConfirm: setPendingPrimary` を渡す。zustand store は変更しない。
- **F12経路の整理**: `dispensing-workbench.tsx:276-280` の `'next'` ケースは `onPrimary()` が常に `null` を返すようになるため、即時 `router.push` は撤去し、遷移は commit の `onAdvance` に一本化(他 nav ケースは不変)。
- **React Compiler**: `setPendingPrimary`/`commitPrimary`/descriptor 導出はすべて手動 `useMemo`/`useCallback` を新設しない。

## 共有infra A — `src/components/ui/confirm-dialog.tsx`(保護chromeではない / patient-safety overlay)

制約#4(確定ボタン autofocus・Enter確定・Escapeキャンセル)を満たすため、`autoFocusConfirm?: boolean`(default `false`)を追加。**default false にして既存のバッチ再生成ダイアログ(`dispensing-workbench.tsx:455-464`)の挙動を完全据え置き**(Radix AlertDialog 既定の Cancel フォーカスのまま)→ そのダイアログの golden-image は不変。

- `autoFocusConfirm === true && !requiredConfirmText`: `AlertDialogContent` の `onOpenAutoFocus={(e)=>{ e.preventDefault(); 確定ボタンrefにfocus }}`。AlertDialogAction は button なので Enter で即確定。
- `autoFocusConfirm === true && requiredConfirmText`(麻薬): `onOpenAutoFocus` で **Input ref に focus**(確定ボタンは text 一致まで `disabled`)。Input に `onKeyDown`: `Enter && !isComposing && !isConfirmDisabled → handleConfirm()`(IME変換確定中の誤発火を除外)。
- Escape: Radix AlertDialog 既定で close → Cancel。`preventDefault` を入れない(維持)。

`isConfirmDisabled`(`:50-51`)・`handleConfirm`(`:58-65`)は既存ロジックを再利用。

## 共有infra 型 — `dispensing-workbench.write-types.ts`

```ts
type PendingPrimary =
  | { phase: 'dispense'; next: Phase }
  | { phase: 'audit'; next: Phase; narcoticLines: AuditNarcoticLine[] } // 空配列=非麻薬
  | { phase: 'seta'; next: Phase }
  | { phase: 'setp'; next: Phase };
// AuditNarcoticLine は collectDispenseAuditDoubleCount() の戻り要素を再利用(line_id/drug_name/dispensed_quantity/first_count/second_count)
```

---

## Site 1 — Dispense phase completion(調剤完了)

- **編集対象**: `use-workbench-write-handlers.ts:1037-1053`(`phase==='dispense'` ブロック)。
- **挿入位置(前段)**: `collectDispenseLines(s)`/`mutations.completeDispense.mutate(...)`(`:1037-1053`)を **`commitPrimary` 側へ移設**。`onPrimary` 内は `:1022-1036` の `collectDispenseQuantityIssues` 検証を残し、検証 OK で `onRequestConfirm({ phase:'dispense', next })` を呼び `return null`。**mutate は confirm 後にのみ走る。**
- **ConfirmDialog props**:
  - `variant="destructive"`(工程確定=不可逆)
  - `title="調剤を完了します"`
  - `description="調剤内容を確定し、監査工程へ進みます。確定後は取り消せません。"`
  - `confirmLabel="調剤完了"` / `cancelLabel="キャンセル"`
  - `requiredConfirmText`: **なし**(単一confirm / F12 muscle-memory維持)
  - `autoFocusConfirm`(確定ボタンautofocus、Enter確定、Escapeキャンセル)
- **commit制御フロー**: `commitPrimary` で `snap()` → `collectDispenseLines(s)` → `mutations.completeDispense.mutate({ task_id, lines, expected_version: s.writeContext.cycleVersion }, { onSuccess: ()=>onAdvance?.(next), onError: ()=> done を clearBooleanKeys(submittedLineIds) でロールバック })`。ロールバック(`:1047-1051`)はそのまま移設。
- **narcotic**: 対象外(dispense phase に麻薬二重計数なし)。

## Site 2 — Audit approval(監査承認)+ 麻薬double-confirm

- **編集対象**: `use-workbench-write-handlers.ts:1059-1081`(`phase==='audit'` ブロック)。
- **挿入位置(前段)**: `collectDispenseAuditDoubleCountIssues(s)` 検証(`:1059-1063`)は**手前に残す**(NG は `toast.error(INVALID_AUDIT_DOUBLE_COUNT_MESSAGE)` + `return null`、ダイアログ出さない)。検証 OK で `const narcoticLines = collectDispenseAuditDoubleCount(s)`(`:392-414` を再利用)を計算し `onRequestConfirm({ phase:'audit', next, narcoticLines })`、`return null`。`completeAudit.mutate(...)`(`:1066-1081`)は **`commitPrimary` へ移設**。
- **麻薬判定の配線**: 入口 `is_narcotic`(`from-api.ts:301`)→ `Drug.isNarcotic`(`types.ts:151`)→ collector が `s.audit[did] && drug.isNarcotic` でフィルタ(`:399`)。`narcoticLines.length > 0` がそのまま「この監査バッチが麻薬を含むか」のフラグ。
- **ConfirmDialog props(分岐)**:
  - 共通: `variant="destructive"`、`title`= 麻薬時 `"監査を承認します（麻薬を含む）"` / 非麻薬時 `"監査を承認します"`、`confirmLabel="監査承認"`、`autoFocusConfirm`。
  - **非麻薬(`narcoticLines.length === 0`)**: `requiredConfirmText` **なし** → 単一confirm。`description="監査を承認し確定します。この操作は取り消せません。"`。Enter で即確定(F12 muscle-memory維持)。
  - **麻薬(`narcoticLines.length > 0`)**: 独立 double-confirm。
    - `requiredConfirmText="麻薬"`(固定トークン1つ。per-drug入力は課さない=回帰最小)
    - `description="麻薬 ${narcoticLines.length} 件の二重計数を確認のうえ承認します。確定後は取り消せません。"`
    - `children`: **麻薬lineのみ** を列挙(`narcoticLines.map` で `drug_name` / `dispensed_quantity` / `first_count` / `second_count` を読み戻し表示)。→ requiredConfirmText の scope が「麻薬lineの再確認」であることを children で明示。非麻薬lineは children に出さない。
    - autofocus は Input(確定ボタンは "麻薬" 一致まで disabled)、Enter は Input から確定。
- **commit制御フロー**: `commitPrimary` で `snap()` → `collectDispenseAuditDoubleCount(s)` 再計算 → `mutations.completeAudit.mutate({ task_id, result:'approved', expected_version, ...(doubleCount.length>0 ? { double_count: doubleCount } : {}) }, { onSuccess, onError: audit を clearBooleanKeys でロールバック })`(`:1066-1081` を移設)。

## Site 3 — Set-audit approval(セット監査承認 / seta)

- **編集対象**: `use-workbench-write-handlers.ts:1082-1111`(`phase==='seta'` ブロック)。
- **挿入位置(前段)**: `carryPacketEvidence` 検証(`:1085-1091`、NG は `toast.error` + `return null`)を手前に残す。OK で `onRequestConfirm({ phase:'seta', next })`、`return null`。`setAudit.mutate(...)`(`:1092-1110`)は **`commitPrimary` へ移設**。
- **ConfirmDialog props**:
  - `variant="destructive"`、`title="セット監査を承認します"`
  - `description="セット監査を承認し確定します。この操作は取り消せません。"`
  - `confirmLabel="セット監査承認"`、`autoFocusConfirm`、`requiredConfirmText`**なし**(単一confirm)
- **commit制御フロー**: `snap()` → `collectSetAuditChecklist`/`collectCarryPacketEvidence`/`collectSetAuditCellAudits(s,'ok')` 再計算 → `mutations.setAudit.mutate({ plan_id, result:'approved', checklist, carry_packet_evidence, ...(cellAudits.length>0 ? { cell_audits } : {}) }, { onSuccess, onError: auditCells/checks/ng を removePatientPrefixed でロールバック })`(`:1092-1110` 移設)。
- **narcotic**: 対象外(麻薬二重計数は audit phase のみ)。

## Site 4 — setp→seta advance(セット完了→監査へ)※ 可逆。要判断

- **状態**: 純 store ナビゲーション、**mutationなし・未永続=可逆**(`store.ts:586-603`、`logic.ts:531-536`)。`onPrimary`(`:1115`)は setp で `next='seta'` を返すのみ。
- **編集対象**: `use-workbench-write-handlers.ts:1112-1115` 周辺(setp は実データ分岐に入らず `return next`)。confirm を挟むなら `onRequestConfirm({ phase:'setp', next })`、`commitPrimary` は mutate せず `onAdvance?.(next)` のみ。
- **ConfirmDialog props(可逆ゆえ軽量)**:
  - `variant="default"`(**destructive にしない**=可逆操作に破壊的UIを当てない)
  - `title="セットを完了します"` / `description="セット内容を確定し、監査工程へ進みます。"`
  - `confirmLabel="セット完了"`、`autoFocusConfirm`、`requiredConfirmText`なし、`children`なし
- **判断保留**: 制約#1の「不可逆sign-off」に setp は厳密には該当しない(可逆)。**推奨: S0 では setp は variant=default の単一confirm に留めるか、または S0 スコープから外す**。下記「未解決の前提」参照。

---

## 想定テスト(vitest)

各 site(1-3)で(`use-workbench-write-handlers` を `mutations` モックでテスト):

1. **前段ガード**: F12/primary 発火直後に `mutations.X.mutate` が呼ばれない(`onRequestConfirm` が descriptor 付きで1回呼ばれる)。
2. **confirm後にのみ commit**: `commitPrimary(descriptor)` で `mutations.X.mutate` がちょうど1回、正しい payload(`expected_version` 含む)で呼ばれる。
3. **cancel/Escape**: ダイアログを閉じても `mutate` 未発火・store 状態無変化(commit前なのでロールバック不要)。
4. **検証NGはダイアログを開かない**: quantity issue / doubleCount issue / carryPacket 欠如時、`onRequestConfirm` 未呼出・`toast.error` のみ。
5. **(audit)麻薬分岐**: 麻薬line含む audit で descriptor.narcoticLines が麻薬lineのみ(非麻薬line不在)、`requiredConfirmText="麻薬"` 一致まで confirm disabled、children に麻薬 drug_name が並ぶ。非麻薬 audit では `requiredConfirmText` undefined・Enterで即確定。
6. **ConfirmDialog 単体**(`confirm-dialog.test`): `autoFocusConfirm` で `requiredConfirmText` 無→確定ボタン focus・Enter確定 / 有→Input focus・一致時のみ Enter確定。`autoFocusConfirm` 未指定(バッチ再生成相当)で挙動不変。

## Golden-image 前後比較(必須・制約#2)

- **対象画面**: 保護workbench 4route `/dispense` `/audit` `/set` `/set-audit`(`PHASE_ROUTE`)。
- **不変検証(最重要)**: ダイアログ**閉**状態の各 route が実装前後でピクセル同一(保護レセコンchrome restyle が無いことの証明)。`tools/tests/ui-visual-regression.spec.ts` の `toHaveScreenshot(name, { animations:'disabled', caret:'hide', mask:[...] })` パターン、`playwright.local.config.ts`(single worker)で。
- **新規overlay**: ダイアログ**開**状態を新スナップショットとして追加(dispense単一 / audit麻薬double / audit非麻薬 / seta / setp)。これは overlay であり保護chromeの上に乗るだけ。
- **既存バッチ再生成ダイアログ**: `autoFocusConfirm` default=false ゆえ無変化を golden で確認。

---

## RISK FLAGS

- **F12 muscle-memory回帰**: confirm 挿入で F12 1発確定 → F12+Enter の2アクションに変わる。非麻薬は `autoFocusConfirm`+Enter で 2キー連打に収め、麻薬のみ text入力を課す(制約#5)。**麻薬以外に requiredConfirmText を広げない**こと。F12→Enter の連続性をテスト6で担保。
- **保護chrome restyle**: ConfirmDialog は overlay であり `docs/ui-ux-design-guidelines.md:54` の保護レイアウトを触らない。**prescription-grid / medication-calendar-grid を編集しない**設計(store/grid不変、callbackで配線)を厳守。閉状態 golden 同一が gate。
- **optimistic順序**: cell チェック(`done`/`audit`/`setCells`)はインタラクション時に既に store へ入っており、sign-off の「楽観更新」は mutate+navigation のみ。confirm を mutate の直前に置けば制約#3を満たす。**`commitPrimary` で再 `snap()`** して stale `expected_version` による 409 を回避。
- **AlertDialog modal**: 開いている間は背景編集が遮断されるため descriptor と実 store の乖離は基本起きないが、background refetch 対策として commit 時再計算を採用。
- **二重送信**: `isAnyPending` ガード(`:1004`)は request 段で維持。加えてダイアログ open 中は再 request されない(modal)。

## YAGNI(今回やらない)

- **focus-ring 改修**: 制約#1。UA focus が存在する nit ゆえ S0 に束ねない。
- **per-drug 個別 requiredConfirmText**: 麻薬は単一固定トークン "麻薬" で十分。drug名ごとのタイピング強制は過剰(muscle-memory破壊)。children 列挙で再確認させれば足りる。
- **dispense/seta への requiredConfirmText**: 麻薬を含まないので double-confirm 不要(制約#5)。
- **store スキーマ拡張**: pendingPrimary は component `useState` + hook callback で足り、zustand へ slice 追加しない。
- **バッチ再生成ダイアログの挙動変更**: `autoFocusConfirm` を default false にして touch しない。
- **新規 PHASE_ROUTE / API 変更**: なし。既存 collector/mutation を再利用。

## 未解決の前提

- **setp の「不可逆」性**: recon上 setp→seta は**可逆**(mutation無・未永続)。制約#1「4つの不可逆sign-off」と矛盾。**要確認**: (a) setp も confirm 対象(可逆だが工程確定UIとして揃える)→ variant=default 軽量confirm、(b) S0 スコープを mutation-backed の3不可逆(dispense/audit/seta)に絞り setp は除外。本specは (a) を既定とし軽量版を提示、最終判断は承認者に委ねる。
- **recon found=false**: 今回の4 sign-off siteは全て `found=true`。未発見site由来の未確定事項はなし。ただし `use-workbench-view.ts` の `showAuditDoubleCount` 行番号が未特定(grep確認のみ)— 麻薬UI描画条件は audit phase + `isNarcotic` で確定済みのため spec への影響なし。
- **requiredConfirmText の文言**: "麻薬" を提案。施設運用で別トークン(例「承認」)を望む場合は1定数差し替えで対応可、scope(麻薬lineのみ children 列挙)は不変。
- **`onAdvance` の demo経路**: 非実データ(demo)時の遷移を commit の `onAdvance?.(next)` に一本化する前提。`onAdvance` が demo でも router.push に結線されていることの実装時確認が必要(現状 real-data の onSuccess のみで使用)。

関連ファイル(絶対パス):

- `/Users/yusuke/workspace/careviax/src/components/ui/confirm-dialog.tsx`
- `/Users/yusuke/workspace/careviax/src/components/features/dispense-workbench/use-workbench-write-handlers.ts`
- `/Users/yusuke/workspace/careviax/src/components/features/dispense-workbench/dispensing-workbench.tsx`
- `/Users/yusuke/workspace/careviax/src/components/features/dispense-workbench/dispensing-workbench.write-types.ts`
- `/Users/yusuke/workspace/careviax/tools/tests/ui-visual-regression.spec.ts`
- `/Users/yusuke/workspace/careviax/playwright.local.config.ts`

## APPENDIX B — 敵対レビュー findings(4レンズ raw)

```json
[
  {
    "lens": "網羅性（完全性）: 4 sign-offで全部か / 5つ目の不可逆 / BE-without-FE / 対象画面漏れ / found=false残存",
    "findings": [
      {
        "issue": "spec の F12 整理が誤った前提に立つ。『onPrimary() が常に null を返すようになるため :278 の即時 router.push を撤去』とあるが、`onPrimary` が null を返すのは `isRealDataEnabled()===true` のとき(かつ branch 一致時)だけ。mock/demo モード(`NEXT_PUBLIC_WORKBENCH_USE_REAL_DATA=mock|0`)では line 1115 `return next` に落ち、confirm も発火しない(onRequestConfirm は real-data ブロック内にしか無い)。:278 の push を撤去すると mock モードの F12 工程送りが無ナビになる(calendar-grid:69 の button 経路だけ生き残り F12 と非対称化)。spec の『常に null』は事実誤認。",
        "severity": "major",
        "evidence": "use-workbench-write-handlers.ts:1005(`if (isRealDataEnabled())`)〜1112(`return null`)〜1115(`return next`)。dispensing-workbench.tsx:276-280。adapter.ts:71-79(USE_MOCK 判定)。onRequestConfirm 挿入位置は spec 上すべて real-data branch 内。",
        "fix": "mock モードでも onRequestConfirm→commitPrimary→onAdvance に一本化するか、もしくは :278 の push は『next!=null のとき push』のまま残し real-data では onPrimary が null を返すので自然に no-op になる(=撤去不要)と明記する。少なくとも『常に null』表現を real-data 限定へ訂正。"
      },
      {
        "issue": "Site 4(setp)の制御フロー記述が mock 専用パスに基づいており real-data モードと矛盾。spec は『onPrimary(:1115) は setp で next=seta を返すのみ』とするが、real-data モードでは setp はどの branch にも一致せず line 1112 `return null` に落ちる。よって real-data の calendar-grid:69 `if(next) router.push` は発火せず、現状 setp→seta はリターン値ナビでは進まない。descriptor を作るには real-data ブロック内に setp 分岐を新設する必要があり、spec の『:1112-1115 周辺』『return next のみ』前提では実装位置を誤る。setp を S0 除外(option b)にしても real モードの return null 現状は変わらない。",
        "severity": "major",
        "evidence": "use-workbench-write-handlers.ts:1082(`else if (phase==='seta'`)→1111-1112(seta 以外は branch 無で `return null`)→1115(`return next`、mock のみ到達)。medication-calendar-grid.tsx:67-69。adapter.ts:84 コメント(set-audit は SetBatch 実装まで BFF 空集合ゲート=real 経路未到達の可能性)。",
        "fix": "setp の真の return 経路(real=1112 null / mock=1115 next)を spec に明記。confirm を入れるなら real-data ブロックに setp 分岐を追加し onRequestConfirm({phase:'setp'})→commitPrimary で onAdvance のみ。除外するなら『real モードでは setp は元々 1112 で null・ナビは別経路』を確認した上で判断と記す。"
      },
      {
        "issue": "BE-without-FE 経路の見落とし。`setAudit` には approval だけでなく per-cell の rejection(差戻し)書込があり、`result:'rejected'`/`reject_reason` を BE 確定するが confirm gating 対象外。spec は『今回の4 sign-off site は全て found=true・未確定事項なし』と完全性を主張する一方、この rejection mutation(および cellMutation の clear/hold)BE-commit 経路を考慮済み除外として明示していない。可逆(onReturnToSet で clear)かつ安全側操作ゆえ S0 除外は妥当だが、completeness 主張に対し『検討して除外した』記述が無い。",
        "severity": "minor",
        "evidence": "use-workbench-write-handlers.ts:1185-1213(NG セル→`buildRejectedSetAuditInput`→`mutations.setAudit.mutate`)、1594-1596(`result:'rejected', reject_reason, reject_reason_code`)、1223-1256(onReturnToSet=cellMutation clear)、1319(createHold)。spec『未解決の前提』節は approval 系4経路のみ列挙。",
        "fix": "spec に『setAudit rejection / cellMutation(clear/hold)/ createHold は BE-commit だが可逆・安全側のため S0 不可逆 sign-off から除外』と明示し、completeness の探索範囲を限定して記載する。"
      },
      {
        "issue": "golden-image 前後比較の前提が現状の visual-regression spec と乖離。spec は『tools/tests/ui-visual-regression.spec.ts の toHaveScreenshot パターンで保護workbench 4route の閉状態ピクセル同一を証明』とするが、同 spec は dashboard/patients-board/report-share/report-waiting の4枚のみで /dispense /audit /set /set-audit のベースラインを一切持たない。『前後比較で chrome 不変を証明』するには (a) main で新規ベースライン取得、(b) 各 phase + 麻薬 line + 患者選択済みの real-data シードで dialog-open 状態を描画、が必要。mock モードでは dialog が出ない(上記 finding)ため open snapshot は real-data 必須。これらの fixture/seed 要件が test 計画に欠落。",
        "severity": "major",
        "evidence": "tools/tests/ui-visual-regression.spec.ts:8-64(対象は dashboard/patients/report のみ、workbench route 不在)。adapter.ts:71-79(open snapshot には real-data 必要)。spec『Golden-image 前後比較』節は既存パターン流用とのみ記述。",
        "fix": "保護workbench 4route の閉状態ベースラインを実装前(main)に新規取得する手順、各 phase へ到達する real-data シード(麻薬 line を含む audit cycle 等)、dialog-open スナップショットの撮影方法を test 計画に明記。閉状態の『前』が存在しないと chrome 不変の証明が成立しない点を是正。"
      },
      {
        "issue": "autoFocusConfirm 非麻薬時の『確定ボタン focus → Enter で即確定』は AlertDialogContent への ref 配線が現状未存在で、ネイティブ button の Enter 起動に依存する。Radix AlertDialog の onOpenAutoFocus で preventDefault→action button へ focus 後、Enter が button onClick を発火する挙動は妥当だが、focus 移動先 button が disabled→enabled へ変わる麻薬分岐との一貫性、および AlertDialogContent 既定の onKeyDown(Escape のみ)との競合は実装時検証が要る。spec の『AlertDialogAction は button なので Enter で即確定』は未検証アサーション。",
        "severity": "nit",
        "evidence": "confirm-dialog.tsx:96-108(AlertDialogAction に ref/onKeyDown 無し)、:50-65(handleConfirm/isConfirmDisabled 既存)。spec『共有infra A』節。",
        "fix": "実装時に focus 後 Enter の即確定をテスト6で実機検証し、必要なら AlertDialogAction に明示 onKeyDown(Enter→handleConfirm)を付与。spec に『ネイティブ button Enter 起動に依存・要検証』と注記。"
      }
    ],
    "verdict": "needs-revision"
  },
  {
    "lens": "F12回帰 / 麻薬-only confirm scope の敵対的検証（requiredConfirmText誤適用・autofocus/Enter欠落・confirm多用によるmuscle-memory破壊）",
    "findings": [
      {
        "issue": "Demo(非実データ)モードのF12遷移が壊れる。spec は『F12経路の整理: onPrimary が常に null を返すようになるため即時 router.push を撤去し遷移を commit の onAdvance に一本化』とするが、実コードでは onRequestConfirm/commit 配線は全て `if (isRealDataEnabled())` ブロック内(handlers.ts:1015-1113)。demo では onPrimary は line 1115 `return next` を返し、dispensing-workbench.tsx:278 の `if (nextPhase) router.push` だけが遷移を担う。この router.push を撤去すると demo の F12 はどの phase でも遷移しなくなる(commit/onAdvance は real-data の onSuccess でしか呼ばれない=handlers.ts:1046/1074/1101, onAdvance定義は:116)。spec はこれを『onAdvance の demo経路…実装時確認が必要』と矮小化しているが、提案する編集そのものが demo F12 回帰を生む。",
        "severity": "major",
        "evidence": "src/components/features/dispense-workbench/use-workbench-write-handlers.ts:1015-1115 (return null は1112、return next は1113の}閉じ後の1115); dispensing-workbench.tsx:276-280; onAdvance=router.push は:116、呼出は onSuccess のみ(:1046/1074/1101)",
        "fix": "demo でも遷移を維持するため dispensing-workbench.tsx:278 の `if (nextPhase) router.push` は残す(real-data では onPrimary が null を返すので二重 push は起きない)。または onRequestConfirm 配線を isRealDataEnabled ブロックの外へ出し demo も confirm gating の対象にする。どちらかを spec で確定させる。"
      },
      {
        "issue": "setp の confirm 挿入が二重に破綻。(a)制約#1の『不可逆sign-off』に setp は該当しない(mutation無・未永続=可逆: store.ts:586-603)。可逆ナビゲーションに confirm を挟むことは、まさに本レンズが警戒する『confirm多用でF12高速運用のmuscle-memoryを壊す』典型。(b)spec は『setp は実データ分岐に入らず line 1115 return next、その周辺に onRequestConfirm を挿す』とするが、実コードでは real-data 時 setp は dispense/audit/seta いずれの else-if にも合致せず handlers.ts:1112 の `return null`(isRealDataEnabledブロック内)に落ちる。1115 に到達するのは demo のみ。つまり spec の挿入位置記述は recon の demo-only読みに引きずられており、real-data の setp 制御フローを取り違えている。",
        "severity": "major",
        "evidence": "use-workbench-write-handlers.ts:1015-1115(setp は else-if 三分岐に非該当→:1112 return null); recon が主張する『line 1115 return next for setp』は isRealDataEnabled()=false の時のみ到達; 可逆性: dispensing-workbench.store.ts:586-603 / logic.ts:531-536",
        "fix": "未解決の前提の選択肢(b)=『S0 スコープを mutation-backed の3不可逆(dispense/audit/seta)に絞り setp を除外』を既定とする。spec の現状既定(a 軽量confirm)は muscle-memory レンズ上は退行であり、かつ real-data の setp 制御フロー記述が誤っているため採用すべきでない。"
      },
      {
        "issue": "spec の二重送信ガードの根拠が事実誤認。spec『二重送信: …加えてダイアログ open 中は再 request されない(modal)』『AlertDialog modal: 開いている間は背景編集が遮断される』とするが、F-key の window keydown listener(dispensing-workbench.tsx:289-300)は window レベルかつガードが `e.key.startsWith('F')` のみで、ダイアログ open 状態を見ていない。Radix AlertDialog の modal は focus trap と Escape ハンドリングをするだけで、window に直付けされた F12 listener の発火は止めない。よってダイアログ表示中に F12 を再押下すると onPrimary→primary(phase)再評価→onRequestConfirm 再呼出(audit では narcoticLines 再計算/状態変化時 toast.error)が走る。結論(二重 mutate は起きない)は request/commit 分割のおかげで正しいが、spec が挙げる『modal が再 request を防ぐ』という根拠は誤り。",
        "severity": "minor",
        "evidence": "dispensing-workbench.tsx:289-300(window addEventListener('keydown'), 開閉状態の判定なし); confirm-dialog は Radix AlertDialog 既定(F-key 伝播を止める記述なし)",
        "fix": "spec の RISK FLAGS/二重送信節を『再 request を防ぐのは modal ではなく request/commit 分割(mutate は commit でのみ発火)』に訂正。任意で window keydown listener に『pendingPrimary 非null の間は next を無視』ガードを足し F12 連打の churn を抑制。"
      },
      {
        "issue": "commitPrimary が version 整合のため再 snap() するが、検証ゲート(collectDispenseQuantityIssues/collectDispenseAuditDoubleCountIssues/carryPacketEvidence/primary(phase)ゲート)を commit 時に再実行しない。spec 自身が『背景 invalidateWorkbench で version が動く可能性』を再 snap の根拠にしているのに、同じ background refetch がストア上の done/audit/cell データを差し替えると(modal は手動編集を遮断するが refetch 由来の setState は遮断しない)、request 時 OK→commit 時に本来 NG なペイロードが confirm 後に送信されうる。最終的には server の expected_version で 409 になる経路はあるが、検証は version より粒度が粗い。",
        "severity": "minor",
        "evidence": "spec『commit制御フロー』各 site(再 snap→payload collector 再実行のみ、issue collector の再検証は記述なし); 検証ロジックは onPrimary 前段にのみ存在(handlers.ts:1022/1059/1085)",
        "fix": "commitPrimary でも前段の issue collector(quantity/doubleCount/carryPacket)と primary(phase) ゲートを再実行し、NG なら mutate せず toast.error + ダイアログを閉じる(または descriptor を破棄)。"
      },
      {
        "issue": "(肯定的確認・否定的主張)麻薬のみ requiredConfirmText scope は正しく設計されている。全4 site の props を spec 上で精査し、requiredConfirmText が付与されるのは audit phase かつ narcoticLines.length>0 のみ。dispense/seta/setp は requiredConfirmText 無し=単一confirm で制約#5を満たす。麻薬判定は collectDispenseAuditDoubleCount(handlers.ts:392-414)が `s.audit[did] && drug.isNarcotic` でフィルタし audit phase 限定(:350-414)。calcGate(audit)が全行 check を要求するため未 check 麻薬で承認に到達できず、麻薬は承認時必ず narcoticLines に含まれる→scope に漏れなし。非麻薬への requiredConfirmText 誤適用は spec 記載範囲内・collector 実装範囲内では発見されなかった。",
        "severity": "nit",
        "evidence": "spec Site1-4 の ConfirmDialog props 列挙; handlers.ts:350-414(narcotic collector, audit限定); calcGate(audit) remain===0 要件(recon: logic.ts:413-501)。探索範囲=4 site の props + 麻薬 collector 2 関数 + gate。",
        "fix": "現設計を維持。実装時、autoFocusConfirm の destructive confirm ボタン autofocus + Enter は非麻薬経路を実質1キーストロークで通過させる(制約#4由来の意図的低摩擦)点を golden/test 6 で『F12→Enter の2キー』として固定し、将来 requiredConfirmText を非麻薬へ広げる差分を回帰として検出できるテストを残す。"
      }
    ],
    "verdict": "needs-revision"
  },
  {
    "lens": "保護chrome / golden-image（保護workbench視覚不変性の検証）",
    "findings": [
      {
        "issue": "golden-image『前後比較』の基準スナップショットが保護4routeに存在せず、捕捉順序も未規定。invariance gateが空証明になる。",
        "severity": "major",
        "evidence": "tools/tests/ui-visual-regression.spec.ts-snapshots/ に dashboard/patients/report の4枚のみ。/dispense /audit /set /set-audit の baseline は無い（`find tools/tests -name '*-snapshots'`で確認）。specの『不変検証(最重要): 実装前後でピクセル同一』は pre-change baseline を要するが、Playwright toHaveScreenshot は baseline 欠如時に初回実行で自動生成する。spec は新4routeの baseline を『未改変ツリー上で先に生成→commit→その後実装』する順序を明示していない（confirm-dialog配線とテスト追加を同一変更で行い初回実行すると、改変後ツリーから baseline 生成→改変後同士の比較となり不変性を何ら証明しない）。",
        "fix": "Site実装の前に、未改変HEADで4route×(閉状態)のbaselineを `--update-snapshots` で生成しcommitする手順をspecに固定化。実装はその後。openスナップショットは実装後追加で可。git stash往復 or 別commitで pre/post を物理分離することを必須手順として明記。"
      },
      {
        "issue": "保護workbench chromeに常時更新の live clock があり、閉状態goldenのmask対象として未列挙。『ピクセル同一』gateがclock差分で偽陽性化する。",
        "severity": "major",
        "evidence": "dispensing-workbench.tsx:67-70 StatusClock が `setClock(formatClock(new Date()))` を tick で更新、line 440 でchrome内に描画。spec の golden節は `mask:[...]` と placeholder のみで、保護4routeに固有の StatusClock(及び患者リボンの時刻系)を mask 対象として特定していない。既存テストは patients-board で `generatedAtMeta` を mask する前例があるが、保護routeのclockは秒/分更新のため未maskだと baseline と after が必ず差分化し、閉状態不変gateが機能しない。",
        "fix": "閉状態goldenの mask に StatusClock ノード(及び患者リボン内の時刻表示)を data-testid 付与の上で明示列挙。spec の `mask:[...]` を具体ノードに確定させ、clock を含む全動的領域を pre/post で同一 mask にする。"
      },
      {
        "issue": "Site 4(setp)の制御フロー読みが誤り。specは setp で onPrimary が :1115 `return next` と記すが、real-dataでは :1112 `return null` に落ちる。Site4配線の前提が崩れ、かつ全site共通の『onPrimaryは常にnullを返す』化により F12/calendar の return-value 駆動ナビと demo経路が回帰し得る。",
        "severity": "major",
        "evidence": "use-workbench-write-handlers.ts:1015 `if (isRealDataEnabled())` ブロック内に dispense(:1018)/audit(:1054)/seta(:1082) 分岐のみ存在。setp分岐は無く、:1112 `return null` は当ブロック内にあるため real-data の setp は :1115 ではなく :1112 で null を返す。medication-calendar-grid.tsx:67-69 は `const next = handlers.onPrimary(); if (next) router.push(...)` と return値のみでナビゲートし onAdvance を受け取らない。spec の『未解決の前提: onAdvance は現状 real-data onSuccess のみで使用』はこの穴を一部自認しているが Site4 の行番号根拠(:1115 return next)自体が事実誤認で、demo経路と calendar setp のナビは onAdvance 未結線のまま回帰する。lens外だが設計の実装可否に直結。",
        "fix": "(1) spec Site4の根拠を :1112(real-data setpはnull)へ訂正。(2) onPrimaryをnull化する全siteで、F12(runAction 'next')と calendar handlePrimary の return-value 駆動ナビが commit の onAdvance に確実に置換されることを demo/real 双方で配線確認する手順を『未解決』から『必須実装タスク』へ格上げ。setp は『S0スコープ外(可逆)』に倒す案(b)が回帰面を最小化。"
      },
      {
        "issue": "保護4routeが golden 撮影に足る決定論的データ(患者/薬剤/task)を描画できるか未検証。gateの実行可能性リスク。",
        "severity": "minor",
        "evidence": "既存visual testは seed済みの /dashboard /patients /reports のみ対象(ui-visual-regression.spec.ts:9-68)。保護route(/dispense等)は writeContext.taskId/cycleVersion 等の実データ依存(write-handlers.ts:1019-1021等)で、openStableRoute で安定描画できるかは本spec/既存テストの探索範囲では未確認。",
        "fix": "baseline生成前に4routeが seed データで決定論描画されることを smoke 確認。非決定領域(患者名/時刻/数量)は mask へ。"
      }
    ],
    "verdict": "needs-revision"
  },
  {
    "lens": "楽観更新順序: confirmがmutation/optimistic updateの真の前段か、承認前副作用・cancel rollback漏れ・二重発火",
    "findings": [
      {
        "issue": "spec の中核前提『primary(phase) は純粋ゲートで、confirm 前に store 副作用は無い／cancel時 store状態無変化(test #3)』が事実に反する。store.primary(phase) は gate 通過時に set({ target: null }) を実行する store mutation を含む(store.ts:601)。spec は onPrimary の request 段で primary(phase) を呼んでから dialog を開く設計(use-workbench-write-handlers.ts:1012)なので、確認ダイアログが出る前に target(選択セル)が既に null へ変更される。ユーザーが cancel/Escape しても target は復元されず、『commit前なのでロールバック不要・store状態無変化』という想定テスト#3のアサーションは偽。これは『楽観更新は mutate+navigation のみ』『confirm を mutate の前段に置けば制約#3を満たす』というレンズ核心の主張への直接的 refute。",
        "severity": "major",
        "evidence": "store.ts:601 `set({ target: null })`(primary実装内、gate.ok後)。呼び出しは use-workbench-write-handlers.ts:1012 `const next = primary(phase)`。spec『想定テスト3: cancel/Escape → store状態無変化』『RISK FLAGS optimistic順序: sign-offの楽観更新はmutate+navigationのみ』と矛盾。",
        "fix": "(a) target クリアを request 段から外し commit 段へ移す(gate判定だけを行う純粋関数を分離)か、(b) target はセル選択の一時UI状態であり PHI mutation でない点を明記し、test#3 のアサーション対象を done/audit/setCells/cells スライスに限定して target 変化を除外する。最小変更なら(b)＋spec から『store状態無変化』の無条件表現を撤回。"
      },
      {
        "issue": "F12経路の整理で『onPrimary() が常に null を返すため dispensing-workbench.tsx:278 の即時 router.push を撤去』とあるが、onPrimary が null を返すのは実データ(isRealDataEnabled())時のみ。既定の demo/モックモード(ファイル先頭コメント:8 が default)では real-data ブロックに入らず line 1115 で next を返す。demo では mutation が無く onSuccess も発火しないため onAdvance(dispensing-workbench.tsx:116 で無条件配線)も呼ばれない。よって demo の F12 前進ナビは line 278 の return 値依存。278 を撤去すると demo の dispense/audit/seta 前進が無反応になる回帰。spec の前提『常に null』が偽。",
        "severity": "major",
        "evidence": "use-workbench-write-handlers.ts:1112(real-data return null) vs :1115(demo return next)。dispensing-workbench.tsx:277-278(F12→push)、:116(onAdvance=router.push、onSuccess経由のみ呼出)。medication-calendar-grid.tsx:67-69 は return 値で push。spec『F12経路の整理: 即時 router.push は撤去』。",
        "fix": "line 278 は撤去しない。demo は confirm 無しで従来通り next を返し 278 で遷移、real-data は null+commit onAdvance、という二経路を spec に明記。または demo でも commit を通すなら sites1-3 の commitPrimary に demo分岐(mutate せず onAdvance)を定義する。"
      },
      {
        "issue": "spec は『AlertDialog modal で背景編集が遮断される』『二重送信: ダイアログ open 中は再 request されない(modal)』を二重発火対策の根拠にしているが、F-key リスナーは window レベル(dispensing-workbench.tsx:289-300)で登録され、Radix AlertDialog の modal は focus trap/overlay でポインタは塞ぐが window keydown 伝播は止めない。よって不可逆 confirm ダイアログ表示中も F8-F11(phaseDispense/audit/setp/seta の router.push 直行 :265-274)と F12 再トリガが生きる。確認中に別 phase へ離脱でき pendingPrimary が宙吊りになる/患者安全ゲートの趣旨を損なう。F12 再押下は request 段で再 onRequestConfirm を呼ぶ(idempotent だが spec の『再requestされない』は偽)。",
        "severity": "major",
        "evidence": "dispensing-workbench.tsx:289-300(window.addEventListener keydown, runActionへ)、:264-274(F8-F11が無条件 router.push)。spec『RISK FLAGS AlertDialog modal: 背景編集が遮断』『二重送信: ダイアログ open 中は再 request されない(modal)』。Radix AlertDialog は任意キーの window 伝播を停止しない。",
        "fix": "runAction(または window keydown ガード)で pendingPrimary !== null の間 'next' 以外の phase 系 F-key と再 'next' を抑止する。spec の modal 遮断主張を訂正し明示的ガードを設計に追加。"
      },
      {
        "issue": "配線で onRequestConfirm: setPendingPrimary は記述されるが、ダイアログ close(cancel/Escape)時に setPendingPrimary(null) する経路が spec に明記されていない。confirm 成功時は closeOnConfirm→onOpenChange(false) で消えるが、cancel/Escape 後に descriptor が残ると open 判定(open={pendingPrimary!==null}想定)や再表示で stale。",
        "severity": "minor",
        "evidence": "confirm-dialog.tsx:53-56(handleOpenChange は inputValue のみ reset、pendingPrimary は親管理)。spec『配線』節に close→null reset の記述なし。",
        "fix": "component 側で onOpenChange={(o)=>{ if(!o) setPendingPrimary(null); }} を明記し open={pendingPrimary!==null} と対で設計に入れる。"
      },
      {
        "issue": "Site 4(setp→seta)は recon 通り mutation 無・未永続=可逆(store.ts:586-603 は set({target:null})+phase返却のみ)で制約#1『不可逆 sign-off』に該当しない。ここへ confirm を入れると F12 1発→F12+Enter の2アクション化で、可逆ナビに muscle-memory 回帰だけ負わせる。spec も(a)既定だが未解決と認めている。",
        "severity": "minor",
        "evidence": "use-workbench-write-handlers.ts:1112(setp は real-data 分岐に該当せず null/1115 で next)。store.ts:600-602。spec『未解決の前提: setp の不可逆性』。",
        "fix": "S0 は mutation-backed の3不可逆(dispense/audit/seta)に限定し setp を除外(spec の option b)を推奨。揃える必要が出たら別 S で variant=default 軽量 confirm を追加。"
      }
    ],
    "verdict": "needs-revision"
  }
]
```
