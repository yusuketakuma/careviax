# 状態色 移行台帳 (state-color migration map)

p0_46「画面で使う言葉をそろえる」の **6軸セマンティック** を状態色の正本とし、コードベース全体を
中央トークン (`globals.css` の `--state-*` / `--tag-*`) + 共通部品 `StateBadge` / `StatusDot` に統一する。
本書は family × value × role の確定表（正本）と、移行の方針・対象・除外を定める。

- SSOT: 本書（family×value×role）+ `src/lib/constants/status-labels.ts` の `*_ROLE` 定数（実装の正本）。
- 旧「患者緑橙灰 spec」（稼働中=緑/保留=橙/終了=灰）は **不採用**。理由は `docs/ui-ux-design-guidelines.md`「### 色」参照。

## 6軸（+neutral）の意味

| role | 色 / token | 意味 |
| --- | --- | --- |
| `info` | 青 `--tag-info` | 通常の主操作・現在地(current)・情報タグ(処方変更/セット変更/返信待ちを一覧に出す)・予定/待ち |
| `blocked` | 赤 `--state-blocked` | 止まっている理由・ブロッカー・キャンセル・通信なし・送付失敗 |
| `done` | 緑 `--state-done` | 完了・承認済・確認済 |
| `confirm` | 橙 `--state-confirm` | 確認が必要・保留・差戻し・延期・要対応 |
| `hazard` | 橙 `--tag-hazard` | 麻薬/冷所/インスリン/抗凝固 等の危険タグ(隠さない) |
| `waiting` | 紫 `--state-waiting` | 別の人(薬剤師/事務)の確認待ち |
| `readonly` | 灰 `--state-readonly` | 閲覧のみ・権限なし・終了/退院・中立 |
| `neutral` | 状態色なし | 既定 Badge / `text-muted-foreground`。StateBadge には渡さない |

`neutral` は `status-tokens.ts` に存在しない。型は `StatusRole | 'neutral'`(= `StatusRoleOrNeutral`)。
neutral は「状態色を付けない」運用指示であり、StateBadge ではなく既定 Badge(default/secondary/outline) か text-muted で描く。

## family × value × role（確定表 / 正本）

### CaseStatus — `CASE_STATUS_ROLE` (prisma: patient.prisma)
| value | role | 備考 |
| --- | --- | --- |
| referral_received | info | 段階の入口 |
| assessment | info | アセスメント中 |
| active | neutral | 稼働中は状態色を付けない(既定/中立)。旧 spec の「緑」は不採用 |
| on_hold | confirm | 保留=要対応 |
| discharged | readonly | 退院/終了=閲覧 |
| terminated | blocked | 解約=止まる |

### ScheduleStatus — `SCHEDULE_STATUS_ROLE` (prisma: visit.prisma)
| value | role | 備考 |
| --- | --- | --- |
| planned | info | 予定 |
| in_preparation | info | 準備中 |
| ready | info | 準備完了 |
| departed | info | 出発 |
| in_progress | info | 訪問中 |
| completed | done | 完了 |
| cancelled | blocked | キャンセル |
| postponed | confirm | 延期 |
| rescheduled | confirm | 再調整(要確認) |
| no_show | blocked | 不在=止まる |

### 優先度 (VisitPriority / IssuePriority / TaskPriority) — `PRIORITY_ROLE`
| value | role | 備考 |
| --- | --- | --- |
| emergency | blocked | 緊急 |
| critical | blocked | IssuePriority 最上位 |
| urgent | confirm | 至急 |
| high | confirm | 高 |
| normal | info | 通常 |
| medium | info | 中 |
| low | readonly | 低 |

### VisitOutcome — `VISIT_OUTCOME_ROLE` (prisma: visit.prisma)
| value | role | 備考 |
| --- | --- | --- |
| completed | done | 完了 |
| revisit_needed | confirm | 再訪問必要 |
| postponed | confirm | 延期 |
| cancelled | blocked | キャンセル |
| delivery_only | info | 配薬のみ |
| completed_with_issue | confirm | 課題あり完了=要対応 |

