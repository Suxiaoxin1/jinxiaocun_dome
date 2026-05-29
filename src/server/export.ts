export function toCsv(rows: Record<string, unknown>[]) {
  const headers = Object.keys(rows[0] ?? {});
  const escape = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  return [headers.join(","), ...rows.map((row) => headers.map((header) => escape(row[header])).join(","))].join("\n");
}
