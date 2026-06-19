import {
  BILLING_VALIDATION_LAYER_KEYS,
  type BillingValidationLayer,
  type BillingValidationLayerKey,
  type BillingValidationLayers,
  type BillingValidationLayerSnapshot,
  type BillingValidationLayerState,
} from '@/types/billing-validation-layers';

export { BILLING_VALIDATION_LAYER_KEYS };
export type {
  BillingValidationLayer,
  BillingValidationLayerKey,
  BillingValidationLayers,
  BillingValidationLayerSnapshot,
  BillingValidationLayerState,
};

export type BillingValidationSummary = {
  state: BillingValidationLayerState | 'unknown';
  layerKey: BillingValidationLayerKey | null;
  rawMessage: string | null;
};

function readObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readLayer(value: unknown): Partial<BillingValidationLayer> | null {
  const source = readObject(value);
  if (!source) return null;
  const state =
    source.state === 'passed' || source.state === 'manual_review' || source.state === 'blocked'
      ? source.state
      : undefined;
  const label = typeof source.label === 'string' ? source.label : undefined;
  const message = typeof source.message === 'string' ? source.message : undefined;
  const version = typeof source.version === 'string' ? source.version : undefined;
  return { label, state, message, version };
}

export function readBillingValidationLayers(
  sourceSnapshot: unknown,
): BillingValidationLayerSnapshot | null {
  const source = readObject(sourceSnapshot);
  const validationLayers = readObject(source?.validation_layers);
  if (!validationLayers) return null;
  return Object.fromEntries(
    BILLING_VALIDATION_LAYER_KEYS.map((key) => [key, readLayer(validationLayers[key])]),
  ) as BillingValidationLayerSnapshot;
}

export function summarizeBillingValidationLayers(
  layers: BillingValidationLayerSnapshot | null | undefined,
): BillingValidationSummary {
  if (!layers) {
    return { state: 'unknown', layerKey: null, rawMessage: null };
  }

  for (const state of ['blocked', 'manual_review'] as const) {
    for (const key of BILLING_VALIDATION_LAYER_KEYS) {
      const layer = layers[key];
      if (layer?.state !== state) continue;
      return {
        state,
        layerKey: key,
        rawMessage: typeof layer.message === 'string' ? layer.message.trim() || null : null,
      };
    }
  }

  const hasPassedLayer = BILLING_VALIDATION_LAYER_KEYS.some(
    (key) => layers[key]?.state === 'passed',
  );
  return { state: hasPassedLayer ? 'passed' : 'unknown', layerKey: null, rawMessage: null };
}

export function collectBillingValidationMessages(
  layers: BillingValidationLayerSnapshot | null | undefined,
): string[] {
  if (!layers) return [];
  const messages: string[] = [];
  const seen = new Set<string>();
  for (const key of BILLING_VALIDATION_LAYER_KEYS) {
    const message = layers[key]?.message?.trim();
    if (!message || seen.has(message)) continue;
    seen.add(message);
    messages.push(message);
  }
  return messages;
}

export function safeBillingValidationMessage(summary: BillingValidationSummary): string {
  if (summary.state === 'blocked') {
    return '算定候補レビューでブロックされています。請求候補画面で根拠を確認してください。';
  }
  return '算定候補レビューが未確定です。請求候補画面で根拠を確認してください。';
}
