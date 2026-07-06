import type { ReactNode } from "react";
import { formatDateTime } from "../formatters";
import type { AnyRow } from "../types";

export interface DataColumn<T extends AnyRow> {
  key: string;
  header: string;
  className?: string;
  render?: (row: T) => ReactNode;
}

export default function DataTable<T extends AnyRow>({
  columns,
  rows,
  emptyText = "暂无数据",
  loading = false,
  loadingText = "加载中...",
  selectable = false,
  selectedRowIds = [],
  onSelectedRowIdsChange,
  highlightKeyword = "",
  showRowNumber = false,
  rowNumberStart = 0,
}: {
  columns: DataColumn<T>[];
  rows: T[];
  emptyText?: string;
  loading?: boolean;
  loadingText?: string;
  selectable?: boolean;
  selectedRowIds?: string[];
  onSelectedRowIdsChange?: (ids: string[]) => void;
  highlightKeyword?: string;
  showRowNumber?: boolean;
  rowNumberStart?: number;
}) {
  const rowIds = rows.map((row, index) => rowId(row, index));
  const selectedSet = new Set(selectedRowIds);
  const allSelected = rowIds.length > 0 && rowIds.every((id) => selectedSet.has(id));
  const visibleSelectedIds = selectedRowIds.filter((id) => rowIds.includes(id));

  function updateSelected(ids: string[]) {
    onSelectedRowIdsChange?.(ids);
  }

  return (
    <div className="table-wrap">
      <table className="data-table" aria-busy={loading ? "true" : undefined}>
        <thead>
          <tr>
            {selectable ? (
              <th className="selection-cell">
                <input
                  type="checkbox"
                  aria-label="选择全部"
                  checked={allSelected}
                  disabled={rowIds.length === 0}
                  onChange={(event) => updateSelected(event.target.checked ? rowIds : [])}
                />
              </th>
            ) : null}
            {showRowNumber ? <th className="row-number-cell">序号</th> : null}
            {columns.map((column) => (
              <th key={column.key} className={column.className}>{column.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td colSpan={columns.length + (selectable ? 1 : 0)} className="empty-cell table-loading-cell" role="status">
                {loadingText}
              </td>
            </tr>
          ) : rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length + (selectable ? 1 : 0)} className="empty-cell">
                {emptyText}
              </td>
            </tr>
          ) : (
            rows.map((row, index) => (
              <tr key={rowIds[index]}>
                {selectable ? (
                  <td className="selection-cell">
                    <input
                      type="checkbox"
                      aria-label={`选择第 ${index + 1} 行`}
                      checked={selectedSet.has(rowIds[index])}
                      onChange={(event) => {
                        if (event.target.checked) {
                          updateSelected([...visibleSelectedIds, rowIds[index]]);
                        } else {
                          updateSelected(visibleSelectedIds.filter((id) => id !== rowIds[index]));
                        }
                      }}
                    />
                  </td>
                ) : null}
                {showRowNumber ? <td className="row-number-cell">{rowNumberStart + index + 1}</td> : null}
                {columns.map((column) => (
                  <td key={column.key} className={column.className}>
                    {column.render ? column.render(row) : highlightText(formatCell(row[column.key]), highlightKeyword)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function rowId(row: AnyRow, index: number) {
  return String(row.id ?? row.partId ?? index);
}

function formatCell(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return "-";
  }
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
    return formatDateTime(value);
  }
  return String(value);
}

function highlightText(text: string, keyword: string) {
  const normalizedKeyword = keyword.trim().toLowerCase();
  if (!normalizedKeyword) {
    return text;
  }

  const normalizedText = text.toLowerCase();
  const parts: ReactNode[] = [];
  let cursor = 0;
  let matchIndex = normalizedText.indexOf(normalizedKeyword);
  while (matchIndex >= 0) {
    if (matchIndex > cursor) {
      parts.push(text.slice(cursor, matchIndex));
    }
    const matchEnd = matchIndex + normalizedKeyword.length;
    parts.push(
      <mark className="search-highlight" key={`${matchIndex}-${matchEnd}`}>
        {text.slice(matchIndex, matchEnd)}
      </mark>,
    );
    cursor = matchEnd;
    matchIndex = normalizedText.indexOf(normalizedKeyword, cursor);
  }
  if (cursor < text.length) {
    parts.push(text.slice(cursor));
  }
  return parts.length > 0 ? parts : text;
}
