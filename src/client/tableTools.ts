import type { AnyRow } from "./types";

export function rowMatchesKeyword(row: AnyRow, keys: string[], keyword: string) {
  const normalized = keyword.trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  return keys.some((key) => String(row[key] ?? "").toLowerCase().includes(normalized));
}

export function selectFirstVisibleOption<T extends AnyRow>(items: T[], currentId: string, idKey = "id") {
  const currentVisible = items.some((item) => String(item[idKey] ?? "") === currentId);
  if (currentVisible) {
    return currentId;
  }
  return String(items[0]?.[idKey] ?? "");
}

export function buildExportHref(path: string, params: Record<string, string | null | undefined> = {}) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    const normalized = value?.trim();
    if (normalized) {
      query.set(key, normalized);
    }
  });
  const queryText = query.toString();
  return `${path}.xlsx${queryText ? `?${queryText}` : ""}`;
}

export function dateInputToLocalStartIso(value: string) {
  if (!value) {
    return "";
  }
  const [year, month, day] = dateInputParts(value);
  return new Date(year, month - 1, day).toISOString();
}

export function dateInputToLocalNextDayIso(value: string) {
  if (!value) {
    return "";
  }
  const [year, month, day] = dateInputParts(value);
  return new Date(year, month - 1, day + 1).toISOString();
}

function dateInputParts(value: string) {
  return value.split("-").map(Number);
}
