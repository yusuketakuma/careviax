import { buildBearerHeaders, fetchJson, HttpAdapterError } from '../http-client';
import { readJsonObject } from '@/lib/db/json';

export const JP_CORE_VERSION = '1.2.0';
export const FHIR_R4_VERSION = '4.0.1';

const FHIR_RESOURCE_RESPONSE_MAX_BYTES = 512 * 1024;
const FHIR_SEARCH_RESPONSE_MAX_BYTES = 2 * 1024 * 1024;

export interface FhirCoding {
  system: string;
  code: string;
  display?: string;
}

export interface FhirIdentifier {
  system?: string;
  value: string;
  use?: string;
  type?: {
    coding: FhirCoding[];
    text?: string;
  };
  assigner?: {
    reference?: string;
    display?: string;
  };
}

export interface FhirReference {
  reference?: string;
  identifier?: FhirIdentifier;
  display?: string;
}

export interface FhirMeta {
  versionId?: string;
  lastUpdated?: string;
  profile: string[];
}

export interface FhirCodeableConcept {
  coding: FhirCoding[];
  text?: string;
}

export interface FhirQuantity {
  value: number;
  unit: string;
  system?: string;
  code?: string;
}

export interface FhirDosageInstruction {
  text?: string;
  timing?: { code: { text: string } };
  doseAndRate: Array<{ doseQuantity: FhirQuantity }>;
}

export interface FhirPatient {
  resourceType: 'Patient';
  id: string;
  meta?: FhirMeta;
  identifier?: FhirIdentifier[];
  name: Array<{ family: string; given: string[] }>;
  birthDate: string;
  gender: string;
}

export interface FhirMedicationRequest {
  resourceType: 'MedicationRequest';
  id: string;
  meta?: FhirMeta;
  identifier?: FhirIdentifier[];
  status: string;
  intent: string;
  medicationCodeableConcept: FhirCodeableConcept;
  subject: FhirReference;
  authoredOn?: string;
  dosageInstruction: FhirDosageInstruction[];
  dispenseRequest?: {
    quantity?: FhirQuantity;
    expectedSupplyDuration?: FhirQuantity;
  };
}

export interface FhirMedicationDispense {
  resourceType: 'MedicationDispense';
  id: string;
  meta?: FhirMeta;
  identifier?: FhirIdentifier[];
  status: string;
  medicationCodeableConcept: FhirCodeableConcept;
  subject: FhirReference;
  authorizingPrescription: FhirReference[];
  quantity?: FhirQuantity;
  daysSupply?: FhirQuantity;
  whenPrepared?: string;
  whenHandedOver?: string;
  dosageInstruction: FhirDosageInstruction[];
}

export interface FhirMedicationStatement {
  resourceType: 'MedicationStatement';
  id: string;
  meta?: FhirMeta;
  identifier?: FhirIdentifier[];
  status: string;
  medicationCodeableConcept: FhirCodeableConcept;
  subject: FhirReference;
  basedOn: FhirReference[];
  partOf: FhirReference[];
  effectiveDateTime?: string;
  dateAsserted?: string;
  informationSource?: FhirReference;
  derivedFrom: FhirReference[];
  dosage: FhirDosageInstruction[];
}

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

function readFhirDateTime(value: unknown) {
  const dateTime = readNonEmptyString(value);
  if (!dateTime) return null;
  return Number.isNaN(Date.parse(dateTime)) ? null : dateTime;
}

function readPatientName(value: unknown): FhirPatient['name'][number] | null {
  const object = readJsonObject(value);
  if (!object) return null;

  const family = readNonEmptyString(object.family);
  const given = readStringArray(object.given);
  if (!family || !given) return null;

  return { family, given };
}

function readCoding(value: unknown): FhirCoding | null {
  const object = readJsonObject(value);
  if (!object) return null;

  const system = readNonEmptyString(object.system);
  const code = readNonEmptyString(object.code);
  const display = readNonEmptyString(object.display) ?? undefined;
  if (!system || !code) return null;

  return { system, code, ...(display ? { display } : {}) };
}

