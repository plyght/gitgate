export async function fetchWithTimeout(
  input: string,
  init: RequestInit,
  timeoutMs: number = 30000,
): Promise<Response> {
  const url = new URL(input);
  if (url.protocol !== "https:") {
    throw new Error("HTTPS required");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}
