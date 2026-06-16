let unauthorizedHandler: (() => void) | null = null;

export function setUnauthorizedHandler(handler: (() => void) | null) {
  unauthorizedHandler = handler;
}

export async function apiGet<T>(path: string): Promise<T> {
  return requestJson<T>(path, { method: "GET" });
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  return requestJson<T>(path, { method: "POST", body: JSON.stringify(body) });
}

export async function apiPut<T>(path: string, body: unknown): Promise<T> {
  return requestJson<T>(path, { method: "PUT", body: JSON.stringify(body) });
}

export async function apiDelete<T>(path: string): Promise<T> {
  return requestJson<T>(path, { method: "DELETE" });
}

export async function apiUploadFile<T>(path: string, file: File): Promise<T> {
  const body = new FormData();
  body.append("file", file);
  const response = await fetch(path, {
    method: "POST",
    credentials: "include",
    headers: csrfHeaders("POST"),
    body,
  });
  return parseJsonResponse<T>(response);
}

async function requestJson<T>(path: string, init: RequestInit): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  for (const [name, value] of Object.entries(csrfHeaders(init.method))) {
    headers.set(name, value);
  }

  const response = await fetch(path, {
    ...init,
    credentials: "include",
    headers,
  });
  return parseJsonResponse<T>(response);
}

function csrfHeaders(method = "GET"): Record<string, string> {
  return ["POST", "PUT", "DELETE", "PATCH"].includes(method.toUpperCase())
    ? { "X-Berni-CSRF": "1" }
    : {};
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) {
      unauthorizedHandler?.();
    }
    const errorMessage = typeof data?.error === "string" ? data.error : "请求失败";
    throw new Error(errorMessage);
  }
  return data as T;
}
