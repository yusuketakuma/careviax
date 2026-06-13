# UI_AUDIT — 画面構成・状態・設計地逸脱

> F0/F1 recon（Ensemble 協調: claude-frontend-opus48 + codex-backend-gpt55、disposable worktree 隔離、team-say で相互クロスチェック）。
> 引用は **HEAD `16720de9`** 基準。注: `app-header.tsx` / `sidebar.tsx` / `dashboard-cockpit.tsx` / `schedule-team-board.tsx` 等は main tree で未コミット変更があり、行番号は実working tree と微差の可能性。

## 1. 画面インベントリ（src/app に page.tsx ≈ 125枚）
- **(auth) 8画面**: login / first-login / lockout / mfa(+setup) / password(change,reset) — 入力系＝ゆとりレイアウト期待ゾーン
- **(dashboard) 本体 ≈110画面**:
  - 運用ハブ: dashboard / my-day / tasks / workflow / handoff / notifications / search / views / select-mode / select-site / offline-sync / settings
  - **patients（最大クラスタ）**: list/[id]/new/compare + [id]配下 collaboration,consent,edit,management-plan(+print),mcs,medication-calendar,medications(+print),prescriptions,residual-adjustment,safety-check,share,visit-records(+print)
  - prescriptions: list/[id]/intake/new/qr-drafts(+[id])
  - visits: list/[id] + brief/capture/facility-packet/record/voice-memo,evidence,handoffs/[id]
  - dispensing: list/[taskId]/confirm ・ medication-sets: list/[planId]/edit,audit,full
  - reports: list/[id](+print,share)/analytics/print ・ schedules: list/proposals/route-compare
  - billing / communications / conferences / clerk-support / external / referrals / auditing / qr-scan
  - admin ≈40画面（alert-rules,analytics,audit-logs,billing-rules,capacity,data-explorer,drug-masters,facilities,formulary,incidents,institutions,jobs,metrics,realtime,staff,users,vehicles,settings…）
- **(phos) 別シェル4画面**: board / capacity / handoffs / visit/[packetId] — (dashboard)とは別レイアウト・別状態系統（要・二重UI管理）
- **root**: page.tsx(LP) / dashboard-preview / offline / shared/[token]（外部共有）

## 2. シェル・共通部品（codex-2）
- `AppShell`（src/components/layout/app-shell.tsx）が (dashboard)+(phos) 共通スキャフォールド。desktop sidebar=xl+ / compact Sheet=xl未満（:284-303）、sticky AppHeader + network/orientation guard（:325-352）、Cmd+K 検索・Cmd+N quick-create（:205-260）。SSOT「共通scaffold」(guidelines:101) に合致。
- `AppHeader`（app-header.tsx）: mode dropdown(:142-170)、md+常設 /search ボタン(:172-187)、sync/offline(:53-83,202)、通知/ヘルプ/ユーザー(:189-224)。**逸脱候補**: 設計は白トップバー想定、実装は `bg-background/95 backdrop-blur`(:126-128)＝token が白なら可だが要視覚確認。
- `Sidebar`（sidebar.tsx）: PH-OSロゴ(:88-106)、グループ 今日/患者/工程/連携/管理（navigation-config.ts:79-165）、active 青pill+バッジ抑制(:31-63)、`useNavBadges` 動的バッジ(:77,140)、44px ターゲット維持。

## 3. 状態管理・右レール（codex-2）
- `ui-store`（src/lib/stores/ui-store.ts:28-63）: sidebarOpen/Pinned/theme/workMode/careMode を localStorage `ph-os-ui` に永続、drawer/help は非永続。
- React Query（query-provider.tsx:6-24）: staleTime 60s/retry 1、online で全 invalidate。`root-provider.tsx:27-40` が theme/offline TTL/navigation confirm/toaster。
- navバッジ（use-nav-badges.ts:35-79）: /api/dispense-audits・/api/handoff-board を 60s ごと。
- **右レール** `action-rail.tsx`: NextActionPanel「次にやること」+ full-width 44px 主操作(:61-103) / BlockedReasonsPanel severity・category/age/action(:106-218) / EvidencePanel「根拠・記録」(:220-277) / WorkspaceActionRail が next→blocked→evidence 順を固定(:290-310)。design-gap-analysis-new と構造一致。

## 4. 画面配線（codex-2）
- `DashboardCockpit`(new_01): /api/dashboard/cockpit を `useRealtimeQuery`、loading skeleton/error retry/empty 完備。
- `PatientsBoard`(new_02): /api/patients/board?scope、chip/search ローカルフィルタ、状態完備。
- `CardWorkspace`(06_card): /overview、SafetyBoard 最上部、ProcessChips+table、各 empty state。
- `ScheduleTeamBoard`(new_03)・`VisitsToday`(new_04)・`DispenseWorkbench`(3ペイン) いずれも loading/error/empty + 共通レール。

## 5. 設計地逸脱・不整合（要対応候補）
| # | 重大度 | 所見 | 根拠 |
|---|---|---|---|
| U-1 | **高** | **状態色トークンが中央定義ゼロ**、生Tailwindパレットが 125画面に蔓延（→ DESIGN_LANGUAGE 参照） | globals.css 全域 / 多数 |
| U-2 | 高 | **ユーザーロールが 薬剤師 ハードコード**（auth/role 由来でない）。clerk/support が誤表示 | app-header.tsx:222 / sidebar.tsx:163 / 対比 member-roles.ts:85-103 |
| U-3 | 中 | **error/permission 境界が薄い**: loading.tsx≈67枚に対し error.tsx は5箇所+root のみ。forbidden/not-found/unauthorized は root のみ | src/app 全域 |
| U-4 | 中 | **見出し階層リスク**: Dashboard/Patients/Card が section 内で h2 を可視ページタイトルに使用。route wrapper に h1 が無ければ guidelines:86-91 違反 | dashboard-cockpit.tsx:648-653 / patients-board.tsx:401-406 / card-workspace.tsx:220-225 |
| U-5 | 中 | **44px タッチ未満リスク**: card 内 `size='sm'` outline ボタンに明示 min-h なし | patients-board.tsx:254-257 / schedule-team-board.tsx:250-256 / visits-today.tsx:189-198 / dispense-workbench.tsx:577-585 / action-rail.tsx EvidencePanel:253-270 |
| U-6 | 中 | **blocked_reasons 再マップの重複**: 各画面が local `formatAgeLabel` を複製。共有 `lib/workspace/daily-ops-rail.ts` が一部未使用 | dashboard-cockpit:618-626 / patients-board:365-373 / schedule-team-board:503-511 / visits-today:262-270 / dispense-workbench:419-427 |
| U-7 | 中 | **realtime 不一致**: ScheduleTeamBoard は plain `useQuery`＝cycle_transition/workflow_refresh に反応せず（他は useRealtimeQuery） | schedule-team-board.tsx:487-498 vs use-realtime-query.ts:21-70 |
| U-8 | 中 | **scope トグルが client-only**: Dashboard「私の今日/チーム全体」はサーバ scope 未実装でラベルのみ変化 | dashboard-cockpit.tsx:594-599 |
| U-9 | 低 | サブ12pxラベル 233件（text-[10px]/[11px]/2xs）— 印刷専用か実UIか要サンプル裏取り | grep 集計 |
| U-10 | 低 | (phos) が状態解決を別系統 `src/phos/domain/status/resolveDisplayStatus.ts` で持つ＝二重UI/状態系統 | (phos) 配下 |

→ P0_CANDIDATES では U-1(状態色トークン化) / U-2(ロール配線) / U-3(エラー境界) が横断インフラ系の有力候補。
