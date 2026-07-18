-- PHI-free aggregate inventory only. Do not select target IDs or raw changes JSON.
SELECT
  "action",
  COUNT(*)::bigint AS audit_count,
  COUNT(*) FILTER (WHERE "changes" ? 'before' AND "changes"->'before' ? 'title')::bigint
    AS before_title_key_count,
  COUNT(*) FILTER (WHERE "changes" ? 'before' AND "changes"->'before' ? 'summary')::bigint
    AS before_summary_key_count,
  COUNT(*) FILTER (WHERE "changes" ? 'before' AND "changes"->'before' ? 'content')::bigint
    AS before_content_key_count,
  COUNT(*) FILTER (WHERE "changes" ? 'after' AND "changes"->'after' ? 'title')::bigint
    AS after_title_key_count,
  COUNT(*) FILTER (WHERE "changes" ? 'after' AND "changes"->'after' ? 'summary')::bigint
    AS after_summary_key_count,
  COUNT(*) FILTER (WHERE "changes" ? 'after' AND "changes"->'after' ? 'content')::bigint
    AS after_content_key_count
FROM "AuditLog"
WHERE "target_type" = 'management_plan'
GROUP BY "action"
ORDER BY "action";
