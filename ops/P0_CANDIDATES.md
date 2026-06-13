# P0_CANDIDATES — P0 候補（recon + ground 由来）

> [[UI_AUDIT]] / [[DESIGN_GROUNDING_TABLE]] から導出。確定スコープは [[P0_SCOPE]]（人手選定）。

| id | 候補 | type | 根拠(design×code) | 規模 | 第1波 |
|---|---|---|---|---|---|
| P0-A | 状態色トークン化 | FE中核 | p0_46 ⇄ `--state-*`不在・2機構分裂・生パレット蔓延(U-1) | 大 | **基盤のみ** |
| P0-B | ロール/モード配線 | cross-boundary | p0_46/p0_25 ⇄ session に role 未露出・shell 薬剤師ハードコード(U-2) | 中〜大 | **○** |
| P0-C | エラー/権限境界整備 | FE | 全画面 ⇄ error.tsx 6枚のみ(U-3) | 中 | **○** |
| P0-D | 右レール微修正 | FE | p0_08 ⇄ 見出し階層/44px/adapter重複(U-4/5/6) | 小〜中 | 第2波 |
| P0-E | schedule realtime 統一 | FE | p0_16 ⇄ plain useQuery(U-7) | 小 | 第2波 |
| P0-F | 文言/ラベル統一 | FE | README v1.9 ⇄ 根拠資料→記録 等 | 小 | 第2波 |

## 衝突構造（partition の根拠）
P0-A の**適用**と P0-D/E/F は同一画面群（dashboard/patients/schedule/visits/dispense）を触り owned 重複 → 第1波は **P0-A は基盤(globals.css + 新規 token/component)のみ**に絞り、画面適用と D/E/F は第2波へ。これで第1波3レーンの owned が排他になる。
