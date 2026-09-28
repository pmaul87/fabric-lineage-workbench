interface ReadJsonResponseOptions {
  operation: string;
  endpoint?: string;
}

function isLikelyHtmlResponse(contentType: string, body: string): boolean {
  const trimmed = body.trimStart();
  return contentType.includes("text/html") || trimmed.startsWith("<!DOCTYPE") || trimmed.startsWith("<html");
}

function isLocalHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1";
}

export async function readJsonResponse<T>(response: Response, options: ReadJsonResponseOptions): Promise<T> {
  const contentType = (response.headers.get("content-type") || "").toLowerCase();
  const bodyText = await response.text();

  if (!bodyText.trim()) {
    throw new Error(`${options.operation} returned an empty response (${response.status}).`);
  }

  if (isLikelyHtmlResponse(contentType, bodyText)) {
    const configuredBaseUrl = (process.env.BACKEND_URL || "").trim();
    const hostedWithoutBackendHint =
      typeof window !== "undefined" &&
      !configuredBaseUrl &&
      !isLocalHost(window.location.hostname);

    const baseMessage = `${options.operation} returned HTML instead of JSON (${response.status}).`;
    const hint = hostedWithoutBackendHint
      ? " The frontend is likely running without a reachable backend API. Configure BACKEND_URL or run the local dev server that hosts the /api routes."
      : " The request likely hit a fallback page or proxy error instead of the API route.";
    const endpointHint = options.endpoint ? ` Endpoint: ${options.endpoint}.` : "";

    throw new Error(`${baseMessage}${hint}${endpointHint}`);
  }

  try {
    return JSON.parse(bodyText) as T;
  } catch {
    const endpointHint = options.endpoint ? ` Endpoint: ${options.endpoint}.` : "";
    throw new Error(`${options.operation} returned invalid JSON (${response.status}).${endpointHint}`);
  }
}