### ReportStatus — `REPORT_STATUS_ROLE` (prisma: communication.prisma)
| value | role | 備考 |
| --- | --- | --- |
| draft | neutral | 下書き=未確定 |
| sent | done | 送付済 |
| failed | blocked | 送付失敗 |
| confirmed | done | 確認済 |
| response_waiting | waiting | 返信待ち=他者待ち |

### MedicationCycleStatus — `MEDICATION_CYCLE_STATUS_ROLE` (prisma: prescription.prisma)
| value | role | 備考 |
| --- | --- | --- |
| intake_received | info | 線形フロー進行中 |
| structuring | info | 〃 |
| inquiry_pending | confirm | 疑義照会中=要確認 |
| inquiry_resolved | info | 〃 |
| ready_to_dispense | info | 〃 |
| dispensing | info | 〃 |
| dispensed | info | 〃 |
| audit_pending | info | 〃 |
| audited | info | 〃 |
| setting | info | 〃 |
| set_audited | info | 〃 |
| visit_ready | info | 〃 |
| visit_completed | info | 〃 |
| reported | done | 完了 |
| on_hold | confirm | 保留 |
| cancelled | blocked | 取消 |

注: 工程の「現在地(いまここ)」表示は `info`(current) を使う。完了済み工程の表現は別途 done。

### TaskStatus — `TASK_STATUS_ROLE` (prisma: medication.prisma)
| value | role |
| --- | --- |
| pending | neutral |
| in_progress | info |
| completed | done |
| cancelled | blocked |

### IssueStatus — `ISSUE_STATUS_ROLE` (prisma: medication.prisma)
| value | role | 備考 |
| --- | --- | --- |
| open | confirm | 要対応 |
| in_progress | info | 対応中 |
| resolved | done | 解決 |
| dismissed | readonly | 却下=以後参照 |

### VisitProposalStatus — `VISIT_PROPOSAL_STATUS_ROLE` (prisma: visit.prisma)
| value | role | 備考 |
| --- | --- | --- |
| proposed | info | 提案中 |
| patient_contact_pending | waiting | 患者連絡待ち=他者待ち |
| confirmed | done | 確定 |
| rejected | blocked | 却下 |
| superseded | readonly | 差替済(過去) |
| expired | blocked | 期限切れ |
| reschedule_pending | confirm | 再調整待ち |

### PatientContactStatus — `PATIENT_CONTACT_STATUS_ROLE` (prisma: visit.prisma)
| value | role | 備考 |
| --- | --- | --- |
| pending | neutral | 未連絡 |
| attempted | info | 連絡試行 |
| confirmed | done | 確定 |
| declined | blocked | 拒否 |
| change_requested | confirm | 変更要望=要確認 |
| unreachable | blocked | 連絡不能 |

### RequestStatus — `REQUEST_STATUS_ROLE` (prisma: communication.prisma)
| value | role | 備考 |
| --- | --- | --- |
| draft | neutral | 下書き |
| sent | waiting | 送付済=相手回答待ち |
| received | info | 受領 |
| in_progress | info | 対応中 |
| responded | done | 回答済 |
| closed | readonly | クローズ |
| escalated | confirm | エスカレーション=要対応 |
| cancelled | blocked | 取消 |
| expired | blocked | 期限切れ |

### TracingReportStatus — `TRACING_REPORT_STATUS_ROLE` (prisma: communication.prisma)
| value | role |
| --- | --- |
| draft | neutral |
| sent | waiting |
| received | info |
| acknowledged | done |

### SelfReportStatus — `SELF_REPORT_STATUS_ROLE` (prisma: communication.prisma)
| value | role | 備考 |
| --- | --- | --- |
| submitted | confirm | 受領=トリアージ要対応 |
| triaged | info | トリアージ済 |
| converted_to_task | done | タスク化 |
| resolved | done | 解決 |
| dismissed | readonly | 却下 |

