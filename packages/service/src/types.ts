/**
 * 화면(렌더러)과 서비스(메인 프로세스) 사이의 계약. 화면은 이 파일의 타입만 가져다 쓴다.
 */
import type { CollateReport, SourceRef, TemplateConfig } from "@ilson/collate";

export type { CollateReport, Finding, FindingType, SourceRef, DeptSummary } from "@ilson/collate";

export interface ModelSettings {
  baseUrl: string;
  model: string;
  /** 화면에는 키 값을 돌려주지 않고 저장 여부만 알린다. */
  hasApiKey: boolean;
  timeoutMs: number;
}

export interface Settings {
  model: ModelSettings | null;
  /** 업무 맡기기 화면의 기본값. */
  defaults: {
    rosterPath: string | null;
    templatePath: string | null;
    inboxRoot: string | null;
  };
}

export interface CollateJobInput {
  rosterPath: string;
  /** 비우면 기본 양식(weekly-report-v1)을 쓴다. */
  templatePath: string | null;
  inboxDir: string;
  previousFile: string | null;
  week: string;
  previousWeek: string | null;
}

export interface InputFileRecord {
  role: "roster" | "template" | "inbox" | "previous";
  path: string;
  size: number;
  sha256: string;
}

export type JobStatus = "review" | "done";

export interface JobMeta {
  id: string;
  type: "weekly_collate";
  title: string;
  createdAt: string;
  actor: string;
  status: JobStatus;
  input: CollateJobInput;
  template: TemplateConfig;
  inputFiles: InputFileRecord[];
}

export type DraftStatus = "pending" | "confirmed" | "rejected";

export interface DraftRecord {
  dept: string;
  deptName: string;
  contact: string;
  /** 프로그램이 만든 기본 문안. */
  baseText: string;
  /** 모델이 다듬은 문안과 근거 표기 검사 결과. */
  ai: { text: string; model: string; at: string; check: { ok: boolean; missing: string[] } } | null;
  /** 담당자가 편집 중이거나 확정한 문안. */
  text: string;
  textCheck: { ok: boolean; missing: string[] };
  status: DraftStatus;
  decidedAt: string | null;
  decidedBy: string | null;
  rejectReason: string | null;
  findingIndexes: number[];
  /** 문안에 반드시 남아야 하는 근거 표기(파일명, 행, 과제ID). */
  mustMention: string[];
  /** 모델에 보낸 지시문. 사실 목록만 담고 첨부 문서 본문은 담지 않는다. */
  rewritePrompt: string;
}

export interface JobDetail {
  meta: JobMeta;
  report: CollateReport;
  drafts: DraftRecord[];
}

export interface JobListItem {
  id: string;
  title: string;
  week: string;
  createdAt: string;
  status: JobStatus;
  pendingDrafts: number;
  findingCount: number;
}

export interface PreviewResult {
  file: string;
  sheet: string | null;
  headers: string[];
  rows: { row: number; values: (string | number | null)[] }[];
  highlightRow: number | null;
  highlightColumn: string | null;
  error?: string;
}

export interface ReviewItem {
  jobId: string;
  jobTitle: string;
  week: string;
  dept: string;
  deptName: string;
  status: DraftStatus;
  itemCount: number;
}

export type PreviewRequest = { jobId: string; ref: SourceRef };
