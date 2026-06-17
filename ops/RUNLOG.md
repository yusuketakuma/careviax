# RUNLOG — 実行ログ（append-only）

各 lane / フェーズの実行結果を時系列で追記。形式:
`Change / Reason / Files / Why-minimal / Reused / Risk / Test`

---

## 2026-06-13 — Ensemble 採用セットアップ

- Change: Ensemble を実行管制塔として採用、careviax に ops/ 制御プレーン + agents.json を新設
- Reason: 大量サブエージェント並列を、衝突・scope creep を抑えつつ成立させる
- Files: `agents.json` `ops/*` `.claude/commands/*` `.claude/agents/*` `collab-templates.json`
- Reused: Ensemble v1.0.0（`~/tools/ensemble`、clone+install 済み）
- Risk: lane は無人自律（bypassPermissions / -a never）→ 安全境界は隔離 worktree + 手動 merge
- Test: `npm install` exit 0 / tsx OK / health は server 起動後に確認
- 検証で確定した補正: lane 指示は description 経由 / agents.json は ENSEMBLE_AGENTS_CONFIG / codex は -a never / useWorktrees:false

## F0/F1 recon — pass 1（2026-06-13）

- Change: Ensemble recon team `cvx-recon`(claude-recon plan / codex read-only) を main tree で起動 → 検証 + 所見回収 → disband
- 検証成功: server(:23100 隔離) / agents.json 解決(no dangerous fallback) / spawn / tmux / prompt 注入
- **学び**: read-only lane は team-say 不能（codex=/tmp/ensemble 書込が sandbox 拒否、claude=plan モード bash 承認停止）→ feed agentMsgs=0。協調 bus は書込可エージェント+worktree 隔離が前提。
- 回収: codex backend recon は良質。`ops/SYSTEM_MAP.md` に統合（authz/RLS/Prisma分割/具体gap）。一次裏取り済み。
- 発見(✅): CLAUDE.md 参照の 3 docs(workflow_spec/multidisciplinary/decisions) が checkout に不在。Prisma は分割構成。
- 未完: UI/design recon（claude lane ハングのため未取得）。
- Risk: なし（read-only・ファイル編集ゼロ確認）。
- Test: team disband=clean。docs 不在・prisma 構成を本セッションで再確認。

## F0/F1 recon — pass 2 UI/design（2026-06-13、修正版パターン）

- Change: disposable worktree `../careviax-recon`(HEAD分岐) で書込可エージェント(claude bypassPermissions + codex workspace-write)の UI recon team `cvx-reconui` を起動 → 協調 → auto-disband → 統合 → worktree破棄
- **検証成功(F3 de-risk)**: team-say 動作（agentMsgs=14: codex10/claude4）、相互クロスチェック、auto-disband、clean teardown。書込権限ありでも read-only 指示遵守（source 差分ゼロ）。
- 回収: `ops/UI_AUDIT.md`(画面125枚インベントリ + 逸脱10件 U-1..U-10) + `ops/DESIGN_LANGUAGE.md`(草案)。line 引用つき。
- 最重要所見: U-1 状態色トークン不在で2機構分裂・生パレット蔓延(green113/amber151/red76/blue105 ファイル) / U-2 ロール薬剤師ハードコード / U-3 error境界薄い(error.tsx 5枚 vs loading 67枚)。
- ground 決定事項: 短い状態色SSOT vs コードの多層パレット（design-gap-analysis-new寄り）の衝突 → 人手判断。
- Risk: なし（worktree 隔離・source 無変更確認）。worktree+branch 削除済み。
- 残: FEATURE_INTENT は未生成（ground/partition で derive）。

## ground（2026-06-13）

- Change: `design/`(P0/P1 v1.9 62画面) を視覚 SSOT に DESIGN_LANGUAGE 確定 + DESIGN_GROUNDING_TABLE 作成
- 目視: p0_46(状態色)/p0_07(ダッシュ)/p0_08(カード詳細)。manifest 62画面 + recon コード対応で全クラスタ grounding
- **状態色ガバナンス決定**: design p0_46「画面で使う言葉をそろえる」を正本に採用 → 青=主操作/赤=止まる理由/緑=完了/橙=確認・危険/紫=他者待ち/灰=閲覧。CLAUDE.md 短 spec は不採用(陳腐化)。**(b)+トークン化**で確定。
- 成果: P0候補6件導出（P0-A 状態色トークン化 / P0-B ロール・モード配線 / P0-C エラー境界 / P0-D 右レール微修正 / P0-E schedule realtime / P0-F 文言統一）+ owned files 衝突注意（P0-A と D/E/F が同一画面群）。
- 次: /partition で P0_SCOPE 人手確定 + IMPLEMENTATION_PARTITION 分割。

## partition（2026-06-13）

