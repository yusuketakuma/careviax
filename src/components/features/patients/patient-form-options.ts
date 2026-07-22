import { messageFromError, type FixedRecoveryCopy } from '@/lib/utils/error-message';
import {
  adlLabels,
  asepticPreparationNeedLabels,
  careLevelLabels,
  confirmationStatusLabels,
  contactMethodLabels,
  dementiaLabels,
  firstVisitSlotLabels,
  homeCareStatusLabels,
  homeCareBillingCategoryLabels,
  homePharmacyAddOn2CandidateLabels,
  emergencyResponseLabels,
  housingTypeLabels,
  medicationSupportLabels,
  medicationManagerLabels,
  medicalHomeManagementSectionLabels,
  medicalHomeManagementTypeLabels,
  moneyManagementLabels,
  narcoticUseCategoryLabels,
  requesterProfessionLabels,
  singleBuildingCountLabels,
  specialProcedureLabels,
  supportStatusLabels,
  triageRiskLabels,
  visitFrequencyLabels,
  visitingNurseFrequencyLabels,
} from '@/lib/patient/home-visit-intake';

export const optionalBooleanFieldOptions = {
  setValueAs: (value: string) => {
    if (value === '') return undefined;
    return value === 'true';
  },
};
export const optionalNumberFieldOptions = {
  setValueAs: (value: string) => {
    if (value === '') return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  },
};
export const optionalTextFieldOptions = {
  setValueAs: (value: string) => (value === '' ? undefined : value),
};
function formatOptionLabelMap(labelMap: Record<string, string>) {
  return Object.entries(labelMap).map(([value, label]) => ({ value, label }));
}
export function queryErrorMessage<const Fallback extends string>(
  errorValue: unknown,
  fallback: FixedRecoveryCopy<Fallback>,
) {
  return messageFromError(errorValue, fallback);
}
export const requesterProfessionOptions = formatOptionLabelMap(requesterProfessionLabels);
export const contactMethodOptions = formatOptionLabelMap(contactMethodLabels);
export const housingTypeOptions = formatOptionLabelMap(housingTypeLabels);
export const firstVisitSlotOptions = formatOptionLabelMap(firstVisitSlotLabels);
export const careLevelOptions = formatOptionLabelMap(careLevelLabels);
export const adlOptions = formatOptionLabelMap(adlLabels);
export const dementiaOptions = formatOptionLabelMap(dementiaLabels);
export const moneyManagementOptions = formatOptionLabelMap(moneyManagementLabels);
export const homeCareStatusOptions = formatOptionLabelMap(homeCareStatusLabels);
export const emergencyResponseOptions = formatOptionLabelMap(emergencyResponseLabels);
export const visitFrequencyOptions = formatOptionLabelMap(visitFrequencyLabels);
export const medicationManagerOptions = formatOptionLabelMap(medicationManagerLabels);
export const supportStatusOptions = formatOptionLabelMap(supportStatusLabels);
export const triageRiskOptions = formatOptionLabelMap(triageRiskLabels);
export const medicationSupportOptions = formatOptionLabelMap(medicationSupportLabels);
export const specialProcedureOptions = formatOptionLabelMap(specialProcedureLabels);
export const addOn2CandidateOptions = formatOptionLabelMap(homePharmacyAddOn2CandidateLabels);
export const singleBuildingCountOptions = formatOptionLabelMap(singleBuildingCountLabels);
export const homeCareBillingCategoryOptions = formatOptionLabelMap(homeCareBillingCategoryLabels);
export const medicalHomeManagementTypeOptions = formatOptionLabelMap(
  medicalHomeManagementTypeLabels,
);
export const medicalHomeManagementSectionOptions = formatOptionLabelMap(
  medicalHomeManagementSectionLabels,
);
export const confirmationStatusOptions = formatOptionLabelMap(confirmationStatusLabels);
export const narcoticUseCategoryOptions = formatOptionLabelMap(narcoticUseCategoryLabels);
export const asepticPreparationNeedOptions = formatOptionLabelMap(asepticPreparationNeedLabels);
export const visitingNurseFrequencyOptions = formatOptionLabelMap(visitingNurseFrequencyLabels);
