import { buildBearerHeaders, fetchJson, HttpAdapterError } from '../http-client';
import { readJsonObject } from '@/lib/db/json';

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

function readNonEmptyString(value: unknown) {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function readStringArray(value: unknown) {
  if (!Array.isArray(value)) return null;
  return value.every((item): item is string => typeof item === 'string') ? value : null;
}

function readFhirDate(value: unknown) {
  const date = readNonEmptyString(value);
  if (!date) return null;
  return /^\d{4}(?:-\d{2}(?:-\d{2})?)?$/.test(date) ? date : null;
}

function readPatientName(value: unknown): FhirPatient['name'][number] | null {
  const object = readJsonObject(value);
  if (!object) return null;

  const family = readNonEmptyString(object.family);
  const given = readStringArray(object.given);
  if (!family || !given) return null;

  return { family, given };
}

export function normalizeFhirPatient(value: unknown): FhirPatient | null {
  const object = readJsonObject(value);
  if (!object) return null;

  if (object.resourceType !== 'Patient') return null;
  const id = readNonEmptyString(object.id);
  const birthDate = readFhirDate(object.birthDate);
  const gender = readNonEmptyString(object.gender);
  if (!id || !birthDate || !gender || !Array.isArray(object.name)) return null;

  const name: FhirPatient['name'] = [];
  for (const item of object.name) {
    const patientName = readPatientName(item);
    if (!patientName) return null;
    name.push(patientName);
  }
  if (name.length === 0) return null;

  return {
    resourceType: 'Patient',
    id,
    name,
    birthDate,
    gender,
  };
}

function readCoding(
  value: unknown,
): FhirMedicationRequest['medicationCodeableConcept']['coding'][number] | null {
  const object = readJsonObject(value);
  if (!object) return null;

  const system = readNonEmptyString(object.system);
  const code = readNonEmptyString(object.code);
  const display = readNonEmptyString(object.display);
  if (!system || !code || !display) return null;

  return { system, code, display };
}

function readDoseAndRate(
  value: unknown,
): FhirMedicationRequest['dosageInstruction'][number]['doseAndRate'][number] | null {
  const object = readJsonObject(value);
  const doseQuantity = readJsonObject(object?.doseQuantity);
  if (!doseQuantity) return null;

  const unit = readNonEmptyString(doseQuantity.unit);
  if (typeof doseQuantity.value !== 'number' || !Number.isFinite(doseQuantity.value) || !unit) {
    return null;
  }

  return {
    doseQuantity: {
      value: doseQuantity.value,
      unit,
    },
  };
}

function readDosageInstruction(
  value: unknown,
): FhirMedicationRequest['dosageInstruction'][number] | null {
  const object = readJsonObject(value);
  const timing = readJsonObject(object?.timing);
  const code = readJsonObject(timing?.code);
  const text = readNonEmptyString(code?.text);
  if (!object || !text || !Array.isArray(object.doseAndRate)) return null;

  const doseAndRate: FhirMedicationRequest['dosageInstruction'][number]['doseAndRate'] = [];
  for (const item of object.doseAndRate) {
    const dose = readDoseAndRate(item);
    if (!dose) return null;
    doseAndRate.push(dose);
  }
  if (doseAndRate.length === 0) return null;

  return {
    timing: { code: { text } },
    doseAndRate,
  };
}

export function normalizeFhirMedicationRequest(value: unknown): FhirMedicationRequest | null {
  const object = readJsonObject(value);
  if (!object) return null;

  if (object.resourceType !== 'MedicationRequest') return null;
  const id = readNonEmptyString(object.id);
  const status = readNonEmptyString(object.status);
  const medicationCodeableConcept = readJsonObject(object.medicationCodeableConcept);
  if (
    !id ||
    !status ||
    !medicationCodeableConcept ||
    !Array.isArray(medicationCodeableConcept.coding) ||
    !Array.isArray(object.dosageInstruction)
  ) {
    return null;
  }

  const coding: FhirMedicationRequest['medicationCodeableConcept']['coding'] = [];
  for (const item of medicationCodeableConcept.coding) {
    const code = readCoding(item);
    if (!code) return null;
    coding.push(code);
  }

  const dosageInstruction: FhirMedicationRequest['dosageInstruction'] = [];
  for (const item of object.dosageInstruction) {
    const instruction = readDosageInstruction(item);
    if (!instruction) return null;
    dosageInstruction.push(instruction);
  }
  if (coding.length === 0 || dosageInstruction.length === 0) return null;

  return {
    resourceType: 'MedicationRequest',
    id,
    status,
    medicationCodeableConcept: {
      coding,
    },
    dosageInstruction,
  };
}

function unwrapResponseData(payload: unknown): unknown {
  const envelope = readJsonObject(payload);
  return envelope && 'data' in envelope ? envelope.data : payload;
}

function readMedicationRequestResources(payload: unknown): unknown[] | null {
  const unwrapped = unwrapResponseData(payload);
  if (unwrapped === null || unwrapped === undefined) return [];
  if (Array.isArray(unwrapped)) return unwrapped;

  const object = readJsonObject(unwrapped);
  if (!object) return null;
  if (object.resourceType !== 'Bundle') return null;
  if (object.entry === undefined) return [];
  if (!Array.isArray(object.entry)) return null;

  const resources: unknown[] = [];
  for (const entry of object.entry) {
    const entryObject = readJsonObject(entry);
    if (!entryObject) return null;
    if (entryObject.resource === undefined || entryObject.resource === null) continue;
    resources.push(entryObject.resource);
  }

  return resources;
}

export class FhirAdapter {
  constructor(
    private readonly baseUrl: string,
    private readonly options?: {
      accessToken?: string;
      apiKey?: string;
    },
  ) {}

  async getPatient(id: string): Promise<FhirPatient | null> {
    const { status, data } = await fetchJson<FhirPatient | { data?: FhirPatient }>(
      `${this.baseUrl.replace(/\/$/, '')}/Patient/${encodeURIComponent(id)}`,
      {
        headers: buildBearerHeaders(this.options?.accessToken, this.options?.apiKey),
      },
    );
    if (status === 404) return null;
    if (status >= 400) {
      throw new HttpAdapterError('FHIR Patient 取得に失敗しました', status, data);
    }
    const unwrapped = unwrapResponseData(data);
    if (unwrapped === null || unwrapped === undefined) return null;
    const patient = normalizeFhirPatient(unwrapped);
    if (!patient) {
      throw new HttpAdapterError('FHIR Patient レスポンス形式が不正です', status, data);
    }
    return patient;
  }

  async getMedicationRequests(patientId: string): Promise<FhirMedicationRequest[]> {
    const { status, data } = await fetchJson<
      | FhirBundle<FhirMedicationRequest>
      | FhirMedicationRequest[]
      | { data?: FhirMedicationRequest[] }
    >(
      `${this.baseUrl.replace(/\/$/, '')}/MedicationRequest?patient=${encodeURIComponent(patientId)}`,
      {
        headers: buildBearerHeaders(this.options?.accessToken, this.options?.apiKey),
      },
    );
    if (status >= 400) {
      throw new HttpAdapterError('FHIR MedicationRequest 検索に失敗しました', status, data);
    }
    const resources = readMedicationRequestResources(data);
    if (!resources) {
      throw new HttpAdapterError('FHIR MedicationRequest レスポンス形式が不正です', status, data);
    }

    const requests: FhirMedicationRequest[] = [];
    for (const resource of resources) {
      const request = normalizeFhirMedicationRequest(resource);
      if (!request) {
        throw new HttpAdapterError('FHIR MedicationRequest レスポンス形式が不正です', status, data);
      }
      requests.push(request);
    }

    return requests;
  }

  async createMedicationDispense(data: Record<string, unknown>): Promise<void> {
    const result = await fetchJson<Record<string, unknown>>(
      `${this.baseUrl.replace(/\/$/, '')}/MedicationDispense`,
      {
        method: 'POST',
        headers: buildBearerHeaders(this.options?.accessToken, this.options?.apiKey),
        body: data,
      },
    );
    if (result.status >= 400) {
      throw new HttpAdapterError(
        'FHIR MedicationDispense 登録に失敗しました',
        result.status,
        result.data,
      );
    }
  }
}
