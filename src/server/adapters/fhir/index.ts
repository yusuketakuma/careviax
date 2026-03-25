/**
 * HL7 FHIR R4 Adapter — placeholder
 * Will connect to Japan's e-Prescription Management Service
 */

export interface FhirPatient {
  resourceType: 'Patient';
  id: string;
  name: Array<{ family: string; given: string[] }>;
  birthDate: string;
  gender: string;
}

export interface FhirMedicationRequest {
  resourceType: 'MedicationRequest';
  id: string;
  status: string;
  medicationCodeableConcept: {
    coding: Array<{ system: string; code: string; display: string }>;
  };
  dosageInstruction: Array<{
    timing: { code: { text: string } };
    doseAndRate: Array<{ doseQuantity: { value: number; unit: string } }>;
  }>;
}

export class FhirAdapter {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  async getPatient(id: string): Promise<FhirPatient | null> {
    // TODO: Implement FHIR R4 Patient resource fetch
    console.log(`[FHIR] GET ${this.baseUrl}/Patient/${id} — not implemented`);
    return null;
  }

  async getMedicationRequests(patientId: string): Promise<FhirMedicationRequest[]> {
    // TODO: Implement FHIR R4 MedicationRequest search
    console.log(`[FHIR] GET ${this.baseUrl}/MedicationRequest?patient=${patientId} — not implemented`);
    return [];
  }

  async createMedicationDispense(data: Record<string, unknown>): Promise<void> {
    // TODO: Implement FHIR R4 MedicationDispense create
    console.log(`[FHIR] POST ${this.baseUrl}/MedicationDispense — not implemented`, data);
  }
}