function readCodingArray(value: unknown): FhirCoding[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;

  const coding: FhirCoding[] = [];
  for (const item of value) {
    const code = readCoding(item);
    if (!code) return null;
    coding.push(code);
  }
  return coding;
}

function readCodeableConcept(value: unknown): FhirCodeableConcept | null {
  const object = readJsonObject(value);
  if (!object || !Array.isArray(object.coding)) return null;

  const coding = readCodingArray(object.coding);
  if (!coding || coding.length === 0) return null;

  const text = readNonEmptyString(object.text) ?? undefined;
  return text ? { coding, text } : { coding };
}

function readIdentifier(value: unknown): FhirIdentifier | null {
  const object = readJsonObject(value);
  if (!object) return null;

  const valueString = readNonEmptyString(object.value);
  if (!valueString) return null;

  const identifier: FhirIdentifier = { value: valueString };
  const system = readNonEmptyString(object.system);
  const use = readNonEmptyString(object.use);
  if (system) identifier.system = system;
  if (use) identifier.use = use;

  const type = readJsonObject(object.type);
  if (type) {
    const coding = readCodingArray(type.coding);
    if (!coding) return null;
    const text = readNonEmptyString(type.text) ?? undefined;
    identifier.type = text ? { coding, text } : { coding };
  }

  const assignerObject = readJsonObject(object.assigner);
  if (assignerObject) {
    const reference = readNonEmptyString(assignerObject.reference) ?? undefined;
    const display = readNonEmptyString(assignerObject.display) ?? undefined;
    if (reference || display) identifier.assigner = { reference, display };
  }

  return identifier;
}

function readIdentifierArray(value: unknown): FhirIdentifier[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;

  const identifiers: FhirIdentifier[] = [];
  for (const item of value) {
    const identifier = readIdentifier(item);
    if (!identifier) return null;
    identifiers.push(identifier);
  }
  return identifiers;
}

function readReference(value: unknown): FhirReference | null {
  const object = readJsonObject(value);
  if (!object) return null;

  const reference = readNonEmptyString(object.reference) ?? undefined;
  const display = readNonEmptyString(object.display) ?? undefined;
  const identifier =
    object.identifier === undefined ? undefined : readIdentifier(object.identifier);
  if (object.identifier !== undefined && !identifier) return null;
  if (!reference && !identifier) return null;

  return display
    ? { reference, identifier: identifier ?? undefined, display }
    : { reference, identifier: identifier ?? undefined };
}

function readReferenceArray(value: unknown): FhirReference[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;

  const references: FhirReference[] = [];
  for (const item of value) {
    const reference = readReference(item);
    if (!reference) return null;
    references.push(reference);
  }
  return references;
}

function readMeta(value: unknown): FhirMeta | null {
  if (value === undefined) return null;
  const object = readJsonObject(value);
  if (!object) return null;

  const profile = object.profile === undefined ? [] : readStringArray(object.profile);
  if (!profile) return null;

  const versionId = readNonEmptyString(object.versionId) ?? undefined;
  const lastUpdated =
    object.lastUpdated === undefined ? undefined : readFhirDateTime(object.lastUpdated);
  if (object.lastUpdated !== undefined && !lastUpdated) return null;

  return {
    profile,
    ...(versionId ? { versionId } : {}),
    ...(lastUpdated ? { lastUpdated } : {}),
  };
}

function readQuantity(value: unknown): FhirQuantity | null {
  const object = readJsonObject(value);
  if (!object) return null;

  const unit = readNonEmptyString(object.unit);
  if (typeof object.value !== 'number' || !Number.isFinite(object.value) || !unit) {
    return null;
  }

  const system = readNonEmptyString(object.system) ?? undefined;
  const code = readNonEmptyString(object.code) ?? undefined;
  return { value: object.value, unit, ...(system ? { system } : {}), ...(code ? { code } : {}) };
}

