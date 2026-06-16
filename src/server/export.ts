export interface CsvColumn {
  key: string;
  header: string;
  format?: (value: unknown, row: Record<string, unknown>) => unknown;
}

export function toCsv(rows: Record<string, unknown>[], columns?: CsvColumn[]) {
  const activeColumns: CsvColumn[] = columns ?? Object.keys(rows[0] ?? {}).map((key) => ({ key, header: key }));
  const headers = activeColumns.map((column) => column.header);
  const escape = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  return [
    headers.join(","),
    ...rows.map((row) =>
      activeColumns
        .map((column) => {
          const value = column.format ? column.format(row[column.key], row) : formatCsvValue(row[column.key]);
          return escape(value);
        })
        .join(","),
    ),
  ].join("\n");
}

function formatCsvValue(value: unknown) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)) {
    return value.replace("T", " ").replace(/\.\d{3}Z?$/, "").replace(/Z$/, "");
  }
  return value;
}
