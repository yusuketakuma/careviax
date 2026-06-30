type DrugMasterImportResponseLog = {
  source_file_hash?: string | null;
  source_published_at?: Date | string | null;
  import_mode?: string | null;
  change_summary?: unknown;
};

function serializeDateLike(value: Date | string | null | undefined) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return value;
}

export function projectDrugMasterImportLogMetadata(log: DrugMasterImportResponseLog) {
  return {
    sourceFileHash: log.source_file_hash ?? null,
    sourcePublishedAt: serializeDateLike(log.source_published_at),
    importMode: log.import_mode ?? null,
    changeSummary: log.change_summary ?? null,
  };
}
