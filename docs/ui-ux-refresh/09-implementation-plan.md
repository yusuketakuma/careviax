# Implementation Plan — SSOT再構築・全画面展開（Phase 7–8）

更新: 2026-07-11
状態: **Phase 7 planning in progress。下記の planned item は実装済みではない。**

## 1. 現在のSSOT map

| 層                | 現在の正本                                                               | 責務                                          | 既知の不足                                                   |
| ----------------- | ------------------------------------------------------------------------ | --------------------------------------------- | ------------------------------------------------------------ |
| Normative         | `docs/ui-ux-design-guidelines.md`                                        | 医療安全、tokens、状態、component、a11yの規範 | domain stateをregistryとして実行可能化していない             |
| Design input      | `docs/ui-ux-refresh/08-target-design-direction.md`                       | 3層通信、Visual Status Matrix、受入ゲート     | 実装前の設計文書でありcode sourceではない                    |
| Role tokens       | `src/lib/constants/status-tokens.ts`                                     | 7 roleのicon・badge/dot/accent class          | domain key/transition/action/ARIAを持たない                  |
| Labels / mappings | `src/lib/constants/status-labels.ts`                                     | enum値→日本語・roleの既存mapping              | `Record<string>`とlegacy variantsの混在、domain registry不在 |
| Common components | `StateBadge` / `StatusDot` / `SyncStateBadge` / `AlertTier` / `Segment*` | 既存の表示・ARIA・再試行の契約                | domainごとに同じsemantic fieldを再利用できない               |
| Tests             | component unit tests、route/provider tests、Playwright                   | 現行契約の回帰防止                            | 全状態・全viewport・実運用ジャーニーの網羅なし               |

## 2. 実装順序

各sliceは API/consumer/テストを片翼にせず、該当する review gate を通過してから次へ進む。

| Order | Slice                                             | 目的                                                                                   | リスク / gate                                                       | 完了の証拠                                                                |
| ----: | ------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------- |
|     1 | Registry adapter for existing offline sync states | 既存の5状態をlabel/role/component metadataへ一元化。visible behavior不変               | offline/PHI-adjacent。Oracle review、focused unit、no queue changes | exact labels/roles、exports、SyncStateBadge DOM、offline-sync screen test |
|     2 | Status registry primitives                        | registry entry type、domain literal、safe resolver、invalid-key failure behaviorを追加 | shared UI。typecheck、StateBadge tests、migration guide             | type-level exhaustiveness、no raw styling escape hatch                    |
|     3 | P1 false-empty / false-zero                       | patient editとperformanceのdata-state contractを共通状態へ収束                         | patient safety。clinical/design review、route+component tests       | error≠not-found、loading≠zero、retry and a11y                             |
|     4 | P1 readable patient/rx display                    | patient context truncationとsub-12px medication/printを共通contractで是正              | patient safety。clinical review、visual/a11y/E2E                    | narrow viewport、200% zoom、keyboard、patient-switch scenario             |
|     5 | Save/sync/freshness vertical slice                | local/server/sync/conflict/staleを選んだ1導線で一貫表示                                | data integrity/concurrency。Oracle + security/clinical              | offline restore、409、partial upload、no false success                    |
|     6 | Permission/read-only recovery                     | permissions envelopeと401/403の画面内復旧                                              | auth/authz。Oracle + security                                       | role tests、session/forbidden E2E、PHI-safe copy                          |
|     7 | Remaining screen families                         | template/componentから128 routeへ段階展開                                              | broad UI change。image reference + visual regression                | route matrixのimplementation/a11y/responsive evidence                     |

## 3. Slice 1 — registry adapter contract

対象は `OfflineSyncStatus = saved_locally | queued | failed | synced | conflict` のみとする。DB、queue、retry、idempotency、client request、storage、PHI projection、API response、visible label、role mappingを変更しない。

```ts
type VisualStatusEntry<TKey extends string> = Readonly<{
  key: TKey;
  domain: 'synchronization';
  label: string;
  role: StatusRoleOrNeutral;
  component: 'SyncStateBadge';
  persistent: boolean;
  retryable: boolean;
}>;
```

不変条件:

- `saved_locally → info / 端末保存済`
- `queued → info / 送信待ち`
- `failed → blocked / 送信失敗`（常時可視、retry導線を失わない）
- `synced → done / 同期済み`
- `conflict → confirm / 競合`
- payload由来の表示ラベル上書きは維持するが、roleは常にregistryから導く。
- 未知の key を success / neutral / empty として扱わない。外部入力であれば上流validationで拒否し、内部なら型で到達不能にする。

## 4. 実装しないもの

次は Slice 1 へ混ぜない: 新しい同期状態、401/403/429 behavior、OCC/409 behavior、offline queue schema、Dexie migration、record lifecycle/revision UI、break-glass、患者ヘッダーのPHI表示、AlertTier semantics、raw status mapping の一括削除。これらは別々のAPI/権限/医療安全gateを必要とする。

## 5. Screen rollout evidence

各画面の `Audited / SSOT applied / Implemented / Unit tested / E2E tested / Accessibility checked / Responsive checked / Evidence` は [Phase 3 inventory](04-screen-and-state-inventory.md) を更新元として、Phase 8の実装時に route 単位で記録する。Phase 7 の共通基盤のみでは、全128 routeへのSSOT適用を主張しない。

## 6. Validation protocol

- common component: focused Vitest, ESLint, Prettier, `git diff --check`, typecheck
- behavior/security-sensitive slice: API contract/authorization/PHI checksと変更対象のunit/E2E
- visual slice: PHIなしの `gpt-image-2` reference、desktop/mobile/error/loading screenshot、keyboard、forced-colors/reduced-motion、200% zoom
- integration: format/lint/typecheck/module boundary/Vitest/Playwright/build/standalone outputをPhase 9で実行し、未実行なら `NOT_EXECUTED` と記録する
