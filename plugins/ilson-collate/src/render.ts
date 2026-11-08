import type { CollateReport, DeptStatus, Finding, FindingType } from "./types.js";

const STATUS_LABEL: Record<DeptStatus, string> = {
  submitted: "제출",
  missing: "자료 확인 필요",
  unreadable: "판독 불가",
  not_required: "제출 대상 아님",
};

export const TYPE_LABEL: Record<FindingType, string> = {
  submission_missing: "자료 없음",
  multiple_files: "복수 파일",
  unknown_file: "명단 외 파일",
  unreadable_file: "판독 불가",
  sheet_missing: "시트 없음",
  header_missing: "열 누락",
  dept_mismatch: "부서 불일치",
  required_empty: "필수 항목 누락",
  invalid_number: "숫자 오류",
  duplicate_row: "중복 행",
  value_changed: "전주 대비 변경",
  row_added: "신규 과제",
  row_removed: "빠진 과제",
};

function cell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function loc(f: Finding): string {
  return [f.ref.file, f.ref.sheet, f.ref.row !== null ? `${f.ref.row}행` : null, f.ref.column]
    .filter(Boolean)
    .join(" / ");
}

/** 검토함에 붙일 Markdown 요약. */
export function renderMarkdown(report: CollateReport): string {
  const lines: string[] = [];
  lines.push(`# ${report.week} 주간보고 대조 결과`);
  lines.push("");
  lines.push(`양식: ${report.templateId} / 비교 기준: ${report.previousWeek ?? "없음"} 확정본`);
  lines.push("");
  lines.push("## 부서별 제출 현황");
  lines.push("");
  lines.push("| 부서 | 상태 | 파일 | 행 수 |");
  lines.push("| --- | --- | --- | --- |");
  for (const d of report.departments) {
    lines.push(`| ${cell(d.name)} | ${STATUS_LABEL[d.status]} | ${cell(d.files.join(", ") || "-")} | ${d.rowCount} |`);
  }
  const sections: [string, Finding["audience"]][] = [
    ["보완 요청 대상", "department"],
    ["담당자 확인 대상", "reviewer"],
  ];
  for (const [title, audience] of sections) {
    const items = report.findings.filter((f) => f.audience === audience);
    lines.push("");
    lines.push(`## ${title} (${items.length}건)`);
    lines.push("");
    if (items.length === 0) {
      lines.push("없음");
      continue;
    }
    lines.push("| 구분 | 위치 | 과제 | 내용 |");
    lines.push("| --- | --- | --- | --- |");
    for (const f of items) {
      lines.push(`| ${TYPE_LABEL[f.type]} | ${cell(loc(f))} | ${cell(f.key ?? "-")} | ${cell(f.message)} |`);
    }
  }
  return lines.join("\n") + "\n";
}
