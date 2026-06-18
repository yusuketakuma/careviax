export type LegacyPlaintextSoapDraftFields = {
  soapSubjective?: string;
  soapObjective?: string;
  soapAssessment?: string;
  soapPlan?: string;
};

export function purgeLegacyPlaintextSoapDraftFields(draft: LegacyPlaintextSoapDraftFields): void {
  delete draft.soapSubjective;
  delete draft.soapObjective;
  delete draft.soapAssessment;
  delete draft.soapPlan;
}
