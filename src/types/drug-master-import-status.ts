import type { ImportSource, ImportStatus } from '@prisma/client';

export type DrugMasterImportFreshnessLevel = 'fresh' | 'aging' | 'stale' | 'never';

export type DrugMasterImportStatusResponse = {
  sources: Array<{
    source: ImportSource;
    label: string;
    is_free: boolean;
    threshold_days: number;
    last_success: {
      imported_at: string;
      record_count: number;
      days_ago: number | null;
    } | null;
    last_failure: {
      imported_at: string;
      error: string | null;
    } | null;
    recent_runs_30d: {
      total: number;
      failed: number;
      failure_streak: number;
      latest_status: ImportStatus | null;
      latest_imported_at: string | null;
    };
    freshness: DrugMasterImportFreshnessLevel;
  }>;
  totals: {
    drug_master_count: number;
    hot_code_coverage: number;
    package_insert_count: number;
    interaction_count: number;
    active_alert_rule_count: number;
    generic_mapping_count: number;
  };
  checked_at: string;
};
