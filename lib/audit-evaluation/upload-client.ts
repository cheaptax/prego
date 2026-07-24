export type UploadProgressCallback = (percent: number) => void;

export interface AuditEvaluationUploadTransport {
  put(input: {
    url: string;
    file: File;
    headers: Record<string, string>;
    onProgress: UploadProgressCallback;
  }): Promise<void>;
}

export class XhrAuditEvaluationUploadTransport
  implements AuditEvaluationUploadTransport
{
  put(input: {
    url: string;
    file: File;
    headers: Record<string, string>;
    onProgress: UploadProgressCallback;
  }) {
    return new Promise<void>((resolve, reject) => {
      const request = new XMLHttpRequest();
      request.open("PUT", input.url);
      for (const [name, value] of Object.entries(input.headers)) {
        request.setRequestHeader(name, value);
      }
      request.upload.onprogress = (event) => {
        if (!event.lengthComputable || event.total <= 0) return;
        input.onProgress(
          Math.min(100, Math.round((event.loaded / event.total) * 100)),
        );
      };
      request.onerror = () => reject(new Error("network_error"));
      request.onabort = () => reject(new Error("network_error"));
      request.onload = () => {
        if (request.status >= 200 && request.status < 300) {
          input.onProgress(100);
          resolve();
          return;
        }
        reject(new Error(`upload_http_${request.status}`));
      };
      request.send(input.file);
    });
  }
}

export async function uploadWithNetworkRetry(
  transport: AuditEvaluationUploadTransport,
  input: {
    url: string;
    file: File;
    headers: Record<string, string>;
    onProgress: UploadProgressCallback;
    onRetry?: () => void;
  },
) {
  try {
    await transport.put(input);
  } catch (error) {
    if (
      !(error instanceof Error) ||
      error.message !== "network_error"
    ) {
      throw error;
    }
    input.onRetry?.();
    input.onProgress(0);
    await transport.put(input);
  }
}

export async function fetchWithNetworkRetry(
  input: RequestInfo | URL,
  init: RequestInit,
  fetcher: typeof fetch = fetch,
) {
  try {
    const response = await fetcher(input, init);
    if (response.status < 500) return response;
  } catch {
    // A single retry uses the same idempotency key from init.headers.
  }
  return fetcher(input, init);
}

export function createUploadIdempotencyKey() {
  return crypto.randomUUID();
}
