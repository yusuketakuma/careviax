export type DrugPriceVersionSnapshotRow = {
  drug_master_id: string;
  effective_from: Date;
  effective_to: Date | null;
};

export function selectLatestDrugPriceVersionsByDrugMasterIdForAsOf<
  T extends DrugPriceVersionSnapshotRow,
>(versions: T[], asOf: Date) {
  const latestVersionByDrugMasterId = new Map<string, T>();
  for (const version of versions) {
    if (version.effective_from > asOf) continue;
    if (version.effective_to && version.effective_to < asOf) continue;
    if (!latestVersionByDrugMasterId.has(version.drug_master_id)) {
      latestVersionByDrugMasterId.set(version.drug_master_id, version);
    }
  }
  return latestVersionByDrugMasterId;
}