- Change: 第1波3 partition を起草。実コードで owned files を裏取り（衝突なし確認）。
- 確定: FE-A0(状態色トークン基盤, FE) / X-B0(ロール配線, cross-boundary BE→FE) / FE-C0(エラー境界, FE)。
- 裏取り: X-B0 は真の cross-boundary（`context.ts:72-199` で role は server 解決済だが session 未露出、`auth-store`/`app-provider`/shell に role なし）。FE-C0 gap=error.tsx 6枚のみ（追加先クラスタ特定）。FE-A0=globals.css+新規component で排他。
- 衝突表で 3レーン owned 排他を確認。base-state 注意: `app-header`/`sidebar` は未コミット差分に含む（X-B0 前提）。
- 成果: `ops/P0_CANDIDATES.md` `ops/P0_SCOPE.md` `ops/IMPLEMENTATION_PARTITION.md`(instances) `ops/BACKEND_GAP_PLAN.md` `ops/TEST_PLAN.md` + CHECKPOINT 進捗更新。
- CHECKPOINT=No 継続。残ゲート: P0_SCOPE 人手承認 + base state クリーン化。

## base-state クリーン化 + CHECKPOINT=Yes（2026-06-13）

- 検証: `pnpm db:generate && typecheck && lint && test` 全 green（Test Files 904 passed/1 skip、**Tests 6299 passed**/1 skip、exit 0）。
- commit: 4分割 — 7e657f83 incident-reports / 8ae62603 RLS hardening(FORCE RLS on DrugAlertRule/FileAsset/WebhookDelivery等) / 22159ca0 製品misc(UI/PCA/rx-number/e2e) / dc7f61e7 Ensemble harness(ops/+agents.json)。
- 残置（意図的）: `.harness-mem/state/continuity.json`(harness状態) `.codex/`(codex成果物) は製品外・worktree無影響。
- 承認: P0_SCOPE 第1波 + base-state を人手承認 → **CHECKPOINT=Yes**。
- 次: F3 — worktree(fe-a0/be-b0/fe-c0) + node_modules → /implement-ensemble で lane 起動。

## prescription-grid（2026-06-16・FE lane / Opus 4.8）

- Change: 調剤ワークベンチ中央グリッド（phase=dispense|audit）を新規実装 `prescription-grid.tsx`
- Reason: 段階1の中央 Grid（ツールバー/ヘッダ/セクション行/薬剤行/合計行/フッタ）を設計プロト忠実移植
- Files: `src/components/features/dispense-workbench/prescription-grid.tsx`（新規・所有ファイルのみ）
- Why-minimal: 単一ファイル新規。foundation の view/store を消費するのみ。globals.css/他コンポーネント不変更
- Reused: dispensing-workbench.module.css（gridHeader/gridSection/gridDrugRow/gridTotalRow/mono）, WorkbenchView 型, store actions（toggleRow/setGMethod/setGStart/setGDays/dragStart/dropTo/bulk/primary/openCompare/addGroup）
- Risk: 低。設計 L120-221 の inline style 寸法を実値移植。view.rows は kind 判別（'sec'|'drug'）。primary はゲート時 store 内で no-op
- Test: `npx tsc --noEmit` → prescription-grid 型エラー0 / `npx eslint prescription-grid.tsx` → 警告0

## dispense-workbench シェル実装（2026-06-16、FE lane / Opus 4.8）

- Change: 調剤ワークベンチ入口 `dispensing-workbench.tsx`（DispensingWorkbench）を新規実装。設計プロト L21-105/L457-540 を忠実移植。タイトルバー/メニューバー/患者リボン/BODY(左PatientListPanel・中央PhaseTabs+PrescriptionGrid|MedicationCalendarGrid・右RightPane)/F1-F12バー/ステータスバー/HoldReasonDialog/PrescriptionCompareDialog を合成。
- Reason: 段階1 忠実ビジュアル移植。4ルート分割（phase props 注入）でフェーズタブ/F8-F11/F12 をルート遷移化。
- Files: `src/components/features/dispense-workbench/dispensing-workbench.tsx`（owned 1ファイルのみ作成）
- Why-minimal: シェルは合成・配線のみ。中央/左/右の中身は既存子コンポーネント（7ファイル）へ委譲。状態は useWorkbenchView(phase) + store action を直接呼ぶ（ハンドラ引き回しなし＝契約ドリフト防止）。投機機能なし（help/searchPatient/photo は表示維持・段階1 no-op）。
- Reused: useWorkbenchView / useWorkbenchStore(navBy/bulk/openHold/primary/target) / module.css 全クラス / NEXT_PHASE経由 primary 戻り値。子は named export（PhaseTabs等）をそのまま import。
- Risk: phase→route は PHASE_ROUTE 定数（計画§2）。物理F1-F12 keydown を window バインド（preventDefault・デスクトップ専用）。時計は useEffect マウント後開始＋suppressHydrationWarning で hydration mismatch 回避。
- Test: tsc --noEmit 0 errors（全プロジェクト）/ eslint dispensing-workbench.tsx exit 0 / vitest dispense-workbench 47 passed。子7コンポーネントの props 契約 {view,phase} 一致を確認。

