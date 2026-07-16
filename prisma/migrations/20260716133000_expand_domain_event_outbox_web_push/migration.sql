ALTER TABLE "DomainEventOutbox"
  DROP CONSTRAINT "DomainEventOutbox_reference_only_chk";

ALTER TABLE "DomainEventOutbox"
  ADD CONSTRAINT "DomainEventOutbox_reference_only_chk" CHECK (
    "pii_class" = 'reference_only'
    AND "event_type" = 'notification.delivery.requested'
    AND jsonb_typeof(COALESCE("metadata", '{}'::jsonb)) = 'object'
    AND COALESCE("metadata"->>'source_event_type', '') <> ''
    AND COALESCE("metadata", '{}'::jsonb) - 'channel' - 'source_event_type' - 'notification_type' = '{}'::jsonb
    AND (
      (
        "aggregate_type" = 'user'
        AND COALESCE("metadata"->>'channel', '') IN ('sms', 'line')
        AND NOT COALESCE("metadata", '{}'::jsonb) ? 'notification_type'
      )
      OR
      (
        "aggregate_type" = 'push_subscription'
        AND COALESCE("metadata"->>'channel', '') = 'web_push'
        AND COALESCE("metadata"->>'notification_type', '') IN ('urgent', 'business', 'reminder', 'system')
      )
    )
  );