function readDoseAndRate(value: unknown): FhirDosageInstruction['doseAndRate'][number] | null {
  const object = readJsonObject(value);
  const doseQuantity = readQuantity(object?.doseQuantity);
  if (!doseQuantity) return null;

  return { doseQuantity };
}

function readDosageInstruction(value: unknown): FhirDosageInstruction | null {
  const object = readJsonObject(value);
  if (!object) return null;

  const text = readNonEmptyString(object.text) ?? undefined;
  const timing = readJsonObject(object.timing);
  const code = readJsonObject(timing?.code);
  const timingText = readNonEmptyString(code?.text) ?? undefined;
  if (!text && !timingText && !Array.isArray(object.doseAndRate)) return null;

  const doseAndRate: FhirDosageInstruction['doseAndRate'] = [];
  if (object.doseAndRate !== undefined) {
    if (!Array.isArray(object.doseAndRate)) return null;
    for (const item of object.doseAndRate) {
      const dose = readDoseAndRate(item);
      if (!dose) return null;
      doseAndRate.push(dose);
    }
  }

  return {
    ...(text ? { text } : {}),
    ...(timingText ? { timing: { code: { text: timingText } } } : {}),
    doseAndRate,
  };
}

function readDosageInstructionArray(value: unknown): FhirDosageInstruction[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;

  const dosage: FhirDosageInstruction[] = [];
  for (const item of value) {
    const instruction = readDosageInstruction(item);
    if (!instruction) return null;
    dosage.push(instruction);
  }
  return dosage;
}

export function normalizeFhirPatient(value: unknown): FhirPatient | null {
  const object = readJsonObject(value);
  if (!object) return null;

  if (object.resourceType !== 'Patient') return null;
  const id = readNonEmptyString(object.id);
  const birthDate = readFhirDate(object.birthDate);
  const gender = readNonEmptyString(object.gender);
  const meta = readMeta(object.meta);
  const identifier = readIdentifierArray(object.identifier);
  if (
    !id ||
    !birthDate ||
    !gender ||
    !Array.isArray(object.name) ||
    (object.meta !== undefined && !meta) ||
    !identifier
  ) {
    return null;
  }

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
    ...(meta ? { meta } : {}),
    ...(identifier.length > 0 ? { identifier } : {}),
    name,
    birthDate,
    gender,
  };
}

export function normalizeFhirMedicationRequest(value: unknown): FhirMedicationRequest | null {
  const object = readJsonObject(value);
  if (!object) return null;

  if (object.resourceType !== 'MedicationRequest') return null;
  const id = readNonEmptyString(object.id);
  const meta = readMeta(object.meta);
  const identifier = readIdentifierArray(object.identifier);
  const status = readNonEmptyString(object.status);
  const intent = readNonEmptyString(object.intent);
  const medicationCodeableConcept = readCodeableConcept(object.medicationCodeableConcept);
  const subject = readReference(object.subject);
  const authoredOn =
    object.authoredOn === undefined ? undefined : readFhirDateTime(object.authoredOn);
  const dosageInstruction = readDosageInstructionArray(object.dosageInstruction);
  const dispenseRequestObject = readJsonObject(object.dispenseRequest);
  const dispenseRequest = dispenseRequestObject
    ? {
        ...(dispenseRequestObject.quantity !== undefined
          ? { quantity: readQuantity(dispenseRequestObject.quantity) }
          : {}),
        ...(dispenseRequestObject.expectedSupplyDuration !== undefined
          ? { expectedSupplyDuration: readQuantity(dispenseRequestObject.expectedSupplyDuration) }
          : {}),
      }
    : undefined;

  if (
    !id ||
    (object.meta !== undefined && !meta) ||
    !identifier ||
    !status ||
    !intent ||
    !medicationCodeableConcept ||
    !subject ||
    (object.authoredOn !== undefined && !authoredOn) ||
    !dosageInstruction ||
    dispenseRequest?.quantity === null ||
    dispenseRequest?.expectedSupplyDuration === null
  ) {
    return null;
  }

  return {
    resourceType: 'MedicationRequest',
    id,
    ...(meta ? { meta } : {}),
    ...(identifier.length > 0 ? { identifier } : {}),
    status,
    intent,
    medicationCodeableConcept,
    subject,
    ...(authoredOn ? { authoredOn } : {}),
    dosageInstruction,
    ...(dispenseRequest
      ? { dispenseRequest: dispenseRequest as FhirMedicationRequest['dispenseRequest'] }
      : {}),
  };
}