## medication-calendar-grid ピアレビュー反映（2026-06-16、FE lane / Opus 4.8）

- Change: フッタ主操作ボタンの (1) ルート遷移欠落[high]、(2) native disabled の設計乖離[medium]、(3) セル key の並び替え耐性[low] を修正。`medication-calendar-grid.tsx` のみ編集。
- Reason: 主操作ボタンが `primary(phase)` の戻り値 `Phase|null` を破棄し画面遷移しないデッドボタンだった。disabled は設計プロト L293（cursor/opacity のみ）と乖離。
- Files: `src/components/features/dispense-workbench/medication-calendar-grid.tsx`（owned 1ファイルのみ）
- Why-minimal: (1) PHASE_ROUTE 定数（シェル PHASE_ROUTE と同マップ）+ handlePrimary で `const next=primary(phase); if(next) router.push(...)`、シェル F12 ハンドラと同方式。(2) `disabled` 削除し `aria-disabled` のみ残す（store.primary が NG 時 null 返却で副作用なし＝二重ガード不要）。(3) セル key を `${ri}-${ci}` → `${c.di}-${c.tk}`（CalendarCell types L495-496）。changes/setChips/calDays/calRows の index 併用 key は妥当のため据え置き。
- Reused: store.primary(): Phase|null 契約（ルート遷移は呼び出し側責務、store L96-97）/ useRouter（next/navigation）/ CalendarCell.di,tk。
- Risk: 低。useRouter を子に導入したが遷移マップはシェルと同一定数。設計忠実度（背景色/寸法/フォント/余白/photo gradient）不変。a11y: aria-disabled 維持・キーボード操作不変。
- Test: tsc --noEmit TSC_EXIT=0 / eslint medication-calendar-grid.tsx ESLINT_EXIT=0。

## 2026-06-16 — 段階1 ルート統合（FE / dispense-workbench マウント）

- Change: 調剤ワークベンチ（段階1・モック駆動）を 4 ルートへマウント。/dispense の page.tsx を新 `DispensingWorkbench phase="dispense"` に置換、新規 /audit /set /set-audit に page+loading+error を追加、proxy.ts の PROTECTED_ROUTE_PREFIXES に /audit /set /set-audit を追記。
- Reason: foundation 済みワークベンチ（型0/47テスト通過）を実ルートに結線し 4 工程（調剤/監査/セット/セット監査）を画面として成立させる。
- Files: `src/app/(dashboard)/dispense/page.tsx`(置換) / `src/app/(dashboard)/audit/{page,loading,error}.tsx`(新規) / `src/app/(dashboard)/set/{page,loading,error}.tsx`(新規) / `src/app/(dashboard)/set-audit/{page,loading,error}.tsx`(新規) / `src/proxy.ts`(prefix 3件追記)。
- Why-minimal: page は PageScaffold variant="bare" + 外側 padding/min-h 中和(`min-h-0 bg-transparent p-0...`) で workbench 自身の .rootInShell(100vh-3.5rem) をそのまま使う。Suspense ラッパ不要(モック adapter は同期)。loading は既存 dispense/auditing/medication-sets の Skeleton+SkeletonRows 作法、error は createRouteErrorBoundary を踏襲。旧 dispense-workbench.tsx 本体・旧 /auditing /medication-sets・navigation 設定は未変更(新旧共存・別パス)。
- Reused: `DispensingWorkbench({phase,inShell?})` 契約(phase props 注入・inShell 既定 true) / PageScaffold variant=bare / `@/components/ui/loading` Skeleton,SkeletonRows / createRouteErrorBoundary / proxy isProtectedAppRoute(prefix=完全一致 or `${prefix}/` 前方一致 ＝ /set は /set-audit を誤包含しない)。
- Risk: 低。owned 内(routes + proxy prefix)のみ編集。backend/schema/API/permission 不変。proxy は表示保護プレフィックス追記のみ(認可ロジック不変)。旧 /dispense test は旧コンポーネント自己完結のため影響なし(6 tests pass 確認)。
- Test: pnpm vitest run src/components/features/dispense-workbench = 47 pass / pnpm typecheck(next typegen && tsc --noEmit && tsc -p tsconfig.sw.json) = exit 0 エラー0 / npx eslint <新10ファイル+proxy.ts> = exit 0 / 旧 dispense-workbench.test.tsx = 6 pass。