### PatientShareCaseStatus — `PATIENT_SHARE_CASE_STATUS_ROLE` (prisma: pharmacy-partnership.prisma)
| value | role | 備考 |
| --- | --- | --- |
| draft | neutral | 下書き |
| consent_pending | waiting | 同意待ち |
| partner_confirmation_pending | waiting | 相手確認待ち |
| active | done | 共有成立 |
| suspended | confirm | 一時停止=要対応 |
| revoked | blocked | 撤回 |
| ended | readonly | 終了 |
| declined | blocked | 辞退 |

### PharmacyVisitRequestStatus — `PHARMACY_VISIT_REQUEST_STATUS_ROLE` (prisma: pharmacy-partnership.prisma)
| value | role | 備考 |
| --- | --- | --- |
| draft | neutral | 下書き |
| requested | waiting | 相手の受諾待ち |
| accepted | info | 受諾 |
| declined | blocked | 辞退 |
| scheduled | info | 日程確定 |
| visited | info | 訪問済 |
| recording | info | 記録中 |
| submitted | waiting | 基幹薬局レビュー待ち |
| base_reviewing | waiting | 基幹薬局レビュー中 |
| returned | confirm | 差戻し |
| confirmed | info | 確認(後続あり) |
| physician_report_created | info | 報告書作成済(後続あり) |
| claim_checked | info | 算定確認済(後続あり) |
| completed | done | 完了 |

### PharmacyContractStatus — `PHARMACY_CONTRACT_STATUS_ROLE` (prisma: pharmacy-partnership.prisma)
| value | role | 備考 |
| --- | --- | --- |
| draft | neutral | 下書き |
| pending_base_approval | waiting | 基幹承認待ち |
| pending_partner_approval | waiting | 連携先承認待ち |
| active | done | 有効 |
| expired | blocked | 期限切れ |
| terminated | blocked | 解除 |
| suspended | confirm | 一時停止 |

### VisitBillingStatus — `VISIT_BILLING_STATUS_ROLE` (prisma: pharmacy-partnership.prisma)
| value | role | 備考 |
| --- | --- | --- |
| candidate | neutral | 算定候補=未確定 |
| confirmed | done | 確定 |
| excluded | readonly | 除外 |
| invoiced | done | 請求済 |
| voided | blocked | 無効化 |

### QrDraftStatus — `QR_DRAFT_STATUS_ROLE` (prisma: prescription.prisma)
| value | role |
| --- | --- |
| pending | neutral |
| confirmed | done |
| discarded | blocked |

### PackagingInstructionTag — `PACKAGING_INSTRUCTION_TAG_ROLE` (prisma: prescription.prisma)
| value | role | 備考 |
| --- | --- | --- |
| cold_storage | hazard | 冷所 |
| narcotic | hazard | 麻薬 |
| crush_prohibited | hazard | 粉砕禁止 |
| half_tablet | info | 半錠(作業指示) |
| separate_pack | info | 別包 |
| unit_dose | info | 一包化 |
| staple_required | info | ステープル |
| label_required | info | ラベル |

### DispenseAuditResult — `DISPENSE_AUDIT_RESULT_ROLE` (prisma: prescription.prisma)
| value | role |
| --- | --- |
| approved | done |
| rejected | blocked |
| hold | confirm |
| emergency_approved | done |

### SetAuditResult — `SET_AUDIT_RESULT_ROLE` (prisma: prescription.prisma)
| value | role |
| --- | --- |
| approved | done |
| partial_approved | confirm |
| rejected | blocked |

### SetCellState — `SET_CELL_STATE_ROLE` (prisma: prescription.prisma)
| value | role |
| --- | --- |
| pending | neutral |
| set | done |
| hold | confirm |

### SetAuditCellState — `SET_AUDIT_CELL_STATE_ROLE` (prisma: prescription.prisma)
| value | role | 備考 |
| --- | --- | --- |
| unaudited | neutral | 未監査 |
| ok | done | OK |
| ng | blocked | NG |

