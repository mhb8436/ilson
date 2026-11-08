import { copyFile, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeFixtures } from "../scripts/make-fixtures.js";
import {
  buildRequestDrafts,
  checkRewrite,
  collate,
  decodeText,
  loadRoster,
  loadTemplateConfig,
  matchDepartment,
  parseCsv,
  parseNumber,
  renderMarkdown,
  type CollateReport,
  type Finding,
  type RosterEntry,
} from "../src/index.js";

const FIXTURE_SRC = path.resolve(fileURLToPath(import.meta.url), "../../../../fixtures/weekly-report");

interface ExpectedFinding {
  type: string;
  dept: string | null;
  file?: string;
  sheet?: string | null;
  row?: number;
  column?: string;
  key?: string;
  relatedRow?: number;
  exactDuplicate?: boolean;
  before?: string | number;
  after?: string | number;
}

let dir: string;
let roster: RosterEntry[];
let report: CollateReport;
let expected: { departments: Record<string, string>; findings: ExpectedFinding[] };

async function run(inbox = path.join(dir, "inbox", "2026-W45")): Promise<CollateReport> {
  return collate({
    config: await loadTemplateConfig(path.join(FIXTURE_SRC, "template.json")),
    roster,
    week: "2026-W45",
    inboxDir: inbox,
    previousFile: path.join(dir, "confirmed", "2026-W44_주간보고_확정본.xlsx"),
    previousWeek: "2026-W44",
  });
}

/** 정답표에 적힌 필드만 비교한다. 정답표에 없는 필드는 판정 대상이 아니다. */
function project(f: Finding, shape: ExpectedFinding): ExpectedFinding {
  const full: ExpectedFinding = {
    type: f.type,
    dept: f.dept,
    file: f.ref.file,
    sheet: f.ref.sheet,
    ...(f.ref.row !== null ? { row: f.ref.row } : {}),
    ...(f.ref.column ? { column: f.ref.column } : {}),
    ...(f.key ? { key: f.key } : {}),
    ...(f.relatedRef?.row != null ? { relatedRow: f.relatedRef.row } : {}),
    ...(f.exactDuplicate !== undefined ? { exactDuplicate: f.exactDuplicate } : {}),
    ...(f.before !== undefined && f.before !== null ? { before: f.before } : {}),
    ...(f.after !== undefined && f.after !== null ? { after: f.after } : {}),
  };
  return Object.fromEntries(
    Object.keys(shape).map((k) => [k, full[k as keyof ExpectedFinding]]),
  ) as unknown as ExpectedFinding;
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "ilson-collate-"));
  await makeFixtures(dir);
  roster = await loadRoster(path.join(dir, "roster.csv"));
  expected = JSON.parse(await readFile(path.join(FIXTURE_SRC, "expected.json"), "utf8"));
  report = await run();
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("주간보고 대조: 정답표 일치", () => {
  it("부서별 제출 상태가 정답과 같다", () => {
    const actual = Object.fromEntries(report.departments.map((d) => [d.code, d.status]));
    expect(actual).toEqual(expected.departments);
  });

  it("결과 건수가 정답과 같다(누락도 초과도 없음)", () => {
    expect(report.findings.length).toBe(expected.findings.length);
  });

  it("모든 결과의 유형, 파일, 시트, 행, 열, 과제가 정답과 같다", () => {
    const actual = report.findings.map((f, i) => project(f, expected.findings[i] ?? { type: "", dept: null }));
    expect(actual).toEqual(expected.findings);
  });

  it("같은 입력이면 같은 결과를 낸다", async () => {
    expect(await run()).toEqual(report);
  });

  it("엑셀 잠금 파일은 접수 파일로 보지 않는다", () => {
    expect(report.findings.some((f) => f.ref.file.startsWith("~$"))).toBe(false);
  });
});

describe("보완 요청 초안", () => {
  it("부서 대상 결과가 있는 부서에만 초안을 만든다", () => {
    const drafts = buildRequestDrafts(report, roster);
    expect(drafts.map((d) => d.dept)).toEqual(["D02", "D03", "D04", "D05", "D06"]);
  });

  it("전주 대비 변경은 부서 요청에 넣지 않는다", () => {
    const d01 = buildRequestDrafts(report, roster).find((d) => d.dept === "D01");
    expect(d01).toBeUndefined();
  });

  it("초안에 파일, 행, 과제ID 근거가 들어간다", () => {
    const d02 = buildRequestDrafts(report, roster).find((d) => d.dept === "D02");
    expect(d02?.text).toContain("운영지원과_주간보고_2026-W45.xlsx 주간보고 시트 2행 (P-0201)");
    expect(d02?.text).toContain("3행과 중복");
    expect(checkRewrite(d02!, d02!.text).ok).toBe(true);
  });

  it("모델 문안에서 근거 표기가 빠지면 검사에서 걸린다", () => {
    const d02 = buildRequestDrafts(report, roster).find((d) => d.dept === "D02")!;
    const check = checkRewrite(d02, "운영지원과 담당자님, 담당자 항목을 채워 주세요.");
    expect(check.ok).toBe(false);
    expect(check.missing).toContain("P-0201");
  });

  it("검토함 Markdown에 미제출 부서가 '자료 확인 필요'로 표시된다", () => {
    expect(renderMarkdown(report)).toContain("| 감사담당관 | 자료 확인 필요 | - | 0 |");
  });
});