export function normalizeFhirMedicationDispense(value: unknown): FhirMedicationDispense | null {
  const object = readJsonObject(value);
  if (!object) return null;

  if (object.resourceType !== 'MedicationDispense') return null;
  const id = readNonEmptyString(object.id);
  const meta = readMeta(object.meta);
  const identifier = readIdentifierArray(object.identifier);
  const status = readNonEmptyString(object.status);
  const medicationCodeableConcept = readCodeableConcept(object.medicationCodeableConcept);
  const subject = readReference(object.subject);
  const authorizingPrescription = readReferenceArray(object.authorizingPrescription);
  const quantity = object.quantity === undefined ? undefined : readQuantity(object.quantity);
  const daysSupply = object.daysSupply === undefined ? undefined : readQuantity(object.daysSupply);
  const whenPrepared =
    object.whenPrepared === undefined ? undefined : readFhirDateTime(object.whenPrepared);
  const whenHandedOver =
    object.whenHandedOver === undefined ? undefined : readFhirDateTime(object.whenHandedOver);
  const dosageInstruction = readDosageInstructionArray(object.dosageInstruction);

  if (
    !id ||
    (object.meta !== undefined && !meta) ||
    !identifier ||
    !status ||
    !medicationCodeableConcept ||
    !subject ||
    !authorizingPrescription ||
    (object.quantity !== undefined && !quantity) ||
    (object.daysSupply !== undefined && !daysSupply) ||
    (object.whenPrepared !== undefined && !whenPrepared) ||
    (object.whenHandedOver !== undefined && !whenHandedOver) ||
    !dosageInstruction
  ) {
    return null;
  }

  return {
    resourceType: 'MedicationDispense',
    id,
    ...(meta ? { meta } : {}),
    ...(identifier.length > 0 ? { identifier } : {}),
    status,
    medicationCodeableConcept,
    subject,
    authorizingPrescription,
    ...(quantity ? { quantity } : {}),
    ...(daysSupply ? { daysSupply } : {}),
    ...(whenPrepared ? { whenPrepared } : {}),
    ...(whenHandedOver ? { whenHandedOver } : {}),
    dosageInstruction,
  };
}

export function normalizeFhirMedicationStatement(value: unknown): FhirMedicationStatement | null {
  const object = readJsonObject(value);
  if (!object) return null;

  if (object.resourceType !== 'MedicationStatement') return null;
  const id = readNonEmptyString(object.id);
  const meta = readMeta(object.meta);
  const identifier = readIdentifierArray(object.identifier);
  const status = readNonEmptyString(object.status);
  const medicationCodeableConcept = readCodeableConcept(object.medicationCodeableConcept);
  const subject = readReference(object.subject);
  const basedOn = readReferenceArray(object.basedOn);
  const partOf = readReferenceArray(object.partOf);
  const effectiveDateTime =
    object.effectiveDateTime === undefined ? undefined : readFhirDateTime(object.effectiveDateTime);
  const dateAsserted =
    object.dateAsserted === undefined ? undefined : readFhirDateTime(object.dateAsserted);
  const informationSource =
    object.informationSource === undefined ? undefined : readReference(object.informationSource);
  const derivedFrom = readReferenceArray(object.derivedFrom);
  const dosage = readDosageInstructionArray(object.dosage);

  if (
    !id ||
    (object.meta !== undefined && !meta) ||
    !identifier ||
    !status ||
    !medicationCodeableConcept ||
    !subject ||
    !basedOn ||
    !partOf ||
    (object.effectiveDateTime !== undefined && !effectiveDateTime) ||
    (object.dateAsserted !== undefined && !dateAsserted) ||
    (object.informationSource !== undefined && !informationSource) ||
    !derivedFrom ||
    !dosage
  ) {
    return null;
  }

  return {
    resourceType: 'MedicationStatement',
    id,
    ...(meta ? { meta } : {}),
    ...(identifier.length > 0 ? { identifier } : {}),
    status,
    medicationCodeableConcept,
    subject,
    basedOn,
    partOf,
    ...(effectiveDateTime ? { effectiveDateTime } : {}),
    ...(dateAsserted ? { dateAsserted } : {}),
    ...(informationSource ? { informationSource } : {}),
    derivedFrom,
    dosage,
  };
}