### UserAccountStatus — `USER_ACCOUNT_STATUS_ROLE` (prisma: organization.prisma)
| value | role | 備考 |
| --- | --- | --- |
| pending_cognito | waiting | Cognito連携待ち |
| invited | waiting | 招待済(応答待ち) |
| active | done | 有効 |
| suspended | blocked | 停止 |
| retired | readonly | 退職 |
| cognito_failed | blocked | 連携失敗 |

## 移行方針

1. **基盤フェーズ(本フェーズ)**: 中央トークン / 共通部品(`StateBadge`/`StatusDot`)/ `*_ROLE` マップ / SSOT文書 を整える(additive・非破壊)。
   既存の `*_VARIANTS` / `*_CONFIG` / 各画面のベタ書き Tailwind 状態色は温存する。
2. **消費者移行フェーズ(後続)**: family ごとに画面の状態表示を `StateBadge role={MAP[value]}` / `StatusDot` へ置換。
   `neutral` は既定 Badge / text-muted へ。移行完了した family の `*_VARIANTS` / `*_CONFIG` を別途削除する。
3. 本フェーズで削除済: `SCHEDULE_STATUS_STYLES`(参照0件の死にコード)。
4. 2026-06-20 削除: `src/lib/ui/badge-semantics.ts`(6軸と競合する重複セマンティック系 `urgent/attention/info/neutral/positive`)。唯一の消費者 `tasks-content.tsx` を `StateBadge` + `TASK_STATUS_ROLE`/`PRIORITY_ROLE` へ移行し、ロール割当を SSOT に追随(completed=done / pending=neutral / in_progress=info / priority urgent=confirm / low=readonly)。

## 移行対象

- status 系 enum / `*_LABELS` / `*_VARIANTS` / `*_CONFIG` を消費する画面・コンポーネントの状態バッジ / 状態ドット表現。
- 個別にベタ書きされた `bg-{red,green,blue,orange,yellow,gray}-100 text-*-800` 等の状態色。

## 移行対象外(除外)

- **chart / グラフの系列色**: `--chart-1..5` を使う。状態トークンを系列色へ流用しない。
- **純粋な装飾**(状態意味を持たない強調・区切り・背景)。
- **印刷 / PDF / 帳票** のスタイル(別系統。色依存しない設計を別途維持)。
- 状態意味を持たない区分値(GENDER / CHANNEL / VisitType / PackagingMethod / ReportType / ContactRelation 等)。これらは色を付けない。

## 意図的に raw パレットのまま残す「カテゴリ/臨床」色（2026-06-20 監査で確定・再フラグ不要）

6軸トークンは**状態（state）**を表すもの。以下は state ではなく「相互排他のカテゴリ」「臨床ハザード区分」であり、7軸へ畳むと別カテゴリが同色化して**識別性が退行**するため、固有 hue を保持する。将来は専用トークン体系（`--category-*` / 臨床ハザード `--hazard-narcotic/cold/unitdose` 等）を別途定義する設計判断が必要（本移行のスコープ外）。

- **臨床ハザードパレット**: `safety-board.tsx`（麻薬=赤 / 冷所=teal / 一包化=青 / 注意=橙）、`card-workspace.tsx` の麻薬/冷所 行ハイライト。teal が7軸に無く、安全標識の臨床区別を最優先するため固有色維持。
- **カテゴリ型パレット**（distinct category = distinct hue。chart 系列と同種の扱い）:
  - 投与経路 `prescription-history ROUTE_CONFIG`（内服/外用/注射/その他）・調剤方法 `METHOD_CONFIG`
  - 介入種別 `intervention-panel INTERVENTION_TYPE_COLORS`（7種）
  - 時間帯 `medication-calendar`（朝=黄/昼=青/夕=橙）
  - 連携カテゴリ `action-rail BLOCKED_CATEGORY_TONES`（患者=紫/事務=橙/医療機関=青）
  - 施設テーマ accent（`facility-*` / `patient-care-team-source-panel` / `patient-mcs-summary-card` 等の sky/emerald）— 文脈テーマであり state ではない。中立化は別途の UI 判断。
- **現在地（now-marker）= info(青)** に統一済（`dashboard-cockpit` / `schedule-team-board` 両方）。
