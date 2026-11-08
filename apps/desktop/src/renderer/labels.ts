import type { DeptSummary, DraftStatus, FindingType, JobStatus, LedgerAction } from "@ilson/service";

export const FINDING_LABEL: Record<FindingType, string> = {
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

export const DEPT_STATUS_LABEL: Record<DeptSummary["status"], string> = {
  submitted: "제출",
  missing: "자료 확인 필요",
  unreadable: "판독 불가",
  not_required: "제출 대상 아님",
};

export const DRAFT_STATUS_LABEL: Record<DraftStatus, string> = {
  pending: "검토 대기",
  confirmed: "확정",
  rejected: "반려",
};

export const JOB_STATUS_LABEL: Record<JobStatus, string> = {
  review: "검토 중",
  done: "완료",
};

export const LEDGER_ACTION_LABEL: Record<LedgerAction, string> = {
  "job.created": "업무 실행",
  "draft.ai_rewritten": "AI 다듬기",
  "draft.edited": "문안 수정",
  "draft.confirmed": "확정",
  "draft.rejected": "반려",
  "settings.model_changed": "모델 서버 설정",
};

export function formatTime(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
