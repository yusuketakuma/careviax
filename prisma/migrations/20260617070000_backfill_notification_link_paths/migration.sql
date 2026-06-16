-- 調剤ワークベンチ移行に伴う Notification.link の旧パス backfill。
-- ルート改称: /auditing → /audit, /medication-sets → /set。
-- 旧パスを指す履歴通知が開けなくなるのを防ぐ。冪等・非破壊（既存 /audit・/set 行は LIKE 前方一致で対象外）。
-- regexp_replace でパス先頭のみ置換し、クエリ文字列やフラグメント（?taskId=... など）は保持する。

-- /auditing → /audit （/auditing 単体および /auditing/... /auditing?... を前方一致で対象に）
UPDATE "Notification"
SET "link" = regexp_replace("link", '^/auditing(/|\?|#|$)', '/audit\1')
WHERE "link" LIKE '/auditing%';

-- /medication-sets → /set
UPDATE "Notification"
SET "link" = regexp_replace("link", '^/medication-sets(/|\?|#|$)', '/set\1')
WHERE "link" LIKE '/medication-sets%';
