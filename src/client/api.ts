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
    body,
  });
  return parseJsonResponse<T>(response);
}

async function requestJson<T>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    ...init,
  });
  return parseJsonResponse<T>(response);
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const errorMessage = typeof data?.error === "string" ? data.error : "请求失败";
    throw new Error(errorMessage);
  }
  return data as T;
}
