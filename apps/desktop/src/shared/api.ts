/** preload가 화면에 열어 주는 기능 목록. 화면은 이 목록 밖의 일(파일 시스템, 네트워크)을 직접 하지 못한다. */
import type {
  CollateJobInput,
  ConnectionTestResult,
  EngineStatus,
  JobDetail,
  JobListItem,
  LedgerEntry,
  PreviewResult,
  ReviewItem,
  Settings,
  SourceRef,
} from "@ilson/service";

export interface ModelSettingsInput {
  baseUrl: string;
  model: string;
  timeoutMs: number;
  /** undefined: 기존 키 유지, "": 삭제 */
  apiKey?: string;
}

export interface AppInfo {
  version: string;
  dataDir: string;
  sampleDir: string | null;
  user: string;
  thirdPartyNotices: string;
}

export interface IlsonApi {
  appInfo(): Promise<AppInfo>;
  getSettings(): Promise<Settings>;
  saveModelSettings(input: ModelSettingsInput): Promise<Settings>;
  saveDefaults(defaults: Settings["defaults"]): Promise<Settings>;
  testModel(input?: ModelSettingsInput): Promise<ConnectionTestResult>;
  engineStatus(): Promise<EngineStatus>;
  restartEngine(): Promise<EngineStatus>;
  pickFile(opts: { title: string; filters: { name: string; extensions: string[] }[] }): Promise<string | null>;
  pickFolder(opts: { title: string }): Promise<string | null>;
  createCollateJob(input: CollateJobInput): Promise<JobDetail>;
  listJobs(): Promise<JobListItem[]>;
  getJob(id: string): Promise<JobDetail>;
  listReviewItems(): Promise<ReviewItem[]>;
  preview(jobId: string, ref: SourceRef): Promise<PreviewResult>;
  openSource(jobId: string, file: string): Promise<void>;
  aiRewrite(jobId: string, dept: string): Promise<JobDetail>;
  saveDraftText(jobId: string, dept: string, text: string): Promise<JobDetail>;
  confirmDraft(jobId: string, dept: string, text: string): Promise<JobDetail>;
  rejectDraft(jobId: string, dept: string, reason: string): Promise<JobDetail>;
  listLedger(): Promise<LedgerEntry[]>;
  verifyLedger(): Promise<{ ok: boolean; count: number; brokenAt: number | null }>;
  copyText(text: string): Promise<void>;
}

export const API_METHODS = [
  "appInfo",
  "getSettings",
  "saveModelSettings",
  "saveDefaults",
  "testModel",
  "engineStatus",
  "restartEngine",
  "pickFile",
  "pickFolder",
  "createCollateJob",
  "listJobs",
  "getJob",
  "listReviewItems",
  "preview",
  "openSource",
  "aiRewrite",
  "saveDraftText",
  "confirmDraft",
  "rejectDraft",
  "listLedger",
  "verifyLedger",
  "copyText",
] as const satisfies readonly (keyof IlsonApi)[];

/** IPC 응답 봉투. Electron은 메인 프로세스 예외 메시지를 영어 접두어로 감싸므로 직접 전달한다. */
export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: string };
