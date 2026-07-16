-- Support the tenant/user unread notification stream's stable (created_at, id)
-- cursor without scanning unrelated tenants or a user's full notification history.
CREATE INDEX "Notification_stream_poll_idx"
ON "Notification"("org_id", "user_id", "is_read", "created_at", "id");
