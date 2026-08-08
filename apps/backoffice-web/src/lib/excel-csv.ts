export type CsvCellValue = string | number | null | undefined;

function escapeCsvCell(value: CsvCellValue, delimiter: string) {
  const text = String(value ?? "");
  const safeText = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safeText.replace(/"/g, '""')}"`;
}

function escapeHtml(value: CsvCellValue) {
  const text = String(value ?? "");
  const safeText = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return safeText
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildExcelCsvText(rows: CsvCellValue[][], delimiter = ",") {
  const body = rows.map((row) => row.map((cell) => escapeCsvCell(cell, delimiter)).join(delimiter)).join("\r\n");
  return `sep=${delimiter}\r\n${body}\r\n`;
}

export function buildExcelHtmlText(rows: CsvCellValue[][]) {
  const htmlRows = rows
    .map(
      (row) =>
        `<tr>${row
          .map((cell) => `<td style="mso-number-format:'\\@';white-space:nowrap;">${escapeHtml(cell)}</td>`)
          .join("")}</tr>`
    )
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>table{border-collapse:collapse;}td{border:1px solid #d9e2ef;padding:4px 8px;font-family:Tahoma,Arial,sans-serif;font-size:11pt;}</style></head><body><table>${htmlRows}</table></body></html>`;
}

export function buildExcelHtmlBytes(rows: CsvCellValue[][]) {
  return new TextEncoder().encode(`\uFEFF${buildExcelHtmlText(rows)}`);
}

export function buildExcelHtmlBlob(rows: CsvCellValue[][]) {
  return new Blob([buildExcelHtmlBytes(rows)], { type: "application/vnd.ms-excel;charset=utf-8" });
}

function toExcelHtmlFilename(filename: string) {
  return filename.replace(/\.csv$/i, ".xls") || "export.xls";
}

export function downloadExcelCsv(filename: string, rows: CsvCellValue[][]) {
  const blob = buildExcelHtmlBlob(rows);
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = toExcelHtmlFilename(filename);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => window.URL.revokeObjectURL(url), 1000);
}
