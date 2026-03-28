/**
 * 電子処方箋管理サービスアダプタ IF
 *
 * Phase 1 では業務コードが依存できる contract だけを定義し、
 * 実接続は Phase 3 で差し替える。
 */

export type EPrescriptionMedicationItem = {
  lineNumber: number;
  drugCode: string | null;
  drugName: string;
  dose: string;
  frequency: string;
  days: number;
  quantity: number | null;
  unit: string | null;
  notes?: string | null;
};

export type EPrescriptionRecord = {
  prescriptionId: string;
  issuedAt: string;
  expiresAt: string | null;
  patientExternalId: string;
  patientName: string | null;
  prescriberName: string | null;
  prescriberInstitution: string | null;
  status: 'issued' | 'partially_dispensed' | 'dispensed' | 'cancelled' | 'unknown';
  refillRemainingCount?: number | null;
  nextDispenseDate?: string | null;
  items: EPrescriptionMedicationItem[];
  raw?: Record<string, unknown>;
};

export type EPrescriptionSearchParams = {
  patientExternalId?: string;
  issuedAfter?: string;
  issuedBefore?: string;
  includeDispensed?: boolean;
};

export type EPrescriptionDispenseConfirmation = {
  prescriptionId: string;
  confirmedAt: string;
  dispensingPharmacistId: string;
  dispensingOrgId: string;
  items: Array<{
    lineNumber: number;
    dispensedDrugCode?: string | null;
    dispensedDrugName: string;
    quantity: number;
    unit?: string | null;
  }>;
};

export type EPrescriptionAdapterCapabilities = {
  supportsSearch: boolean;
  supportsDispenseConfirmation: boolean;
  supportsPartialDispense: boolean;
  supportsCancelDispense: boolean;
};

export class EPrescriptionAdapterError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'NOT_IMPLEMENTED'
      | 'INVALID_CONFIGURATION'
      | 'UNAUTHORIZED'
      | 'UPSTREAM_FAILURE',
    readonly retriable: boolean,
    readonly status?: number,
    readonly causeDetail?: unknown
  ) {
    super(message);
    this.name = 'EPrescriptionAdapterError';
  }
}

export interface EPrescriptionAdapterContract {
  getCapabilities(): EPrescriptionAdapterCapabilities;
  fetchPrescription(prescriptionId: string): Promise<EPrescriptionRecord | null>;
  searchPrescriptions(params: EPrescriptionSearchParams): Promise<EPrescriptionRecord[]>;
  confirmDispense(payload: EPrescriptionDispenseConfirmation): Promise<void>;
}

export type EPrescriptionAdapterConfig = {
  provider: 'stub' | 'mhlw';
  baseUrl?: string;
  apiKey?: string;
};

export class StubEPrescriptionAdapter implements EPrescriptionAdapterContract {
  constructor(private readonly config: EPrescriptionAdapterConfig = { provider: 'stub' }) {}

  getCapabilities(): EPrescriptionAdapterCapabilities {
    return {
      supportsSearch: false,
      supportsDispenseConfirmation: false,
      supportsPartialDispense: false,
      supportsCancelDispense: false,
    };
  }

  async fetchPrescription(prescriptionId: string): Promise<EPrescriptionRecord | null> {
    void prescriptionId;
    throw new EPrescriptionAdapterError(
      '電子処方箋連携はまだ有効化されていません',
      'NOT_IMPLEMENTED',
      false,
      undefined,
      { provider: this.config.provider }
    );
  }

  async searchPrescriptions(params: EPrescriptionSearchParams): Promise<EPrescriptionRecord[]> {
    void params;
    throw new EPrescriptionAdapterError(
      '電子処方箋検索はまだ有効化されていません',
      'NOT_IMPLEMENTED',
      false,
      undefined,
      { provider: this.config.provider }
    );
  }

  async confirmDispense(payload: EPrescriptionDispenseConfirmation): Promise<void> {
    void payload;
    throw new EPrescriptionAdapterError(
      '電子処方箋への調剤結果送信はまだ有効化されていません',
      'NOT_IMPLEMENTED',
      false,
      undefined,
      { provider: this.config.provider }
    );
  }
}

export function createEPrescriptionAdapter(
  config: EPrescriptionAdapterConfig = { provider: 'stub' }
): EPrescriptionAdapterContract {
  switch (config.provider) {
    case 'stub':
    case 'mhlw':
      return new StubEPrescriptionAdapter(config);
    default: {
      const exhaustiveCheck: never = config.provider;
      throw new EPrescriptionAdapterError(
        `未対応の電子処方箋 provider です: ${exhaustiveCheck}`,
        'INVALID_CONFIGURATION',
        false
      );
    }
  }
}
