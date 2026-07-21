export type ParsedJsonResponse = {
  payload: unknown;
  invalid_json: boolean;
  response_too_large: boolean;
  max_response_bytes?: number;
  content_type: string | null;
};

class ResponseBodyTooLargeError extends Error {
  constructor(readonly maxBytes: number) {
    super('PH-OS API response body exceeded the configured size limit');
    this.name = 'ResponseBodyTooLargeError';
  }
}

function parseContentLength(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

async function readResponseText(response: Response, maxBytes: number): Promise<string> {
  const contentLength = parseContentLength(response.headers.get('content-length'));
  if (contentLength !== null && contentLength > maxBytes) {
    throw new ResponseBodyTooLargeError(maxBytes);
  }
  if (!response.body) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) {
      throw new ResponseBodyTooLargeError(maxBytes);
    }
    return text;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new ResponseBodyTooLargeError(maxBytes);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export async function readJsonResponse(
  response: Response,
  maxBytes: number,
): Promise<ParsedJsonResponse> {
  const contentType = response.headers.get('content-type');
  let text: string;
  try {
    text = await readResponseText(response, maxBytes);
  } catch (error) {
    if (error instanceof ResponseBodyTooLargeError) {
      return {
        payload: undefined,
        invalid_json: false,
        response_too_large: true,
        max_response_bytes: error.maxBytes,
        content_type: contentType,
      };
    }
    throw error;
  }
  if (!text) {
    return {
      payload: undefined,
      invalid_json: false,
      response_too_large: false,
      content_type: contentType,
    };
  }
  try {
    return {
      payload: JSON.parse(text),
      invalid_json: false,
      response_too_large: false,
      content_type: contentType,
    };
  } catch {
    return {
      payload: undefined,
      invalid_json: true,
      response_too_large: false,
      content_type: contentType,
    };
  }
}
