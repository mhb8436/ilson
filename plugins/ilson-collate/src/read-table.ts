import { readFile } from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";
import type { CellValue, SourceRow, SourceTable } from "./types.js";

export class TableReadError extends Error {
  constructor(
    message: string,
    readonly kind: "unreadable" | "sheet_missing",
    readonly availableSheets: string[] = [],
  ) {
    super(message);
  }
}

/**
 * 기관에서 받는 CSV는 엑셀이 저장한 CP949(EUC-KR)인 경우가 많다.
 * UTF-8로 엄격하게 해석해 보고 실패하면 EUC-KR로 다시 읽는다.
 */
export function decodeText(buf: Uint8Array): string {
  try {
    return stripBom(new TextDecoder("utf-8", { fatal: true }).decode(buf));
  } catch {
    return new TextDecoder("euc-kr").decode(buf);
  }
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** RFC 4180 CSV 파서. 따옴표 안의 쉼표와 줄바꿈을 처리하고, 각 레코드의 시작 줄 번호를 함께 돌려준다. */
export function parseCsv(text: string): { line: number; fields: string[] }[] {
  const records: { line: number; fields: string[] }[] = [];
  let fields: string[] = [];
  let field = "";
  let inQuotes = false;
  let line = 1;
  let recordLine = 1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        if (ch === "\n") line++;
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      fields.push(field);
      field = "";
    } else if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      fields.push(field);
      records.push({ line: recordLine, fields });
      fields = [];
      field = "";
      line++;
      recordLine = line;
    } else {
      field += ch;
    }
  }
  if (field !== "" || fields.length > 0) {
    fields.push(field);
    records.push({ line: recordLine, fields });
  }
  return records;
}

function isBlankRow(values: Record<string, CellValue>): boolean {
  return Object.values(values).every((v) => v === null || v === "");
}

function normalizeHeader(value: unknown): string {
  return String(value ?? "")
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .trim();
}

/** exceljs 셀 값을 문자열/숫자/null로 정리한다. 수식은 계산 결과를, 서식 텍스트는 평문을 쓴다. */
export function normalizeCell(value: ExcelJS.CellValue): CellValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return value;
  if (typeof value === "string") return value.normalize("NFC");
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    if ("richText" in value) return value.richText.map((r) => r.text).join("").normalize("NFC");
    if ("result" in value) return normalizeCell(value.result as ExcelJS.CellValue);
    if ("text" in value) return String(value.text).normalize("NFC");
    if ("error" in value) return null;
  }
  return String(value);
}

export async function readCsvTable(filePath: string, headerRow: number): Promise<SourceTable> {
  const file = path.basename(filePath).normalize("NFC");
  const records = parseCsv(decodeText(await readFile(filePath)));
  const header = records[headerRow - 1];
  if (!header) throw new TableReadError(`${file}: 머리글 행(${headerRow})이 없습니다.`, "unreadable");
  const headers = header.fields.map(normalizeHeader);
  const rows: SourceRow[] = [];
  for (const rec of records.slice(headerRow)) {
    const values: Record<string, CellValue> = {};
    headers.forEach((h, idx) => {
      if (!h) return;
      const raw = rec.fields[idx];
      values[h] = raw === undefined || raw.trim() === "" ? null : raw.normalize("NFC");
    });
    if (isBlankRow(values)) continue;
    rows.push({ ref: { file, sheet: null, row: rec.line }, values });
  }
  return { file, sheet: null, headers: headers.filter(Boolean), rows };
}

export async function readXlsxTable(
  filePath: string,
  sheetName: string,
  headerRow: number,
): Promise<SourceTable> {
  const file = path.basename(filePath).normalize("NFC");
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.readFile(filePath);
  } catch (err) {
    throw new TableReadError(`${file}: 파일을 열 수 없습니다 (${(err as Error).message}).`, "unreadable");
  }
  const sheets = wb.worksheets.map((ws) => ws.name.normalize("NFC"));
  const ws = wb.worksheets.find((s) => s.name.normalize("NFC") === sheetName.normalize("NFC"));
  if (!ws) {
    throw new TableReadError(
      `${file}: '${sheetName}' 시트가 없습니다 (있는 시트: ${sheets.join(", ") || "없음"}).`,
      "sheet_missing",
      sheets,
    );
  }
  const headerCells = ws.getRow(headerRow);
  const columns: { col: number; name: string }[] = [];
  headerCells.eachCell({ includeEmpty: false }, (cell, col) => {
    const name = normalizeHeader(normalizeCell(cell.value));
    if (name) columns.push({ col, name });
  });
  const rows: SourceRow[] = [];
  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const values: Record<string, CellValue> = {};
    for (const { col, name } of columns) {
      const v = normalizeCell(row.getCell(col).value);
      values[name] = typeof v === "string" && v.trim() === "" ? null : v;
    }
    if (isBlankRow(values)) continue;
    rows.push({ ref: { file, sheet: ws.name.normalize("NFC"), row: r }, values });
  }
  return { file, sheet: ws.name.normalize("NFC"), headers: columns.map((c) => c.name), rows };
}

export async function readTable(
  filePath: string,
  sheetName: string,
  headerRow: number,
): Promise<SourceTable> {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".csv") return readCsvTable(filePath, headerRow);
  if (ext === ".xlsx") return readXlsxTable(filePath, sheetName, headerRow);
  throw new TableReadError(`${path.basename(filePath)}: 지원하지 않는 형식(${ext})입니다.`, "unreadable");
}