function unwrapResponseData(payload: unknown): unknown {
  const envelope = readJsonObject(payload);
  return envelope && 'data' in envelope ? envelope.data : payload;
}

function readFhirSearchResources(payload: unknown): unknown[] | null {
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
    const { status, data } = await fetchJson(
      `${this.baseUrl.replace(/\/$/, '')}/Patient/${encodeURIComponent(id)}`,
      {
        headers: buildBearerHeaders(this.options?.accessToken, this.options?.apiKey),
        maxResponseBytes: FHIR_RESOURCE_RESPONSE_MAX_BYTES,
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
    return this.getMedicationSearchResources(
      'MedicationRequest',
      patientId,
      normalizeFhirMedicationRequest,
      'FHIR MedicationRequest 検索に失敗しました',
      'FHIR MedicationRequest レスポンス形式が不正です',
    );
  }

  async getMedicationDispenses(patientId: string): Promise<FhirMedicationDispense[]> {
    return this.getMedicationSearchResources(
      'MedicationDispense',
      patientId,
      normalizeFhirMedicationDispense,
      'FHIR MedicationDispense 検索に失敗しました',
      'FHIR MedicationDispense レスポンス形式が不正です',
    );
  }

  async getMedicationStatements(patientId: string): Promise<FhirMedicationStatement[]> {
    return this.getMedicationSearchResources(
      'MedicationStatement',
      patientId,
      normalizeFhirMedicationStatement,
      'FHIR MedicationStatement 検索に失敗しました',
      'FHIR MedicationStatement レスポンス形式が不正です',
    );
  }

  async createMedicationDispense(data: Record<string, unknown>): Promise<void> {
    const result = await fetchJson(`${this.baseUrl.replace(/\/$/, '')}/MedicationDispense`, {
      method: 'POST',
      headers: buildBearerHeaders(this.options?.accessToken, this.options?.apiKey),
      body: data,
      maxResponseBytes: FHIR_RESOURCE_RESPONSE_MAX_BYTES,
    });
    if (result.status >= 400) {
      throw new HttpAdapterError(
        'FHIR MedicationDispense 登録に失敗しました',
        result.status,
        result.data,
      );
    }
  }

  private async getMedicationSearchResources<T>(
    resourceType: 'MedicationRequest' | 'MedicationDispense' | 'MedicationStatement',
    patientId: string,
    normalize: (resource: unknown) => T | null,
    failureMessage: string,
    malformedMessage: string,
  ): Promise<T[]> {
    const { status, data } = await fetchJson(
      `${this.baseUrl.replace(/\/$/, '')}/${resourceType}?patient=${encodeURIComponent(patientId)}`,
      {
        headers: buildBearerHeaders(this.options?.accessToken, this.options?.apiKey),
        maxResponseBytes: FHIR_SEARCH_RESPONSE_MAX_BYTES,
      },
    );
    if (status >= 400) {
      throw new HttpAdapterError(failureMessage, status, data);
    }
    const resources = readFhirSearchResources(data);
    if (!resources) {
      throw new HttpAdapterError(malformedMessage, status, data);
    }

    const normalized: T[] = [];
    for (const resource of resources) {
      const item = normalize(resource);
      if (!item) {
        throw new HttpAdapterError(malformedMessage, status, data);
      }
      normalized.push(item);
    }

    return normalized;
  }
}
