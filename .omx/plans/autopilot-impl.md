# Autopilot Implementation Plan: UI/UX Improvement

1. 共通ヘッダー改善
   - `WorkflowPageHeader` に eyebrow と supplementary content の受け皿を追加する
   - `WorkflowPageIntro` は新しい header surface を使えるように保つ

2. ページ冒頭の整理
   - `patients/page.tsx` と `reports/page.tsx` の説明文・ショートカット・補助案内を再構成する
   - 可能な範囲で patient detail 冒頭も同じ粒度に揃える

3. 一覧本文の再グルーピング
   - `patients-table.tsx` でフィルタ、オペレーションサマリー、補助導線、一覧を分離する
   - `reports-table.tsx` でフィルタ、送達状況サマリー、一覧を分離する

4. 回帰防止
   - `WorkflowPageHeader` の focused test を追加する
   - 既存 `WorkflowPageIntro` test を必要に応じて補強する

5. 検証
   - focused Vitest
   - focused Playwright layout/detail specs
