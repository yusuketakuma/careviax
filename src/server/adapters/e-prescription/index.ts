import { buildBearerHeaders, fetchJson, unwrapDataEnvelope } from '../http-client';
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
  accessToken?: string;
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

class MhlwEPrescriptionAdapter implements EPrescriptionAdapterContract {
  constructor(private readonly config: EPrescriptionAdapterConfig) {
    if (!config.baseUrl) {
      throw new EPrescriptionAdapterError(
        '電子処方箋 API の baseUrl が設定されていません',
        'INVALID_CONFIGURATION',
        false
      );
    }
  }

  getCapabilities(): EPrescriptionAdapterCapabilities {
    return {
      supportsSearch: true,
      supportsDispenseConfirmation: true,
      supportsPartialDispense: true,
      supportsCancelDispense: false,
    };
  }

  private get headers() {
    return buildBearerHeaders(this.config.accessToken, this.config.apiKey);
  }

  private normalizeRecord(payload: EPrescriptionRecord | { data?: EPrescriptionRecord } | null) {
    return unwrapDataEnvelope<EPrescriptionRecord>(payload);
  }

  async fetchPrescription(prescriptionId: string): Promise<EPrescriptionRecord | null> {
    const { status, data } = await fetchJson<EPrescriptionRecord | { data?: EPrescriptionRecord }>(
      `${this.config.baseUrl!.replace(/\/$/, '')}/prescriptions/${encodeURIComponent(prescriptionId)}`,
      {
        headers: this.headers,
      }
    );
    if (status === 404) return null;
    if (status === 401 || status === 403) {
      throw new EPrescriptionAdapterError('電子処方箋 API の認証に失敗しました', 'UNAUTHORIZED', false, status, data);
    }
    if (status >= 400) {
      throw new EPrescriptionAdapterError('電子処方箋取得に失敗しました', 'UPSTREAM_FAILURE', status >= 500, status, data);
    }
    return this.normalizeRecord(data);
  }

  async searchPrescriptions(params: EPrescriptionSearchParams): Promise<EPrescriptionRecord[]> {
    const url = new URL(`${this.config.baseUrl!.replace(/\/$/, '')}/prescriptions`);
    if (params.patientExternalId) url.searchParams.set('patientExternalId', params.patientExternalId);
    if (params.issuedAfter) url.searchParams.set('issuedAfter', params.issuedAfter);
    if (params.issuedBefore) url.searchParams.set('issuedBefore', params.issuedBefore);
    if (params.includeDispensed !== undefined) {
      url.searchParams.set('includeDispensed', params.includeDispensed ? 'true' : 'false');
    }

    const { status, data } = await fetchJson<
      EPrescriptionRecord[] | { data?: EPrescriptionRecord[] }
    >(url.toString(), {
      headers: this.headers,
    });
    if (status === 401 || status === 403) {
      throw new EPrescriptionAdapterError('電子処方箋 API の認証に失敗しました', 'UNAUTHORIZED', false, status, data);
    }
    if (status >= 400) {
      throw new EPrescriptionAdapterError('電子処方箋検索に失敗しました', 'UPSTREAM_FAILURE', status >= 500, status, data);
    }
    return unwrapDataEnvelope<EPrescriptionRecord[]>(data) ?? [];
  }

  async confirmDispense(payload: EPrescriptionDispenseConfirmation): Promise<void> {
    const { status, data } = await fetchJson<Record<string, unknown>>(
      `${this.config.baseUrl!.replace(/\/$/, '')}/dispenses/confirm`,
      {
        method: 'POST',
        headers: this.headers,
        body: payload,
      }
    );
    if (status === 401 || status === 403) {
      throw new EPrescriptionAdapterError('電子処方箋 API の認証に失敗しました', 'UNAUTHORIZED', false, status, data);
    }
    if (status >= 400) {
      throw new EPrescriptionAdapterError(
        '電子処方箋への調剤結果送信に失敗しました',
        'UPSTREAM_FAILURE',
        status >= 500,
        status,
        data
      );
    }
  }
}

export function createEPrescriptionAdapter(
  config: EPrescriptionAdapterConfig = { provider: 'stub' }
): EPrescriptionAdapterContract {
  switch (config.provider) {
    case 'stub':
      return new StubEPrescriptionAdapter(config);
    case 'mhlw':
      return new MhlwEPrescriptionAdapter(config);
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
