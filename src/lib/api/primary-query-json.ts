import { readApiJson, type ApiJsonSchema } from './client-json';

type PrimaryQueryJsonOptions<T> = {
  fallbackMessage: string;
  schema: ApiJsonSchema<T>;
};

/**
 * Keeps primary-query failures PHI-safe while preserving the one decision the
 * UI needs: whether previously authorized data may remain visible.
 */
export class PrimaryQueryError extends Error {
  constructor(
    fallbackMessage: string,
    readonly status: number | null,
    readonly canRetainCachedData: boolean,
  ) {
    super(fallbackMessage);
    this.name = 'PrimaryQueryError';
  }
}

export function canRetainCachedDataAfterPrimaryQueryError(error: unknown): boolean {
  return error instanceof PrimaryQueryError && error.canRetainCachedData;
}

export async function fetchPrimaryQueryJson<T>(
  fetchResponse: () => Promise<Response>,
  options: PrimaryQueryJsonOptions<T>,
): Promise<T> {
  let response: Response;
  try {
    response = await fetchResponse();
  } catch {
    throw new PrimaryQueryError(options.fallbackMessage, null, true);
  }

  if (!response.ok) {
    throw new PrimaryQueryError(options.fallbackMessage, response.status, response.status >= 500);
  }

  try {
    return await readApiJson(response, {
      fallbackMessage: options.fallbackMessage,
      schema: options.schema,
    });
  } catch {
    // A malformed successful response is a contract failure, not a safe stale-data signal.
    throw new PrimaryQueryError(options.fallbackMessage, response.status, false);
  }
}
