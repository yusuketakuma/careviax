# Target Design Direction — 視覚的状態言語（Phase 6）

更新: 2026-07-11
状態: **設計方針確定。実行可能な registry / token / component / route 展開は未実装。**

## 1. 設計の目的と範囲

PH-OS は患者安全と高頻度の薬局業務を扱う業務システムである。目標は消費者向け SaaS の余白やカードを増やすことではなく、患者・処方・保存先・鮮度・権限・次の行動を短時間かつ誤認なく判断できるようにすることである。

この方針は [Phase 5 監査](06-ui-ux-audit.md) と [使用ミス登録簿](07-use-error-risk-register.md) を入力とする。既存の規範SSOTは [UI/UX Design Guidelines](../ui-ux-design-guidelines.md) だけであり、本書は実装前の設計・受入基準を示す補助文書である。

## 2. Product-specific design principles

1. **安全が装飾に優先する。** 患者識別、薬剤名・用量・単位、処方差分、critical alert、保存先は見た目を簡素化する理由で隠さない。
2. **患者文脈を操作中に失わせない。** 患者固有の画面では共通の pinned header を基点にし、患者切替時は旧患者の draft、選択、query、添付を引き継がない。
3. **一目・一読・詳細の3層で伝える。** 重要度と停止状態は位置・形・色・iconで即時に、短い日本語ラベルで正確に、理由・日時・対象・復旧操作を詳細で理解可能にする。
4. **密度は維持し、判読性を下げない。** 比較する値は table と tabular numbers で揃え、本文14px・ラベル12pxの下限を守る。カードの反復や hover 専用情報で密度を偽装しない。
5. **状態は直交させる。** 処方変更は clinical warning ではなく、下書きは server 保存や確定ではなく、待機は必ずしも障害ではない。別軸を1バッジに潰さない。
6. **保存先と鮮度を明示する。** 端末保存、送信待ち、同期中、同期済、同期失敗、競合、画面データの stale を同じチェックや「保存しました」で表さない。
7. **例外ほど復旧を具体化する。** error / 401 / 403 / 409 / 429 / offline / upload partial failure は、原因、現在のデータ保持、次の安全な操作を画面内に残す。
8. **primary と destructive を空間的に分ける。** 主操作は1つ、破壊的・確定・承認操作は対象患者・対象記録・影響を再確認し、Thumb zone に置かない。
9. **全画面よりジャーニーで一貫させる。** 同じ意味の状態、icon、ラベル、再試行、read-only 表示を route ごとに再定義しない。
10. **アクセス可能性は状態言語の一部である。** 色単独・icon単独・tooltip単独にせず、keyboard、screen reader、forced-colors、200% zoom、reduced-motion でも意味を保つ。

## 3. Three-level communication

| Level   | 利用者が理解すべきこと                                                          | 表現の契約                                                                                        |
| ------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 1: 一目 | 対応要否、停止/進行、critical、offline、現在の患者・業務文脈                    | 一貫した位置、境界/形、role token、Lucide icon。critical/patient context はスクロール後も失わない |
| 2: 一読 | `端末保存済み`、`送信待ち`、`同期失敗`、`確認待ち`、`閲覧専用` などの正確な状態 | icon と常時可視の短い日本語ラベル。生 enum、色、tooltipだけに依存しない                           |
| 3: 詳細 | なぜその状態か、対象、日時、作成/確認者、取得元、期限、再試行、override、監査   | 展開可能な詳細、画面内の復旧導線、権限付きの監査情報。PHI は正本画面以外へ出さない                |

## 4. Visual Status Matrix

状態は domain を跨いで独立に扱う。各状態を使う前に API/model、TypeScript literal、共通component、テストを同一スライスで揃える。`planned` は現在のUI状態として表示してはならない。

| Domain              | 状態キー / 状態群                                                                                                                 | 表示上の区別                                                              | 実装上の入口                                 | 現在地                                                           |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------- | ---------------------------------------------------------------- |
| Clinical safety     | informational / attention / review-required / high-risk / blocking                                                                | AlertTier、hazard tag、left border、action gateを分離。処方変更と混ぜない | alert contract + `AlertTier`                 | 一部実装。CDS の実体表示・ack束縛は G-01                         |
| Prescription change | unchanged / new / resumed / changed / increased / decreased / discontinued / dose-strength-route changed                          | 変更ラベル、前→後、差分値。warning色を流用しない                          | prescription comparison DTO + component      | 部分実装。全値の共通contractは未実装                             |
| Record lifecycle    | unsaved / draft / local autosave / server-saved / review / approval / finalized / amended / superseded                            | 保存先・確定者・日時・版・read-onlyを別表示                               | record/report API + lifecycle component      | `draft/confirmed/sent`等は部分実装。finalize/revision UIは未実装 |
| Synchronization     | online / unstable / offline / local-only / queued / syncing / synchronized / stale / retry scheduled / failed / conflict          | persistent indicator + row badge。local と server の成功表現を共有しない  | offline store + sync queue + stale metadata  | 4行内sync badgeとconflict UIは実装。一部状態は未実装             |
| Workflow            | not-started / in-progress / waiting / ready / completed / blocked / cancelled                                                     | waiting と blocked を別roleにする                                         | workflow/cycle status map                    | 部分実装。local labelsの統合が未完了                             |
| System/auth         | normal / degraded / maintenance / read-only / session-expiring / reauthentication-required / locked / emergency-mode / recovering | 理由、権限、復旧先を明示。403をserver errorに畳まない                     | error envelope + session / break-glass state | health/read-only/timeoutは部分実装。401 recovery等は未実装       |
| File processing     | selected / validating / uploading / processing / completed / rejected / retryable-error / cancelled                               | 記録保存とfile処理を別に表示し、per-file再試行を置く                      | upload API + client queue                    | capture経路のみ再開型。visit-record 添付の永続再試行は未実装     |

