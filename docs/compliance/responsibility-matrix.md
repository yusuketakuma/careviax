# 責任分界表（System of Record / Integration Boundary）

## 目的
PH-OS と外部システムの責任分界を、実装前に固定するための文書。
Plans.md の `D-12` と `0-2h SourceOfTruthMatrix / IntegrationBoundary` に対応し、以下を定義する。

- PH-OS 正本か、外部正本か
- 同期方向
- 障害時の暫定運用
- 復旧時の再同期手順

## 運用原則
- PH-OS は「訪問運用・連携・持参判断・算定根拠」の正本を持つ。
- レセコンは「処方原本・確定調剤実績・レセプト提出」の正本を持つ。
- 電子薬歴は「連携先」であり、PH-OS の訪問 SOAP を受け取る。
- 在庫システムは「厳密在庫」の正本を持ち、PH-OS は訪問準備用の薄い採用薬/持参判断だけを持つ。
- 共有参照マスタは `org_id` を持たない例外とし、テナント業務データのみ `org_id` を必須にする。

## SourceOfTruthMatrix

| entity_type | 対象データ | PH-OS 正本 | 外部正本 | 同期方向 | 障害時の暫定運用 | 復旧手順 |
|---|---|---|---|---|---|---|
| `patient_basic` | `Patient` / `Residence` / `ContactParty` / `CareCase` の在宅運用情報 | 在宅訪問に必要な患者基本・連絡先・訪問条件・ケース状態 | レセコンの患者台帳/保険基本情報 | `pull` 起点、以後は手動照合 | レセコン情報を参照しながら PH-OS に最低限入力して運用継続 | レセコン再取込後に患者単位で差分比較し、氏名/保険/連絡先を手動確定する |
| `prescription_original` | `PrescriptionIntake.original_document_url` と原本属性 | 構造化コピーとワークフロー状態 | レセコン / 電子処方箋 / 原本ファイル | `pull` | 原本 PDF/紙/FAX を参照して構造化し、疑義照会前は原本優先 | 連携復旧後に原本識別子で再照合し、構造化明細との差分を `WorkflowException` で解消する |
| `dispense_result` | `DispenseTask` / `DispenseResult` / `DispenseAudit` の進行中実績 | 訪問業務で使う暫定作業実績と監査状態 | レセコンの確定調剤実績 | `push` + 差分照合 | PH-OS 上で調剤/鑑査を継続し、確定連携待ちとして保持 | レセコン反映後に患者・処方単位で差分照合し、不一致は再送または手動修正する |
| `carry_items` | `VisitSchedule.carry_items` / `VisitPreparation` / セット結果 | 訪問持参物・預け・後送判断の唯一正本 | なし | `internal` | PH-OS が単独で持参判定を維持する | `DispenseResult` / `SetAudit` / `VisitSchedule` から再計算し、出発前チェックを再実行する |
| `report_delivery` | `CareReport` / `DeliveryRecord` / `CommunicationEvent` | 作成・送達・確認・返信待ち状態 | SES/FAX/電話記録、必要に応じて電子薬歴 | `push` | 送信履歴を PH-OS へ集約し、外部送達証跡は添付/メモで補完 | プロバイダ送信結果や手動記録を再取込し、未確認は `response_waiting` として再起票する |
| `billing` | `BillingEvidence` / `BillingCandidate` / `BillingRule(home_care_ssot)` | 算定根拠と請求候補の唯一正本 | レセコンの最終請求送信結果 | `push` | PH-OS で候補生成・除外判断を継続し、提出は保留する | `BillingEvidence` から候補を再生成し、レセコン連携履歴と比較して再送または除外理由を更新する |

## システム別の責任境界

| データ項目 | PH-OS | レセコン | 電子薬歴 | 在庫システム | 備考 |
|---|---|---|---|---|---|
| 患者基本情報 | R/A | C | I | — | 初回取込元はレセコンだが、在宅運用属性は PH-OS 正本 |
| 処方原本 | R（構造化コピー/進行管理） | A | I | — | 原本の法的正本はレセコン/電子処方箋/受領原本 |
| 調剤実績 | R（作業中） | A（確定値） | I | C | PH-OS は訪問運用用の暫定値、確定値はレセコン |
| 訪問持参情報 | A | I | I | C | PH-OS 専用ドメイン |
| 薬歴（SOAP） | A | — | I | — | PH-OS で作成し、必要に応じて電子薬歴へ連携 |
| 報告書送達 | A | — | I | — | PH-OS が draft/sent/confirmed/response_waiting を保持 |
| 在庫データ | I | — | — | A | PH-OS は採用薬/持参可否の薄い層のみ |
| レセプト提出 | I | A | — | — | PH-OS は請求候補と根拠を作るが提出はしない |
| 同意書管理 | A | — | — | — | PH-OS で取得・期限管理・撤回管理 |
| 監査ログ | A（PH-OS内） | A | A | A | 各システムが自システムのログを保持 |

## `org_id` を持たない例外

以下は共有参照データ、またはテナント階層の最上位/共通設定であり、`org_id` の例外とする。

- `Organization`: テナントルート
- `LabelDictionary`: 画面文言辞書
- `DrugMaster`, `DrugPackageInsert`, `DrugInteraction`, `DrugAlertRule`, `GenericDrugMapping`, `DrugMasterImportLog`: 公開ソースから取り込む共有医薬品参照マスタ

## 連携停止時の優先運用

| 連携停止 | 継続する業務 | 停止する業務 | 復旧後の必須処理 |
|---|---|---|---|
| レセコン → PH-OS 取込停止 | 訪問準備、訪問記録、報告書作成 | 新規処方の自動取込、確定請求連携 | 原本再取込、差分照合、請求候補の再生成 |
| PH-OS → レセコン 送信停止 | 訪問記録、算定根拠整備 | 請求候補の確定送信 | `BillingEvidence` / `BillingCandidate` を再送し重複提出を確認 |
| PH-OS → 電子薬歴 送信停止 | PH-OS 内で SOAP 記録継続 | 外部薬歴への自動反映 | 報告 PDF または API 再送で整合回復 |
| 在庫システム連携停止 | 訪問持参判定、暫定調剤計画 | 厳密在庫前提の自動提案 | 在庫差分を再確認し、欠品候補を再評価 |

## 更新履歴

| 日付 | 更新内容 | 承認者 |
|---|---|---|
| 2026-03-27 | D-12 対応として SourceOfTruthMatrix と復旧手順を明文化 | — |