describe("다음 주 재실행 상황", () => {
  it("접수 파일이 하나도 없는 주에는 제출 대상 부서가 모두 '자료 확인 필요'다", async () => {
    const empty = await mkdtemp(path.join(dir, "empty-"));
    const r = await run(empty);
    expect(r.findings.filter((f) => f.type === "submission_missing").map((f) => f.dept)).toEqual([
      "D01",
      "D02",
      "D03",
      "D04",
      "D05",
      "D06",
    ]);
    expect(r.findings.some((f) => f.type === "row_removed")).toBe(false);
  });

  it("한 부서가 파일을 두 개 올리면 담당자 확인 대상으로 표시한다", async () => {
    const inbox = path.join(dir, "inbox", "2026-W45");
    const extra = path.join(inbox, "기획조정실_주간보고_2026-W45_수정.xlsx");
    await copyFile(path.join(inbox, "기획조정실_주간보고_2026-W45.xlsx"), extra);
    try {
      const r = await run();
      const multi = r.findings.filter((f) => f.type === "multiple_files");
      expect(multi).toHaveLength(1);
      expect(multi[0]?.dept).toBe("D01");
      expect(multi[0]?.audience).toBe("reviewer");
    } finally {
      await rm(extra);
    }
  });

  it("macOS에서 온 NFD 파일명도 부서와 맞춘다", async () => {
    const inbox = path.join(dir, "inbox", "2026-W45");
    const nfc = path.join(inbox, "기획조정실_주간보고_2026-W45.xlsx");
    const nfd = path.join(inbox, "기획조정실_주간보고_2026-W45.xlsx".normalize("NFD"));
    await rename(nfc, nfd);
    try {
      const r = await run();
      expect(r.departments.find((d) => d.code === "D01")?.status).toBe("submitted");
    } finally {
      await rename(nfd, nfc);
    }
  });
});

describe("기본 판독", () => {
  it("숫자 해석은 쉼표, 공백, %만 허용한다", () => {
    expect(parseNumber("1,500")).toBe(1500);
    expect(parseNumber(" 45 % ")).toBe(45);
    expect(parseNumber(12)).toBe(12);
    expect(parseNumber("약 30")).toBeNull();
    expect(parseNumber("3-4")).toBeNull();
  });

  it("CSV 따옴표 안의 쉼표와 줄바꿈을 처리하고 시작 줄 번호를 유지한다", () => {
    const rows = parseCsv('a,b\r\n"x,1","line1\nline2"\r\nz,w\r\n');
    expect(rows).toEqual([
      { line: 1, fields: ["a", "b"] },
      { line: 2, fields: ["x,1", "line1\nline2"] },
      { line: 4, fields: ["z", "w"] },
    ]);
  });

  it("UTF-8 BOM과 CP949를 모두 읽는다", async () => {
    const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode("부서")]);
    expect(decodeText(bom)).toBe("부서");
    const cp949 = await readFile(path.join(dir, "inbox", "2026-W45", "정보화담당관_주간보고_2026-W45.csv"));
    expect(decodeText(cp949)).toContain("정보화담당관");
  });

  it("부서명이 겹치면 더 긴 이름을 택한다", () => {
    const r: RosterEntry[] = [
      { code: "A", name: "안전과", required: true, contact: "" },
      { code: "B", name: "해양안전과", required: true, contact: "" },
    ];
    expect(matchDepartment("해양안전과_주간보고.xlsx", r)?.code).toBe("B");
  });

  it("명단 CSV의 제출대상 N은 제출 대상에서 뺀다", async () => {
    const p = path.join(dir, "roster-n.csv");
    await writeFile(p, "부서코드,부서명,제출대상,담당자\nX1,가부서,N,갑\nX2,나부서,,을\n");
    expect((await loadRoster(p)).map((e) => e.required)).toEqual([false, true]);
  });
});
