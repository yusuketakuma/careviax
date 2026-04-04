/**
 * 調剤ドメイン
 *
 * 責務: 調剤ドラフトの確認・確定（薬剤師が操作）
 *
 * サブモジュール:
 * - packaging: パッケージング方法の定義・パース・タグ抽出
 * - set-methods: セット方式の定義
 * - set-plan-packaging: セット計画のパッケージングサマリ構築
 * - set-batch-history: セットバッチの変更履歴スナップショット
 * - prefill-generator: 処方データから調剤ドラフト内容を生成（compute-on-GET）
 * - packaging-group: 薬剤グループ化ロジック
 * - workflow-order: 調剤キューのソート
 * - constants: ハイリスク薬キーワード、carry_type 定義
 * - date-continuity: 日付連続性チェック
 */
