import type { ReactNode } from "react";
import type { AnyRow } from "../types";

export interface DataColumn<T extends AnyRow> {
  key: string;
  header: string;
  render?: (row: T) => ReactNode;
}

export default function DataTable<T extends AnyRow>({
  columns,
  rows,
  emptyText = "暂无数据",
}: {
  columns: DataColumn<T>[];
  rows: T[];
  emptyText?: string;
}) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key}>{column.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="empty-cell">
                {emptyText}
              </td>
            </tr>
          ) : (
            rows.map((row, index) => (
              <tr key={String(row.id ?? row.partId ?? index)}>
                {columns.map((column) => (
                  <td key={column.key}>{column.render ? column.render(row) : formatCell(row[column.key])}</td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function formatCell(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return "-";
  }
  return String(value);
}
