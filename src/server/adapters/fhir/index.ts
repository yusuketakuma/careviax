import { buildBearerHeaders, fetchJson, HttpAdapterError, unwrapDataEnvelope } from '../http-client';

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

type FhirBundle<T> = {
  resourceType: 'Bundle';
  entry?: Array<{ resource?: T }>;
};

export class FhirAdapter {
  constructor(
    private readonly baseUrl: string,
    private readonly options?: {
      accessToken?: string;
      apiKey?: string;
    }
  ) {}

  async getPatient(id: string): Promise<FhirPatient | null> {
    const { status, data } = await fetchJson<FhirPatient | { data?: FhirPatient }>(
      `${this.baseUrl.replace(/\/$/, '')}/Patient/${encodeURIComponent(id)}`,
      {
        headers: buildBearerHeaders(this.options?.accessToken, this.options?.apiKey),
      }
    );
    if (status === 404) return null;
    if (status >= 400) {
      throw new HttpAdapterError('FHIR Patient 取得に失敗しました', status, data);
    }
    return unwrapDataEnvelope(data);
  }

  async getMedicationRequests(patientId: string): Promise<FhirMedicationRequest[]> {
    const { status, data } = await fetchJson<
      FhirBundle<FhirMedicationRequest> | FhirMedicationRequest[] | { data?: FhirMedicationRequest[] }
    >(`${this.baseUrl.replace(/\/$/, '')}/MedicationRequest?patient=${encodeURIComponent(patientId)}`, {
      headers: buildBearerHeaders(this.options?.accessToken, this.options?.apiKey),
    });
    if (status >= 400) {
      throw new HttpAdapterError('FHIR MedicationRequest 検索に失敗しました', status, data);
    }
    if (!data) return [];
    if (Array.isArray(data)) return data;
    if ('data' in data) {
      return unwrapDataEnvelope<FhirMedicationRequest[]>(data) ?? [];
    }
    return (data as FhirBundle<FhirMedicationRequest>).entry?.flatMap((entry) =>
      entry.resource ? [entry.resource] : []
    ) ?? [];
  }

  async createMedicationDispense(data: Record<string, unknown>): Promise<void> {
    const result = await fetchJson<Record<string, unknown>>(
      `${this.baseUrl.replace(/\/$/, '')}/MedicationDispense`,
      {
        method: 'POST',
        headers: buildBearerHeaders(this.options?.accessToken, this.options?.apiKey),
        body: data,
      }
    );
    if (result.status >= 400) {
      throw new HttpAdapterError('FHIR MedicationDispense 登録に失敗しました', result.status, result.data);
    }
  }
}
