import { prisma } from '@/lib/db/client';

export type CdsAlert = {
  type: string;
  severity: 'critical' | 'warning' | 'info';
  message: string;
  details?: Record<string, unknown>;
};

/**
 * Runs clinical decision support checks at dispense time.
 * Checks: drug interactions (contraindicated), duplicate medications, max administration days.
 */
export async function checkDispenseAlerts(
  orgId: string,
  cycleId: string,
  patientId: string
): Promise<CdsAlert[]> {
  const alerts: CdsAlert[] = [];

  // Fetch prescription lines for this cycle
  const prescriptionLines = await prisma.prescriptionLine.findMany({
    where: {
      intake: { cycle_id: cycleId },
      org_id: orgId,
    },
    select: {
      id: true,
      drug_name: true,
      drug_code: true,
      days: true,
    },
  });

  // Fetch current medications for this patient
  // MedicationProfile links to DrugMaster via drug_master_id (no direct drug_code field)
  const currentMeds = await prisma.medicationProfile.findMany({
    where: { patient_id: patientId, is_current: true, org_id: orgId },
    select: {
      id: true,
      drug_name: true,
      drug_master_id: true,
    },
  });

  // Resolve drug_master yj_codes for current meds that have drug_master_id
  const currentMedMasterIds = currentMeds
    .map((m) => m.drug_master_id)
    .filter((id): id is string => id !== null && id !== undefined);

  const currentDrugMasters = currentMedMasterIds.length > 0
    ? await prisma.drugMaster.findMany({
        where: { id: { in: currentMedMasterIds } },
        select: { id: true, yj_code: true, drug_name: true },
      })
    : [];

  const masterByMedId = new Map<string, { yj_code: string; drug_name: string }>();
  for (const med of currentMeds) {
    if (med.drug_master_id) {
      const master = currentDrugMasters.find((dm) => dm.id === med.drug_master_id);
      if (master) {
        masterByMedId.set(med.id, master);
      }
    }
  }

  // 1. Drug interaction check (contraindicated) using YJ codes
  for (const line of prescriptionLines) {
    if (!line.drug_code) continue;

    for (const med of currentMeds) {
      const medMaster = masterByMedId.get(med.id);
      if (!medMaster) continue;

      const interaction = await prisma.drugInteraction.findFirst({
        where: {
          OR: [
            {
              drug_a: { yj_code: line.drug_code },
              drug_b: { yj_code: medMaster.yj_code },
            },
            {
              drug_a: { yj_code: medMaster.yj_code },
              drug_b: { yj_code: line.drug_code },
            },
          ],
          severity: 'contraindicated',
        },
        select: { mechanism: true, clinical_effect: true },
      });

      if (interaction) {
        alerts.push({
          type: 'interaction',
          severity: 'critical',
          message: `併用禁忌: ${line.drug_name} × ${med.drug_name}`,
          details: {
            mechanism: interaction.mechanism ?? undefined,
            effect: interaction.clinical_effect ?? undefined,
          },
        });
      }
    }
  }

  // 2. Duplicate medication check using drug_name matching (fallback since MedicationProfile has no drug_code)
  for (const line of prescriptionLines) {
    // Check by YJ code if available
    if (line.drug_code) {
      const dupByCode = currentMeds.find((m) => {
        const master = masterByMedId.get(m.id);
        return master?.yj_code === line.drug_code;
      });
      if (dupByCode) {
        alerts.push({
          type: 'duplicate',
          severity: 'warning',
          message: `重複投薬: ${line.drug_name}`,
        });
        continue;
      }
    }

    // Fallback: drug_name exact match
    const dupByName = currentMeds.find(
      (m) => m.drug_name === line.drug_name
    );
    if (dupByName) {
      alerts.push({
        type: 'duplicate',
        severity: 'warning',
        message: `重複投薬: ${line.drug_name}`,
      });
    }
  }

  // 3. Max administration days check
  for (const line of prescriptionLines) {
    if (!line.drug_code) continue;

    const drug = await prisma.drugMaster.findFirst({
      where: { yj_code: line.drug_code },
      select: { max_administration_days: true, drug_name: true },
    });

    if (drug?.max_administration_days && line.days > drug.max_administration_days) {
      alerts.push({
        type: 'max_days',
        severity: 'critical',
        message: `投与日数制限超過: ${line.drug_name}（上限${drug.max_administration_days}日、処方${line.days}日）`,
        details: {
          max_days: drug.max_administration_days,
          prescribed_days: line.days,
        },
      });
    }
  }

  return alerts;
}