### 4.1 Role mapping rules

- 共通の `StatusRole` は見た目の基礎であり、domain state を置き換えない。`blocked` は停止理由、`confirm` は確認必要、`waiting` は他者確認待ち、`done` は確認済みの完了、`readonly` は変更不可、`info` は情報/進行、`hazard` は臨床ハザードに限定する。
- `neutral` は意味を持つ状態を消すための逃げ道ではない。状態が利用者の判断に影響するなら label と必要な詳細を別途表示する。
- `StateBadge` / `StatusDot` は role を受けるだけにし、画面ローカルの raw class、任意icon、任意severityを受け取らない。domain keyからのrole・copy・ARIA・actionを中央registryが決める方向へ収束する。

## 5. Visual Status Registry contract

Phase 7/8 の実行可能SSOTは、各 domain state から次を一意に導出する registry とする。

| Contract field | 必須内容                                                                                    |
| -------------- | ------------------------------------------------------------------------------------------- |
| Identity       | semantic key、domain、Japanese visible label、short/detailed description                    |
| Risk           | severity、clinical blocking、acknowledgement、dismissibility、audit requirement             |
| Visual         | icon key、shape、fill/text/border token、fixed placement、persistence、motion policy        |
| Accessibility  | accessible name、ARIA role、aria-live の強さ、focus/recovery behavior                       |
| Action         | permitted actions、required preconditions、retry/override/confirmation、invalid transitions |
| Integration    | API/model source、component、test IDs、owner、migration status                              |

画面は semantic key のみを指定し、registry外のhex、utility color、icon、severity string、成功コピーを指定しない。TypeScriptではdomainごとのdiscriminated unionを使い、`local-only + server-saved` や `blocking + dismissible` のような矛盾した組合せを表現しにくくする。

## 6. Medical-specific patterns

### Patient context bar

- 全患者固有の主要画面で、氏名、識別補助、対象日、現在の業務、critical safety tags、最終更新の入口を共通の pinned zone に置く。
- 氏名・カナ・薬剤名は復元不能な ellipsis にしない。狭幅は省略ではなく、行増加、詳細Drawer、accessible name、比較に必要な別識別子で解決する。
- 高リスク確定では確認面にも患者・記録・影響を再掲し、患者切替後の旧draft/cache/attachment残存は安全側に破棄または明示確認する。

### Prescription difference and clinical alerts

- 処方差分は変更icon、短い変更ラベル、前後値、差分値、対象項目を表示し、clinical alert と位置・色・操作制約を共有しない。
- patient-specific high-risk/unknown CDS metadata は既存の fail-safe floor に従い、表示欠落を成功や通常確認へ降格させない。
- critical alert はtoastだけで通知・自動消去せず、理由、対象薬剤/条件、評価日時、必要な確認、override権限/理由、監査を同じ操作面で確認可能にする。

### Save, sync, freshness, and read-only

- 文言は保存先を明示する。例: `端末に保存済み（未送信）`、`サーバーへ送信待ち`、`サーバー保存済み`、`同期に失敗`、`競合を解決してください`。
- 画面の data freshness とオフラインqueueの最終同期時刻は別概念であり、同じヘッダー文言で保証しない。
- read-only はdisabled inputの見た目だけで表さず、理由と確定者/確定日時/版をheaderで示し、可能な場合は値をplain textで表示する。

## 7. Phase 7/8 acceptance gates

1. registryにない状態を新規画面で描画しない。
2. P1の患者識別、薬剤/数値表示、false-empty/false-zeroはcomponent contractとroute testsで先に固定する。
3. local/server/sync/conflict/stale、401/403/409/429、read-only、file partial failureを一つのspinner/toastへ集約しない。
4. 医療安全、PHI、権限、同期、break-glassに触れる実装は、review owner、API contract、受入シナリオ、unit/E2E/a11y証跡を同時に記録する。
5. 視覚的に重要な画面実装では、PHIなしの `gpt-image-2` 参照案とdesktop/mobile/error stateを用意する。今回の設計文書のみのsliceでは画面再構成をしていないため生成を省略する。
