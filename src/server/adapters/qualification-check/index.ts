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
    readonly causeDetail?: unknown
  ) {
    super(message);
    this.name = 'QualificationCheckAdapterError';
  }
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
};

export class StubQualificationCheckAdapter implements QualificationCheckAdapterContract {
  constructor(
    private readonly config: QualificationCheckAdapterConfig = { provider: 'stub' }
  ) {}

  getCapabilities(): QualificationCheckCapabilities {
    return {
      supportsOnlineLookup: false,
      supportsBenefitHistory: false,
      supportsCareInsurance: false,
    };
  }

  async checkInsurance(
    request: QualificationCheckRequest
  ): Promise<QualificationCheckResult | null> {
    void request;
    throw new QualificationCheckAdapterError(
      'オンライン資格確認連携はまだ有効化されていません',
      'NOT_IMPLEMENTED',
      false,
      undefined,
      { provider: this.config.provider }
    );
  }
}

export function createQualificationCheckAdapter(
  config: QualificationCheckAdapterConfig = { provider: 'stub' }
): QualificationCheckAdapterContract {
  switch (config.provider) {
    case 'stub':
    case 'mhlw':
      return new StubQualificationCheckAdapter(config);
    default: {
      const exhaustiveCheck: never = config.provider;
      throw new QualificationCheckAdapterError(
        `未対応の資格確認 provider です: ${exhaustiveCheck}`,
        'INVALID_CONFIGURATION',
        false
      );
    }
  }
}
