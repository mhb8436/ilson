import type { CollateReport, Finding, RosterEntry } from "./types.js";

/** 부서에 보낼 보완 요청 초안. 사실 항목은 프로그램이 만들고, 문장 다듬기만 모델에 맡긴다. */
export interface RequestDraft {
  dept: string;
  deptName: string;
  contact: string;
  items: RequestItem[];
  /** 모델 없이 만든 기본 문안. 모델 문안이 검증에 실패하면 이 문안을 쓴다. */
  text: string;
}

export interface RequestItem {
  finding: Finding;
  /** 모델이 다시 쓴 문안에도 반드시 남아 있어야 하는 표기(파일명, 행, 과제ID). */
  mustMention: string[];
  line: string;
}

function itemFor(f: Finding): RequestItem {
  const where = [f.ref.sheet ? `${f.ref.sheet} 시트` : null, f.ref.row !== null ? `${f.ref.row}행` : null]
    .filter(Boolean)
    .join(" ");
  const loc = where ? `${f.ref.file} ${where}` : f.ref.file;
  const mustMention = [f.ref.file];
  if (f.ref.row !== null) mustMention.push(`${f.ref.row}행`);
  if (f.key) mustMention.push(f.key);
  let line: string;
  switch (f.type) {
    case "submission_missing":
      return {
        finding: f,
        mustMention: [],
        line: "지정 폴더에서 이번 주 주간보고를 찾지 못했습니다. 다른 경로로 제출하셨다면 알려 주시고, 아직이면 제출 부탁드립니다.",
      };
    case "required_empty":
      line = `${loc}${f.key ? ` (${f.key})` : ""}: '${f.ref.column}' 항목이 비어 있습니다.`;
      break;
    case "invalid_number":
      line = `${loc}${f.key ? ` (${f.key})` : ""}: '${f.ref.column}' 값 '${f.after}'을(를) 숫자로 적어 주십시오.`;
      break;
    case "duplicate_row":
      line = `${loc}: 과제 ${f.key}이(가) ${f.relatedRef?.row}행과 중복 입력되었습니다${f.exactDuplicate ? "" : ". 두 행의 값이 달라 어느 쪽이 맞는지 확인이 필요합니다"}.`;
      break;
    case "dept_mismatch":
      line = `${loc}${f.key ? ` (${f.key})` : ""}: 부서 값이 '${f.after}'(으)로 되어 있습니다. 귀 부서 과제가 맞는지 확인 부탁드립니다.`;
      break;
    case "sheet_missing":
    case "header_missing":
    case "unreadable_file":
      line = `${f.ref.file}: 지정 양식으로 읽을 수 없습니다. ${f.message.replace(/^[^:]+:\s*/, "")}`;
      break;
    default:
      line = f.message;
  }
  return { finding: f, mustMention, line };
}

export function buildRequestDrafts(report: CollateReport, roster: RosterEntry[]): RequestDraft[] {
  const drafts: RequestDraft[] = [];
  for (const dept of roster) {
    const findings = report.findings.filter((f) => f.dept === dept.code && f.audience === "department");
    if (findings.length === 0) continue;
    const items = findings.map(itemFor);
    const text = [
      `${dept.name} ${dept.contact ? `${dept.contact} 님` : "담당자님"}께`,
      "",
      `${report.week} 주간보고 취합 중 아래 사항의 확인과 보완을 부탁드립니다.`,
      "",
      ...items.map((it, i) => `${i + 1}. ${it.line}`),
      "",
      "확인 후 같은 폴더에 수정본을 올려 주시면 다시 취합하겠습니다.",
    ].join("\n");
    drafts.push({ dept: dept.code, deptName: dept.name, contact: dept.contact, items, text });
  }
  return drafts;
}

/**
 * 소형 모델에 문장 다듬기만 맡기는 프롬프트. 사실은 목록으로만 주고,
 * 첨부 문서 내용은 넣지 않는다(문서 속 지시문이 초안에 섞이는 것을 막기 위함).
 */
export function buildRewritePrompt(draft: RequestDraft): string {
  return [
    "다음 보완 요청 항목을 공문 메모 어조로 정중하게 다듬어라.",
    "규칙: 항목을 추가하거나 빼지 않는다. 파일명, 행 번호, 과제ID는 그대로 적는다. 승인, 확정, 발송 여부는 언급하지 않는다.",
    "",
    `수신: ${draft.deptName}`,
    ...draft.items.map((it, i) => `${i + 1}. ${it.line}`),
  ].join("\n");
}

export interface RewriteCheck {
  ok: boolean;
  missing: string[];
}

/** 모델이 다시 쓴 문안에서 근거 표기가 빠졌는지 검사한다. 실패하면 기본 문안을 쓴다. */
export function checkRewrite(draft: RequestDraft, rewritten: string): RewriteCheck {
  const text = rewritten.normalize("NFC");
  const missing = [...new Set(draft.items.flatMap((it) => it.mustMention))].filter((m) => !text.includes(m));
  return { ok: missing.length === 0, missing };
}
