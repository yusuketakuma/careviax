import { buildBearerHeaders, fetchJson, unwrapDataEnvelope } from '../http-client';
import { readJsonObject } from '@/lib/db/json';
/**
 * オンライン資格確認アダプタ IF
 *
 * Phase 1 では保険確認フローが依存する contract のみを定義し、
 * 実際の資格確認サービス接続は Phase 3 で実装する。
 */

export type QualificationCheckRequest = {
  patientExternalId?: string;
  insuranceNumber?: string;
  insurerNumber?: string;
  insuredPersonSymbol?: string;
  insuredPersonNumber?: string;
  asOfDate: string;
};

export type QualificationCoverageWindow = {
  startDate: string | null;
  endDate: string | null;
};

export type QualificationCheckResult = {
  valid: boolean;
  patientName: string | null;
  payerName: string | null;
  payerType: 'medical' | 'care' | 'public' | 'unknown';
  copayRatio: number | null;
  coverage: QualificationCoverageWindow;
  warnings: string[];
  raw?: Record<string, unknown>;
};

export type QualificationCheckCapabilities = {
  supportsOnlineLookup: boolean;
  supportsBenefitHistory: boolean;
  supportsCareInsurance: boolean;
};

export class QualificationCheckAdapterError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'NOT_IMPLEMENTED'
      | 'INVALID_REQUEST'
      | 'INVALID_CONFIGURATION'
      | 'UNAUTHORIZED'
      | 'UPSTREAM_FAILURE',
    readonly retriable: boolean,
    readonly status?: number,
    readonly causeDetail?: unknown,
  ) {
    super(message);
    this.name = 'QualificationCheckAdapterError';
  }
}

function readNullableString(value: unknown) {
  return value === null || typeof value === 'string' ? value : null;
}

function readPayerType(value: unknown): QualificationCheckResult['payerType'] | null {
  return value === 'medical' || value === 'care' || value === 'public' || value === 'unknown'
    ? value
    : null;
}

function readNullableFiniteNumber(value: unknown) {
  return value === null || (typeof value === 'number' && Number.isFinite(value)) ? value : null;
}

function readStringArray(value: unknown) {
  if (!Array.isArray(value)) return null;
  return value.every((item): item is string => typeof item === 'string') ? value : null;
}

function readCoverageWindow(value: unknown): QualificationCoverageWindow | null {
  const object = readJsonObject(value);
  if (!object) return null;

  const startDate = readNullableString(object.startDate);
  const endDate = readNullableString(object.endDate);
  if (startDate === null && object.startDate !== null) return null;
  if (endDate === null && object.endDate !== null) return null;

  return { startDate, endDate };
}

export function normalizeQualificationCheckResult(value: unknown): QualificationCheckResult | null {
  const object = readJsonObject(value);
  if (!object) return null;

  const payerType = readPayerType(object.payerType);
  const patientName = readNullableString(object.patientName);
  const payerName = readNullableString(object.payerName);
  const copayRatio = readNullableFiniteNumber(object.copayRatio);
  const coverage = readCoverageWindow(object.coverage);
  const warnings = readStringArray(object.warnings);
  const raw = object.raw === undefined ? undefined : readJsonObject(object.raw);

  if (
    typeof object.valid !== 'boolean' ||
    !payerType ||
    (patientName === null && object.patientName !== null) ||
    (payerName === null && object.payerName !== null) ||
    (copayRatio === null && object.copayRatio !== null) ||
    !coverage ||
    !warnings ||
    (object.raw !== undefined && !raw)
  ) {
    return null;
  }

  return {
    valid: object.valid,
    patientName,
    payerName,
    payerType,
    copayRatio,
    coverage,
    warnings,
    ...(raw ? { raw } : {}),
  };
}

export interface QualificationCheckAdapterContract {
  getCapabilities(): QualificationCheckCapabilities;
  checkInsurance(request: QualificationCheckRequest): Promise<QualificationCheckResult | null>;
}

export type QualificationCheckAdapterConfig = {
  provider: 'stub' | 'mhlw';
  baseUrl?: string;
  clientId?: string;
  clientSecret?: string;
  accessToken?: string;
};

export class StubQualificationCheckAdapter implements QualificationCheckAdapterContract {
  constructor(private readonly config: QualificationCheckAdapterConfig = { provider: 'stub' }) {}

  getCapabilities(): QualificationCheckCapabilities {
    return {
      supportsOnlineLookup: false,
      supportsBenefitHistory: false,
      supportsCareInsurance: false,
    };
  }

  async checkInsurance(
    request: QualificationCheckRequest,
  ): Promise<QualificationCheckResult | null> {
    void request;
    throw new QualificationCheckAdapterError(
      'オンライン資格確認連携はまだ有効化されていません',
      'NOT_IMPLEMENTED',
      false,
      undefined,
      { provider: this.config.provider },
    );
  }
}

class MhlwQualificationCheckAdapter implements QualificationCheckAdapterContract {
  constructor(private readonly config: QualificationCheckAdapterConfig) {
    if (!config.baseUrl) {
      throw new QualificationCheckAdapterError(
        '資格確認 API の baseUrl が設定されていません',
        'INVALID_CONFIGURATION',
        false,
      );
    }
  }

  getCapabilities(): QualificationCheckCapabilities {
    return {
      supportsOnlineLookup: true,
      supportsBenefitHistory: true,
      supportsCareInsurance: true,
    };
  }

  async checkInsurance(
    request: QualificationCheckRequest,
  ): Promise<QualificationCheckResult | null> {
    const { status, data } = await fetchJson<
      QualificationCheckResult | { data?: QualificationCheckResult }
    >(`${this.config.baseUrl!.replace(/\/$/, '')}/insurance/check`, {
      method: 'POST',
      headers: {
        ...buildBearerHeaders(this.config.accessToken),
        ...(this.config.clientId ? { 'x-client-id': this.config.clientId } : {}),
        ...(this.config.clientSecret ? { 'x-client-secret': this.config.clientSecret } : {}),
      },
      body: request,
    });

    if (status === 400) {
      throw new QualificationCheckAdapterError(
        '資格確認リクエストが不正です',
        'INVALID_REQUEST',
        false,
        status,
        data,
      );
    }
    if (status === 401 || status === 403) {
      throw new QualificationCheckAdapterError(
        '資格確認 API の認証に失敗しました',
        'UNAUTHORIZED',
        false,
        status,
        data,
      );
    }
    if (status === 404) {
      return null;
    }
    if (status >= 400) {
      throw new QualificationCheckAdapterError(
        '資格確認 API 呼び出しに失敗しました',
        'UPSTREAM_FAILURE',
        status >= 500,
        status,
        data,
      );
    }

    const result = normalizeQualificationCheckResult(unwrapDataEnvelope<unknown>(data));
    if (!result) {
      throw new QualificationCheckAdapterError(
        '資格確認 API のレスポンス形式が不正です',
        'UPSTREAM_FAILURE',
        false,
        status,
        data,
      );
    }

    return result;
  }
}

export function createQualificationCheckAdapter(
  config: QualificationCheckAdapterConfig = { provider: 'stub' },
): QualificationCheckAdapterContract {
  switch (config.provider) {
    case 'stub':
      return new StubQualificationCheckAdapter(config);
    case 'mhlw':
      return new MhlwQualificationCheckAdapter(config);
    default: {
      const exhaustiveCheck: never = config.provider;
      throw new QualificationCheckAdapterError(
        `未対応の資格確認 provider です: ${exhaustiveCheck}`,
        'INVALID_CONFIGURATION',
        false,
      );
    }
  }
}
