# DESIGN_GROUNDING_TABLE — 画面 × 設計要素 グラウンディング

> `/ground` 成果物。`design/`(P0/P1 v1.9, 62画面, `manifest.json`) を視覚的 SSOT とし、
> [[DESIGN_LANGUAGE]] の軸と [[UI_AUDIT]] の現状コードを突合。gap が [[#p0候補]] へ流れる。
> 目視確認済 design: p0_46(状態色), p0_07(ダッシュボード), p0_08(カード詳細)。他は manifest + コード対応で grounding（"未目視"明記）。

## 文言ルール（design README_Codex.md v1.9・全画面共通）
ブロッカー→**止まっている理由** / Next Action→**次にやること** / Handoff→**薬剤師に相談/事務へ戻す** / Claim→**算定チェック** / 主操作は画面ごとに1つだけ強調 / 危険タグ(麻薬/冷所/インスリン/抗凝固)は隠さない。
→ コードは右レール `action-rail.tsx` で「次にやること/止まっている理由/根拠・記録」を実装（recon 確認）。**ラベル差**: design v1.9=「根拠・**資料**」 vs コード=「根拠・**記録**」（design-gap-analysis-new で改称）→ 記録に統一で可。

## A. 横断インフラ（最優先・全画面に効く）
| 要素 | design ref | 設計の要点 | 現状コード | 判定 | gap |
|---|---|---|---|---|---|
| 状態色 | **p0_46**(目視) | 青=主操作/赤=止まる理由/緑=完了/橙=確認・危険/紫=他者待ち/灰=閲覧 | `--state-*` トークン不在、2機構分裂、生パレット蔓延(green113/amber151…) | ❌逸脱 | **P0-A 状態色トークン化**(U-1) |
| ロール表示 | p0_46/p0_25 | ユーザー「山田 花子/薬剤師」、clerk_support 別ダッシュ(p0_25) | header/sidebar で薬剤師ハードコード、workMode 未配線 | ❌逸脱 | **P0-B ロール/モード配線**(U-2) |
| 右レール3点 | **p0_08**(目視) | 次にやること(青主操作1つ)/止まっている理由(赤・橙)/根拠(見る) | `action-rail.tsx` 構造一致、RailCard が全 h3 | ◯ほぼ一致 | 微: 見出し階層(U-4)・44px(U-5) |
| シェル | p0_07/p0_08(目視) | ダークネイビー左メニュー/上バー(モード・通知・ヘルプ・ユーザー)/中央作業/右next | `AppShell`+`app-header`+`sidebar` 一致。白バー vs bg/95 要確認 | ◯一致 | 微: トップバー白確認 |
| エラー/権限境界 | 全画面 | 各画面で loading/empty/error/権限 を明示 | error.tsx 5枚 / forbidden 等 root のみ(loading 67枚に対し薄) | △不足 | **P0-C エラー境界整備**(U-3) |
| (phos)二重系統 | — | 単一シェル想定 | (phos) 別レイアウト+`resolveDisplayStatus` 別状態系 | △要統合 | 状態解決の単一化(U-10) |

## B. 工程ワークフロー（9工程 = カード作業台）
| クラスタ | design ref | 設計の要点 | 現状コード(recon) | 判定 |
|---|---|---|---|---|
| ダッシュ/カードグリッド | **p0_07**(目視) | 集計バッジ行+患者カード(下部に青主操作1つ)+ヘッダー主操作2 | `DashboardCockpit`(new_01) useRealtimeQuery、状態完備。scope トグル client-only(U-8) | ◯/△ |
| 患者ボード | (patients) | 患者一覧ボード | `PatientsBoard`(new_02) attention色6種 | ◯(色は軸へ写像) |
| カード詳細 | **p0_08**(目視) | 左患者メタ+中央タブ(メモ/工程/処方監査/セット/訪問/報告/履歴)+右レール3点。処方の変化=追加/中止表 | `CardWorkspace`(06_card) SafetyBoard最上部+ProcessChips+表 | ◯一致 |
| 処方取込/入力/判断 | p0_09/10/11(未目視) | 取込→期間入力→差分レビュー | prescriptions intake/new/[id] | 要目視で精査 |
| 調剤/監査 | p0_12/13(未目視) | 調剤ワークベンチ(3ペイン)/監査 | `DispenseWorkbench` 3ペイン、checklist gated | ◯構造 |
| セット準備/監査 | p0_14/15(未目視) | セット準備/監査 | medication-sets list/edit/audit | 要目視 |

## C. 訪問・スケジュール
| クラスタ | design ref | 設計の要点 | 現状コード | 判定 |
|---|---|---|---|---|
| スケジュール/ガント | p0_16-19(未目視) | 全スタッフ ガント/確定/作成編集/衝突解消 | `ScheduleTeamBoard`(new_03) day/week。**plain useQuery で realtime 非反応**(U-7) | △ |
| ルート最適化 | p0_20/21(未目視) | 緊急再計算/最適化詳細 | schedules proposals/route-compare | 要目視 |
| 訪問モード | p0_22/23(未目視) | タブレット/スマホ別レイアウト・現場最小UI | visits today/record/voice-memo, mobile wizard | 要目視(モバイル要件厳格) |
| 施設パケット/証跡 | p0_24/33/48(未目視) | 施設訪問パケット/証跡写真/モバイル撮影 | visits facility-packet/evidence, mobile-evidence | 要目視 |

## D. 連携・報告・算定
| クラスタ | design ref | 設計の要点 | 現状コード | 判定 |
|---|---|---|---|---|
| 事務サポート | p0_25(未目視) | clerk_support 専用ダッシュ | clerk-support, (B のロール配線と連動) | △(P0-B 依存) |
| 連携/引き継ぎ | p0_26/27/29(未目視) | 連絡先編集/双方向ハンドオフ/返信フォロー | communications, handoff(双方向), referrals | 要目視 |
| 報告書 | p0_28(未目視) | 報告書コンポーザ+共有 | reports [id]/share/print | 要目視 |
| 算定チェック | p0_30(未目視) | 算定/請求レビュー | billing candidates | 要目視 |
| 残薬調整 | p0_31(未目視) | 残薬調整フロー | patients/[id]/residual-adjustment | 要目視 |

## E. 安全・オフライン・理由モーダル
| クラスタ | design ref | 設計の要点 | 現状コード | 判定 |
|---|---|---|---|---|
| 安全/有害事象 | p0_32(未目視) | 有害事象予防フロー・SafetyBoard | `safety-board.tsx`(危険色=軸整合) | ◯ |
| オフライン同期 | p0_34/35(未目視) | 同期センター/競合解消 | offline-sync（D-6-1 は Plans で TODO） | 要新規/精査 |
| 理由モーダル | p0_36/37(未目視) | 差戻し理由/取消再開理由（共通化） | 各所に分散（D-6-3 共通化 TODO） | △共通化候補 |

## F. マスタ・設定 / P1
- マスタ: p0_38-43(患者/薬剤/医療職/施設/スタッフ/車両)・p0_44 設定・p0_45 キャパ・p0_47 印刷 → admin ≈40画面に対応（未目視、データ密度=Excel的の grounding 要）。
- P1: p1_01-14（保存ビュー/複数カード/AI要約/AI下書き/多職種ポータル/分析/在庫予測/施設基準/**ヒヤリハット(p1_09)**/テンプレ編集/**音声メモ(p1_11)**/ルート比較/プレゼンス/シグナル調整）。一部は最近のコミットで着手済（incident-reports, voice-memo, route-compare, collaboration-presence）。

## <a id="p0候補"></a>P0 候補（→ /partition で確定）
| 候補 | type | 根拠 | 規模 |
|---|---|---|---|
| **P0-A 状態色トークン化** | cross-boundary 寄り FE | U-1 / p0_46。`--state-*`/`--tag-*` 定義 + `StateBadge`/`StatusDot` + 主要画面の置換 | 大(横断) |
| **P0-B ロール/モード配線** | cross-boundary | U-2。auth→membership role を AppProvider/store→shell 表示 + workMode 連動 + p0_25 clerk ダッシュ | 中〜大 |
| **P0-C エラー/権限境界整備** | FE | U-3。クラスタ単位 error.tsx/forbidden 整備 | 中 |
| P0-D 右レール微修正 | FE | U-4/U-5/U-6。見出し階層・44px・blocked_reasons 共有 adapter 統一 | 小〜中 |
| P0-E schedule realtime 統一 | FE | U-7。useRealtimeQuery へ寄せる | 小 |
| P0-F 文言/ラベル統一 | FE | 根拠・資料→記録、文言ルール徹底 | 小 |

> 並列衝突注意: P0-A と P0-D/E/F は同じ画面ファイル群(dashboard/patients/schedule/visits/dispense)を触る → **owned files 重複**。/partition では P0-A を先行 or 画面単位で owned を排他分割。
