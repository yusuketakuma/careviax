import { buildBearerHeaders, fetchJson } from '../http-client';
import { readJsonObject } from '@/lib/db/json';

/**
 * レセコン連携アダプタ（請求データエクスポート）
 *
 * 現フェーズでは CSV → CLAIMS-XML 変換のスタブ実装を提供する。
 * 実レセコン接続は将来フェーズで差し替え。
 */

export type ClaimsExportRecord = {
  patientId: string;
  patientName: string;
  billingMonth: string; // YYYY-MM
  insuranceType: 'medical' | 'care' | 'self';
  billingCode: string;
  billingName: string;
  points: number;
  status: string;
};

export type ClaimsExportPayload = {
  orgId: string;
  siteId: string;
  billingMonth: string;
  records: ClaimsExportRecord[];
};

export type ClaimsExportResult = {
  format: 'claims-xml' | 'csv';
  content: string;
  recordCount: number;
  generatedAt: string;
};

export type ClaimsExportCapabilities = {
  supportsXmlExport: boolean;
  supportsCsvExport: boolean;
  supportsDirectTransmission: boolean;
};

export class ClaimsExportAdapterError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'NOT_IMPLEMENTED'
      | 'INVALID_CONFIGURATION'
      | 'INVALID_PAYLOAD'
      | 'UPSTREAM_FAILURE',
    readonly retriable: boolean,
    readonly status?: number,
    readonly causeDetail?: unknown,
  ) {
    super(message);
    this.name = 'ClaimsExportAdapterError';
  }
}

export interface ClaimsExportAdapterContract {
  getCapabilities(): ClaimsExportCapabilities;
  exportClaims(payload: ClaimsExportPayload): Promise<ClaimsExportResult>;
}

export type ClaimsExportAdapterConfig = {
  provider: 'stub' | 'rececom';
  baseUrl?: string;
  apiKey?: string;
  accessToken?: string;
};

/**
 * Escape a string for safe interpolation into an XML attribute value.
 * Replaces the five predefined XML entities.
 */
function escapeXmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function readClaimsExportFormat(value: unknown): ClaimsExportResult['format'] | null {
  return value === 'claims-xml' || value === 'csv' ? value : null;
}

export function normalizeClaimsExportResult(value: unknown): ClaimsExportResult | null {
  const object = readJsonObject(value);
  if (!object) return null;

  const format = readClaimsExportFormat(object.format);
  if (
    !format ||
    typeof object.content !== 'string' ||
    typeof object.recordCount !== 'number' ||
    !Number.isInteger(object.recordCount) ||
    object.recordCount < 0 ||
    typeof object.generatedAt !== 'string' ||
    !Number.isFinite(new Date(object.generatedAt).getTime())
  ) {
    return null;
  }

  return {
    format,
    content: object.content,
    recordCount: object.recordCount,
    generatedAt: object.generatedAt,
  };
}

class StubClaimsExportAdapter implements ClaimsExportAdapterContract {
  getCapabilities(): ClaimsExportCapabilities {
    return {
      supportsXmlExport: false,
      supportsCsvExport: true,
      supportsDirectTransmission: false,
    };
  }

  async exportClaims(payload: ClaimsExportPayload): Promise<ClaimsExportResult> {
    // Stub: generate minimal CLAIMS-XML structure
    const lines = payload.records
      .map(
        (record) =>
          `  <Claim patientId="${escapeXmlAttr(record.patientId)}" billingCode="${escapeXmlAttr(record.billingCode)}" points="${escapeXmlAttr(String(record.points))}" month="${escapeXmlAttr(record.billingMonth)}" insuranceType="${escapeXmlAttr(record.insuranceType)}"/>`,
      )
      .join('\n');

    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      `<ClaimsExport orgId="${escapeXmlAttr(payload.orgId)}" siteId="${escapeXmlAttr(payload.siteId)}" billingMonth="${escapeXmlAttr(payload.billingMonth)}" generatedAt="${escapeXmlAttr(new Date().toISOString())}">`,
      lines,
      '</ClaimsExport>',
    ].join('\n');

    return {
      format: 'claims-xml',
      content: xml,
      recordCount: payload.records.length,
      generatedAt: new Date().toISOString(),
    };
  }
}

class RececomClaimsExportAdapter implements ClaimsExportAdapterContract {
  constructor(private readonly config: ClaimsExportAdapterConfig) {
    if (!config.baseUrl) {
      throw new ClaimsExportAdapterError(
        'レセコン API の baseUrl が設定されていません',
        'INVALID_CONFIGURATION',
        false,
      );
    }
  }

  getCapabilities(): ClaimsExportCapabilities {
    return {
      supportsXmlExport: true,
      supportsCsvExport: true,
      supportsDirectTransmission: true,
    };
  }

  async exportClaims(payload: ClaimsExportPayload): Promise<ClaimsExportResult> {
    const { status, data } = await fetchJson(
      `${this.config.baseUrl!.replace(/\/$/, '')}/claims/export`,
      {
        method: 'POST',
        headers: buildBearerHeaders(this.config.accessToken, this.config.apiKey),
        body: payload,
      },
    );

    if (status === 400) {
      throw new ClaimsExportAdapterError(
        'レセコンエクスポートリクエストが不正です',
        'INVALID_PAYLOAD',
        false,
        status,
        data,
      );
    }
    if (status >= 400) {
      throw new ClaimsExportAdapterError(
        'レセコン API 呼び出しに失敗しました',
        'UPSTREAM_FAILURE',
        status >= 500,
        status,
        data,
      );
    }

    const result = normalizeClaimsExportResult(data);
    if (!result) {
      throw new ClaimsExportAdapterError(
        'レセコン API のレスポンス形式が不正です',
        'UPSTREAM_FAILURE',
        false,
        status,
        data,
      );
    }

    return result;
  }
}

export function createClaimsExportAdapter(
  config: ClaimsExportAdapterConfig = { provider: 'stub' },
): ClaimsExportAdapterContract {
  switch (config.provider) {
    case 'stub':
      return new StubClaimsExportAdapter();
    case 'rececom':
      return new RececomClaimsExportAdapter(config);
    default: {
      const exhaustiveCheck: never = config.provider;
      throw new ClaimsExportAdapterError(
        `未対応のレセコン provider です: ${exhaustiveCheck}`,
        'INVALID_CONFIGURATION',
        false,
      );
    }
  }
}
