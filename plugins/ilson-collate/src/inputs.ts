import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { decodeText, parseCsv } from "./read-table.js";
import type { RosterEntry, TemplateConfig } from "./types.js";

export async function loadTemplateConfig(filePath: string): Promise<TemplateConfig> {
  const raw = JSON.parse(await readFile(filePath, "utf8")) as Partial<TemplateConfig>;
  const missing = (
    ["templateId", "sheetName", "headerRow", "deptColumn", "keyColumns"] as const
  ).filter((k) => raw[k] === undefined);
  if (missing.length > 0) {
    throw new Error(`${filePath}: 양식 설정에 필수 항목이 없습니다: ${missing.join(", ")}`);
  }
  return {
    requiredColumns: [],
    compareColumns: [],
    numericColumns: [],
    ...raw,
  } as TemplateConfig;
}

const ROSTER_HEADERS = { code: "부서코드", name: "부서명", required: "제출대상", contact: "담당자" };

/** 제출 명단 CSV. 열: 부서코드, 부서명, 제출대상(Y/N), 담당자. */
export async function loadRoster(filePath: string): Promise<RosterEntry[]> {
  const records = parseCsv(decodeText(await readFile(filePath)));
  const header = records[0]?.fields.map((h) => h.normalize("NFC").trim()) ?? [];
  const idx = Object.fromEntries(
    Object.entries(ROSTER_HEADERS).map(([k, h]) => [k, header.indexOf(h)]),
  ) as Record<keyof typeof ROSTER_HEADERS, number>;
  if (idx.code < 0 || idx.name < 0) {
    throw new Error(`${filePath}: 명단에 '부서코드', '부서명' 열이 필요합니다.`);
  }
  const entries: RosterEntry[] = [];
  for (const rec of records.slice(1)) {
    const get = (i: number) => (i >= 0 ? (rec.fields[i] ?? "").normalize("NFC").trim() : "");
    const code = get(idx.code);
    if (!code) continue;
    const req = get(idx.required).toUpperCase();
    entries.push({
      code,
      name: get(idx.name),
      required: req === "" || req === "Y",
      contact: get(idx.contact),
    });
  }
  return entries;
}

/** 엑셀 잠금 파일(~$), 숨김 파일, 지원하지 않는 확장자는 접수 파일로 보지 않는다. */
export function isCandidateFile(name: string): boolean {
  if (name.startsWith("~$") || name.startsWith(".")) return false;
  return [".xlsx", ".csv"].includes(path.extname(name).toLowerCase());
}

export async function listInbox(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && isCandidateFile(e.name))
    .map((e) => path.join(dir, e.name))
    .sort((a, b) => a.localeCompare(b, "ko"));
}

/**
 * 파일명으로 부서를 찾는다. macOS에서 온 파일명은 NFD일 수 있어 NFC로 맞춘 뒤 비교하고,
 * 여러 부서명이 걸리면 가장 긴 이름을 택한다(예: '안전과'와 '해양안전과').
 */
export function matchDepartment(fileName: string, roster: RosterEntry[]): RosterEntry | null {
  const name = fileName.normalize("NFC");
  let best: { entry: RosterEntry; len: number } | null = null;
  for (const entry of roster) {
    for (const token of [entry.name, entry.code]) {
      if (token && name.includes(token) && (!best || token.length > best.len)) {
        best = { entry, len: token.length };
      }
    }
  }
  return best?.entry ?? null;
}
