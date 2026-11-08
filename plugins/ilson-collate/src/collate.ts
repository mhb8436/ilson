import path from "node:path";
import { listInbox, matchDepartment } from "./inputs.js";
import { readTable, TableReadError } from "./read-table.js";
import type {
  CellValue,
  CollateReport,
  DeptSummary,
  Finding,
  FindingType,
  RosterEntry,
  SourceRef,
  SourceRow,
  TemplateConfig,
} from "./types.js";

export interface CollateInput {
  config: TemplateConfig;
  roster: RosterEntry[];
  week: string;
  /** 이번 주 접수 폴더. */
  inboxDir: string;
  /** 지난주 확정본 파일. 첫 주에는 없을 수 있다. */
  previousFile?: string;
  previousWeek?: string;
}

/** 숫자 열 해석. 쉼표, 공백, % 기호만 허용하고 그 외 문자가 있으면 null(판독 불가). */
export function parseNumber(value: CellValue): number | null {
  if (value === null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const cleaned = value.replace(/[,\s%]/g, "");
  if (!/^[-+]?(\d+(\.\d*)?|\.\d+)$/.test(cleaned)) return null;
  return Number(cleaned);
}

function normalizeText(value: CellValue): string {
  if (value === null) return "";
  return String(value).normalize("NFC").replace(/\s+/g, " ").trim();
}

function rowKey(row: SourceRow, keyColumns: string[]): string | null {
  const parts = keyColumns.map((c) => normalizeText(row.values[c] ?? null));
  return parts.some((p) => p === "") ? null : parts.join("|");
}

function rowSignature(row: SourceRow, headers: string[]): string {
  return headers.map((h) => normalizeText(row.values[h] ?? null)).join("\u0000");
}

function refText(ref: SourceRef): string {
  const sheet = ref.sheet ? ` / ${ref.sheet} 시트` : "";
  const row = ref.row !== null ? ` ${ref.row}행` : "";
  return `${ref.file}${sheet}${row}`;
}

const AUDIENCE: Record<FindingType, Finding["audience"]> = {
  submission_missing: "department",
  multiple_files: "reviewer",
  unknown_file: "reviewer",
  unreadable_file: "department",
  sheet_missing: "department",
  header_missing: "department",
  dept_mismatch: "department",
  required_empty: "department",
  invalid_number: "department",
  duplicate_row: "department",
  value_changed: "reviewer",
  row_added: "reviewer",
  row_removed: "reviewer",
};

interface Located {
  dept: string;
  key: string;
  row: SourceRow;
}

function deptCodeFromValue(value: CellValue, roster: RosterEntry[]): string | null {
  const v = normalizeText(value);
  const hit = roster.find((r) => r.name === v || r.code === v);
  return hit?.code ?? null;
}

export async function collate(input: CollateInput): Promise<CollateReport> {
  const { config, roster, week } = input;
  const findings: Finding[] = [];
  const add = (f: Omit<Finding, "audience">) => findings.push({ ...f, audience: AUDIENCE[f.type] });
  const numeric = new Set(config.numericColumns);

  // 1. 접수 파일을 부서에 배정한다.
  const files = await listInbox(input.inboxDir);
  const filesByDept = new Map<string, string[]>();
  for (const filePath of files) {
    const fileName = path.basename(filePath).normalize("NFC");
    const dept = matchDepartment(fileName, roster);
    if (!dept) {
      add({
        type: "unknown_file",
        dept: null,
        key: null,
        ref: { file: fileName, sheet: null, row: null },
        message: `${fileName}: 명단의 어느 부서와도 맞지 않는 파일입니다. 취합 대상인지 확인이 필요합니다.`,
      });
      continue;
    }
    filesByDept.set(dept.code, [...(filesByDept.get(dept.code) ?? []), filePath]);
  }

  // 2. 부서별 파일을 읽고 행 단위 검사를 한다.
  const departments: DeptSummary[] = [];
  const current: Located[] = [];
  const submittedDepts = new Set<string>();
  for (const dept of roster) {
    const deptFiles = filesByDept.get(dept.code) ?? [];
    const summary: DeptSummary = {
      code: dept.code,
      name: dept.name,
      status: dept.required ? "missing" : "not_required",
      files: deptFiles.map((f) => path.basename(f).normalize("NFC")),
      rowCount: 0,
    };
    departments.push(summary);
    if (deptFiles.length === 0) {
      if (dept.required) {
        add({
          type: "submission_missing",
          dept: dept.code,
          key: null,
          ref: { file: path.basename(input.inboxDir), sheet: null, row: null },
          message: `${dept.name}: 지정 폴더에 이번 주 자료가 없습니다. 다른 경로로 접수했을 수 있으므로 자료 확인이 필요합니다.`,
        });
      }
      continue;
    }
    if (deptFiles.length > 1) {
      add({
        type: "multiple_files",
        dept: dept.code,
        key: null,
        ref: { file: summary.files.join(", "), sheet: null, row: null },
        message: `${dept.name}: 파일이 ${deptFiles.length}개 접수되었습니다. 최종본이 어느 것인지 확인이 필요합니다.`,
      });
    }

    let readable = false;
    for (const filePath of deptFiles) {
      const fileName = path.basename(filePath).normalize("NFC");
      let table;
      try {
        table = await readTable(filePath, config.sheetName, config.headerRow);
      } catch (err) {
        if (!(err instanceof TableReadError)) throw err;
        add({
          type: err.kind === "sheet_missing" ? "sheet_missing" : "unreadable_file",
          dept: dept.code,
          key: null,
          ref: { file: fileName, sheet: null, row: null },
          message: `${dept.name}: ${err.message}`,
        });
        continue;
      }
      const absent = [config.deptColumn, ...config.keyColumns, ...config.requiredColumns].filter(
        (c, i, arr) => arr.indexOf(c) === i && !table.headers.includes(c),
      );
      if (absent.length > 0) {
        add({
          type: "header_missing",
          dept: dept.code,
          key: null,
          ref: { file: fileName, sheet: table.sheet, row: config.headerRow },
          message: `${dept.name}: 양식에 필요한 열이 없습니다: ${absent.join(", ")}`,
        });
        continue;
      }
      readable = true;
      summary.rowCount += table.rows.length;

      for (const row of table.rows) {
        const key = rowKey(row, config.keyColumns);
        const rowDept = deptCodeFromValue(row.values[config.deptColumn] ?? null, roster);
        if (rowDept !== dept.code) {
          add({
            type: "dept_mismatch",
            dept: dept.code,
            key,
            ref: { ...row.ref, column: config.deptColumn },
            after: row.values[config.deptColumn] ?? null,
            message: `${refText(row.ref)}: 부서 값이 '${normalizeText(row.values[config.deptColumn] ?? null)}'(으)로 되어 있습니다. 파일 제출 부서는 ${dept.name}입니다.`,
          });
        }
        for (const col of config.requiredColumns) {
          if (normalizeText(row.values[col] ?? null) === "") {
            add({
              type: "required_empty",
              dept: dept.code,
              key,
              ref: { ...row.ref, column: col },
              message: `${refText(row.ref)}${key ? ` (${key})` : ""}: 필수 항목 '${col}'이(가) 비어 있습니다.`,
            });
          }
        }
        for (const col of config.numericColumns) {
          const v = row.values[col] ?? null;
          if (v !== null && parseNumber(v) === null) {
            add({
              type: "invalid_number",
              dept: dept.code,
              key,
              ref: { ...row.ref, column: col },
              after: v,
              message: `${refText(row.ref)}${key ? ` (${key})` : ""}: '${col}' 값 '${v}'을(를) 숫자로 읽을 수 없습니다.`,
            });
          }
        }
        if (key) current.push({ dept: dept.code, key, row });
      }
    }
    if (readable) {
      summary.status = "submitted";
      submittedDepts.add(dept.code);
    } else {
      summary.status = "unreadable";
    }
  }

  // 3. 이번 주 전체에서 같은 키가 반복되면 중복이다. 첫 행만 비교 기준으로 남긴다.
  const firstByKey = new Map<string, Located>();
  for (const item of current) {
    const first = firstByKey.get(item.key);
    if (!first) {
      firstByKey.set(item.key, item);
      continue;
    }
    const cols = Object.keys(item.row.values).filter((c) => c !== config.deptColumn);
    const exact = rowSignature(first.row, cols) === rowSignature(item.row, cols);
    add({
      type: "duplicate_row",
      dept: item.dept,
      key: item.key,
      ref: item.row.ref,
      relatedRef: first.row.ref,
      exactDuplicate: exact,
      message: `${refText(item.row.ref)}: 과제 ${item.key}이(가) ${refText(first.row.ref)}와 중복입니다${exact ? " (값 동일)" : " (값이 서로 다름)"}.`,
    });
  }

  // 4. 지난주 확정본과 비교한다.
  if (input.previousFile) {
    const prevTable = await readTable(input.previousFile, config.sheetName, config.headerRow);
    const prevByKey = new Map<string, { dept: string | null; row: SourceRow }>();
    for (const row of prevTable.rows) {
      const key = rowKey(row, config.keyColumns);
      if (key && !prevByKey.has(key)) {
        prevByKey.set(key, { dept: deptCodeFromValue(row.values[config.deptColumn] ?? null, roster), row });
      }
    }
    for (const [key, cur] of firstByKey) {
      const prev = prevByKey.get(key);
      if (!prev) {
        add({
          type: "row_added",
          dept: cur.dept,
          key,
          ref: cur.row.ref,
          message: `${refText(cur.row.ref)}: 지난주 확정본에 없던 과제 ${key}이(가) 추가되었습니다.`,
        });
        continue;
      }
      for (const col of config.compareColumns) {
        const after = cur.row.values[col] ?? null;
        const before = prev.row.values[col] ?? null;
        // 이번 주 값이 비었거나 숫자로 읽을 수 없으면 이미 보완 대상이므로 변경으로 세지 않는다.
        if (normalizeText(after) === "") continue;
        if (numeric.has(col)) {
          const a = parseNumber(after);
          const b = parseNumber(before);
          if (a === null || a === b) continue;
          add({
            type: "value_changed",
            dept: cur.dept,
            key,
            ref: { ...cur.row.ref, column: col },
            relatedRef: { ...prev.row.ref, column: col },
            before: b,
            after: a,
            ...(b !== null ? { delta: a - b } : {}),
            message: `${refText(cur.row.ref)} (${key}): '${col}' ${b ?? "(빈 값)"} -> ${a}`,
          });
        } else if (normalizeText(after) !== normalizeText(before)) {
          add({
            type: "value_changed",
            dept: cur.dept,
            key,
            ref: { ...cur.row.ref, column: col },
            relatedRef: { ...prev.row.ref, column: col },
            before,
            after,
            message: `${refText(cur.row.ref)} (${key}): '${col}' '${normalizeText(before)}' -> '${normalizeText(after)}'`,
          });
        }
      }
    }
    // 제출한 부서의 과제가 이번 주에 빠졌을 때만 삭제로 본다. 미제출 부서는 이미 별도 항목이 있다.
    for (const [key, prev] of prevByKey) {
      if (firstByKey.has(key) || !prev.dept || !submittedDepts.has(prev.dept)) continue;
      add({
        type: "row_removed",
        dept: prev.dept,
        key,
        ref: prev.row.ref,
        message: `과제 ${key}이(가) 이번 주 자료에 없습니다 (지난주 ${refText(prev.row.ref)}).`,
      });
    }
  }

  findings.sort(compareFindings(roster, config));
  const counts: CollateReport["counts"] = {};
  for (const f of findings) counts[f.type] = (counts[f.type] ?? 0) + 1;
  return {
    templateId: config.templateId,
    week,
    previousWeek: input.previousWeek ?? null,
    departments,
    findings,
    counts,
  };
}

/** 명단 순서, 파일, 행, 양식의 열 순서로 정렬해 같은 입력에 항상 같은 결과를 낸다. */
function compareFindings(roster: RosterEntry[], config: TemplateConfig) {
  const order = new Map(roster.map((r, i) => [r.code, i]));
  const columns = [
    config.deptColumn,
    ...config.keyColumns,
    ...config.requiredColumns,
    ...config.compareColumns,
    ...config.numericColumns,
  ];
  const colIndex = (c: string | undefined) => (c === undefined ? -1 : columns.indexOf(c));
  return (a: Finding, b: Finding): number =>
    (order.get(a.dept ?? "") ?? Number.MAX_SAFE_INTEGER) -
      (order.get(b.dept ?? "") ?? Number.MAX_SAFE_INTEGER) ||
    a.ref.file.localeCompare(b.ref.file, "ko") ||
    (a.ref.row ?? 0) - (b.ref.row ?? 0) ||
    colIndex(a.ref.column) - colIndex(b.ref.column) ||
    a.type.localeCompare(b.type);
}
