import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  buildRequestDrafts,
  buildRewritePrompt,
  collate,
  listInbox,
  loadRoster,
  loadTemplateConfig,
  readTable,
  TableReadError,
  type CollateReport,
  type SourceRef,
  type TemplateConfig,
} from "@ilson/collate";
import { Ledger, sha256 } from "./ledger.js";
import {
  describeError,
  ModelClient,
  normalizeBaseUrl,
  type ConnectionTestResult,
  type FetchLike,
} from "./model-client.js";
import { DEFAULT_WEEKLY_TEMPLATE } from "./templates.js";
import type {
  CollateJobInput,
  DraftRecord,
  InputFileRecord,
  JobDetail,
  JobListItem,
  JobMeta,
  PreviewResult,
  ReviewItem,
  Settings,
} from "./types.js";

/** API 키 같은 비밀값 보관. 데스크톱 앱에서는 Windows DPAPI(Electron safeStorage)를 쓴다. */
export interface SecretBox {
  encrypt(plain: string): string;
  decrypt(sealed: string): string;
}

export interface ServiceOptions {
  dataDir: string;
  actor: string;
  secretBox: SecretBox;
  fetchImpl?: FetchLike;
  now?: () => Date;
}

interface StoredSettings extends Omit<Settings, "model"> {
  model: (Omit<NonNullable<Settings["model"]>, "hasApiKey"> & { apiKeySealed: string | null }) | null;
}

const EMPTY_SETTINGS: StoredSettings = {
  model: null,
  defaults: { rosterPath: null, templatePath: null, inboxRoot: null },
};

function checkMentions(mustMention: string[], text: string): { ok: boolean; missing: string[] } {
  const normalized = text.normalize("NFC");
  const missing = [...new Set(mustMention)].filter((m) => !normalized.includes(m));
  return { ok: missing.length === 0, missing };
}

async function writeJson(file: string, data: unknown): Promise<void> {
  // 쓰는 도중 꺼져도 기존 파일이 깨지지 않게 임시 파일에 쓰고 바꿔 끼운다.
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2) + "\n", "utf8");
  await rename(tmp, file);
}

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, "utf8")) as T;
}

async function fileRecord(role: InputFileRecord["role"], p: string): Promise<InputFileRecord> {
  const buf = await readFile(p);
  return { role, path: p, size: buf.byteLength, sha256: sha256(buf) };
}

export class IlsonService {
  readonly ledger: Ledger;
  private readonly jobsDir: string;
  private readonly settingsFile: string;
  private readonly now: () => Date;

  constructor(private readonly opts: ServiceOptions) {
    this.jobsDir = path.join(opts.dataDir, "jobs");
    this.settingsFile = path.join(opts.dataDir, "settings.json");
    this.now = opts.now ?? (() => new Date());
    this.ledger = new Ledger(path.join(opts.dataDir, "ledger.jsonl"), this.now);
  }

  async init(): Promise<void> {
    await mkdir(this.jobsDir, { recursive: true });
  }

  // ---- 설정 ----

  private async loadStored(): Promise<StoredSettings> {
    try {
      return { ...EMPTY_SETTINGS, ...(await readJson<StoredSettings>(this.settingsFile)) };
    } catch {
      return structuredClone(EMPTY_SETTINGS);
    }
  }

  async getSettings(): Promise<Settings> {
    const s = await this.loadStored();
    return {
      defaults: s.defaults,
      model: s.model
        ? { baseUrl: s.model.baseUrl, model: s.model.model, timeoutMs: s.model.timeoutMs, hasApiKey: !!s.model.apiKeySealed }
        : null,
    };
  }

  /**
   * apiKey: undefined면 기존 키 유지, 빈 문자열이면 삭제, 값이 있으면 교체.
   */
  async saveModelSettings(input: { baseUrl: string; model: string; timeoutMs: number; apiKey?: string }): Promise<Settings> {
    const s = await this.loadStored();
    normalizeBaseUrl(input.baseUrl);
    if (!input.model.trim()) throw new Error("모델 이름을 입력하십시오.");
    const sealed =
      input.apiKey === undefined
        ? (s.model?.apiKeySealed ?? null)
        : input.apiKey === ""
          ? null
          : this.opts.secretBox.encrypt(input.apiKey);
    s.model = { baseUrl: input.baseUrl.trim(), model: input.model.trim(), timeoutMs: input.timeoutMs, apiKeySealed: sealed };
    await writeJson(this.settingsFile, s);
    await this.ledger.append({
      actor: this.opts.actor,
      action: "settings.model_changed",
      jobId: null,
      dept: null,
      detail: { baseUrl: s.model.baseUrl, model: s.model.model, hasApiKey: !!sealed },
    });
    return this.getSettings();
  }

  async saveDefaults(defaults: Settings["defaults"]): Promise<Settings> {
    const s = await this.loadStored();
    s.defaults = defaults;
    await writeJson(this.settingsFile, s);
    return this.getSettings();
  }

  private async modelClient(override?: { baseUrl: string; model: string; timeoutMs: number; apiKey?: string }): Promise<ModelClient> {
    if (override) {
      const s = await this.loadStored();
      const apiKey =
        override.apiKey !== undefined
          ? override.apiKey || undefined
          : s.model?.apiKeySealed
            ? this.opts.secretBox.decrypt(s.model.apiKeySealed)
            : undefined;
      return new ModelClient({ ...override, ...(apiKey ? { apiKey } : {}) }, this.opts.fetchImpl);
    }
    const s = await this.loadStored();
    if (!s.model) throw new Error("모델 서버가 설정되지 않았습니다. 설정 화면에서 기관 GPU 서버 주소를 입력하십시오.");
    const apiKey = s.model.apiKeySealed ? this.opts.secretBox.decrypt(s.model.apiKeySealed) : undefined;
    return new ModelClient(
      { baseUrl: s.model.baseUrl, model: s.model.model, timeoutMs: s.model.timeoutMs, ...(apiKey ? { apiKey } : {}) },
      this.opts.fetchImpl,
    );
  }

  /** 저장 전 값으로도 시험할 수 있게 override를 받는다. */
  async testModel(override?: { baseUrl: string; model: string; timeoutMs: number; apiKey?: string }): Promise<ConnectionTestResult> {
    try {
      return await (await this.modelClient(override)).testConnection();
    } catch (err) {
      return { ok: false, latencyMs: 0, models: [], modelFound: false, error: describeError(err) };
    }
  }

  // ---- 업무 ----

  private jobDir(id: string): string {
    if (!/^[A-Za-z0-9-]+$/.test(id)) throw new Error("잘못된 업무 번호입니다.");
    return path.join(this.jobsDir, id);
  }

  private async loadTemplate(templatePath: string | null): Promise<TemplateConfig> {
    return templatePath ? loadTemplateConfig(templatePath) : DEFAULT_WEEKLY_TEMPLATE;
  }

  async createCollateJob(input: CollateJobInput): Promise<JobDetail> {
    const template = await this.loadTemplate(input.templatePath);
    const roster = await loadRoster(input.rosterPath);
    const report = await collate({
      config: template,
      roster,
      week: input.week,
      inboxDir: input.inboxDir,
      ...(input.previousFile ? { previousFile: input.previousFile } : {}),
      ...(input.previousWeek ? { previousWeek: input.previousWeek } : {}),
    });

    // 어떤 파일로 이 결과를 냈는지 남긴다. 다음에 같은 파일인지 해시로 확인할 수 있다.
    const inputFiles: InputFileRecord[] = [await fileRecord("roster", input.rosterPath)];
    if (input.templatePath) inputFiles.push(await fileRecord("template", input.templatePath));
    for (const f of await listInbox(input.inboxDir)) inputFiles.push(await fileRecord("inbox", f));
    if (input.previousFile) inputFiles.push(await fileRecord("previous", input.previousFile));

    const createdAt = this.now().toISOString();
    const id = `${input.week}-${createdAt.replace(/[-:TZ.]/g, "").slice(0, 14)}-${randomUUID().slice(0, 8)}`;
    const meta: JobMeta = {
      id,
      type: "weekly_collate",
      title: `${input.week} 주간보고 취합`,
      createdAt,
      actor: this.opts.actor,
      status: "review",
      input,
      template,
      inputFiles,
    };
    const drafts: DraftRecord[] = buildRequestDrafts(report, roster).map((d) => {
      const mustMention = [...new Set(d.items.flatMap((it) => it.mustMention))];
      return {
        dept: d.dept,
        deptName: d.deptName,
        contact: d.contact,
        baseText: d.text,
        ai: null,
        text: d.text,
        textCheck: checkMentions(mustMention, d.text),
        status: "pending",
        decidedAt: null,
        decidedBy: null,
        rejectReason: null,
        findingIndexes: d.items.map((it) => report.findings.indexOf(it.finding)),
        mustMention,
        rewritePrompt: buildRewritePrompt(d),
      };
    });
    if (drafts.length === 0) meta.status = "done";

    const dir = this.jobDir(id);
    await mkdir(dir, { recursive: true });
    await writeJson(path.join(dir, "report.json"), report);
    await writeJson(path.join(dir, "drafts.json"), drafts);
    await writeJson(path.join(dir, "job.json"), meta);
    await this.ledger.append({
      actor: this.opts.actor,
      action: "job.created",
      jobId: id,
      dept: null,
      detail: {
        week: input.week,
        findings: report.findings.length,
        drafts: drafts.length,
        inputFiles: inputFiles.length,
        inputDigest: sha256(inputFiles.map((f) => `${f.role}:${f.sha256}`).join("\n")),
      },
    });
    return { meta, report, drafts };
  }

  async getJob(id: string): Promise<JobDetail> {
    const dir = this.jobDir(id);
    return {
      meta: await readJson<JobMeta>(path.join(dir, "job.json")),
      report: await readJson<CollateReport>(path.join(dir, "report.json")),
      drafts: await readJson<DraftRecord[]>(path.join(dir, "drafts.json")),
    };
  }

  async listJobs(): Promise<JobListItem[]> {
    const items: JobListItem[] = [];
    for (const name of await readdir(this.jobsDir).catch(() => [] as string[])) {
      try {
        const job = await this.getJob(name);
        items.push({
          id: job.meta.id,
          title: job.meta.title,
          week: job.meta.input.week,
          createdAt: job.meta.createdAt,
          status: job.meta.status,
          pendingDrafts: job.drafts.filter((d) => d.status === "pending").length,
          findingCount: job.report.findings.length,
        });
      } catch {
        // 쓰다 만 업무 폴더는 목록에서 뺀다.
      }
    }
    return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async listReviewItems(): Promise<ReviewItem[]> {
    const out: ReviewItem[] = [];
    for (const j of await this.listJobs()) {
      const job = await this.getJob(j.id);
      for (const d of job.drafts) {
        out.push({
          jobId: j.id,
          jobTitle: j.title,
          week: j.week,
          dept: d.dept,
          deptName: d.deptName,
          status: d.status,
          itemCount: d.findingIndexes.length,
        });
      }
    }
    return out;
  }

  private async updateDraft(
    jobId: string,
    dept: string,
    fn: (d: DraftRecord) => void,
  ): Promise<JobDetail> {
    const job = await this.getJob(jobId);
    const draft = job.drafts.find((d) => d.dept === dept);
    if (!draft) throw new Error(`보완 요청 초안이 없습니다: ${dept}`);
    fn(draft);
    job.meta.status = job.drafts.every((d) => d.status !== "pending") ? "done" : "review";
    const dir = this.jobDir(jobId);
    await writeJson(path.join(dir, "drafts.json"), job.drafts);
    await writeJson(path.join(dir, "job.json"), job.meta);
    return job;
  }

  private assertPending(d: DraftRecord): void {
    if (d.status !== "pending") throw new Error("이미 확정 또는 반려한 초안은 바꿀 수 없습니다.");
  }

  /** 기관 모델 서버로 문안을 다듬는다. 근거 표기 검사에 실패하면 편집 문안은 바꾸지 않는다. */
  async aiRewrite(jobId: string, dept: string): Promise<JobDetail> {
    const job = await this.getJob(jobId);
    const draft = job.drafts.find((d) => d.dept === dept);
    if (!draft) throw new Error(`보완 요청 초안이 없습니다: ${dept}`);
    this.assertPending(draft);
    const client = await this.modelClient();
    const result = await client.chat([
      {
        role: "system",
        content: "너는 공공기관 업무 담당자를 돕는 문서 작성 보조자다. 주어진 사실 목록만 사용하고 새로운 사실을 만들지 않는다.",
      },
      { role: "user", content: draft.rewritePrompt },
    ]);
    const check = checkMentions(draft.mustMention, result.text);
    const updated = await this.updateDraft(jobId, dept, (d) => {
      d.ai = { text: result.text, model: result.model, at: this.now().toISOString(), check };
      if (check.ok) {
        d.text = result.text;
        d.textCheck = check;
      }
    });
    await this.ledger.append({
      actor: this.opts.actor,
      action: "draft.ai_rewritten",
      jobId,
      dept,
      detail: {
        model: result.model,
        latencyMs: result.latencyMs,
        promptSha256: sha256(draft.rewritePrompt),
        outputSha256: sha256(result.text),
        checkOk: check.ok,
        applied: check.ok,
      },
    });
    return updated;
  }

  async saveDraftText(jobId: string, dept: string, text: string): Promise<JobDetail> {
    const updated = await this.updateDraft(jobId, dept, (d) => {
      this.assertPending(d);
      d.text = text;
      d.textCheck = checkMentions(d.mustMention, text);
    });
    await this.ledger.append({
      actor: this.opts.actor,
      action: "draft.edited",
      jobId,
      dept,
      detail: { textSha256: sha256(text) },
    });
    return updated;
  }

  /** 확정은 담당자만 한다. 확정 문안의 해시를 업무대장에 남긴다. */
  async confirmDraft(jobId: string, dept: string, text: string): Promise<JobDetail> {
    let source = "edited";
    const updated = await this.updateDraft(jobId, dept, (d) => {
      this.assertPending(d);
      source = text === d.baseText ? "base" : d.ai && text === d.ai.text ? "ai" : "edited";
      d.text = text;
      d.textCheck = checkMentions(d.mustMention, text);
      d.status = "confirmed";
      d.decidedAt = this.now().toISOString();
      d.decidedBy = this.opts.actor;
    });
    const d = updated.drafts.find((x) => x.dept === dept)!;
    await this.ledger.append({
      actor: this.opts.actor,
      action: "draft.confirmed",
      jobId,
      dept,
      detail: { textSha256: sha256(text), source, evidenceOk: d.textCheck.ok, missing: d.textCheck.missing.join(", ") },
    });
    return updated;
  }

  async rejectDraft(jobId: string, dept: string, reason: string): Promise<JobDetail> {
    const updated = await this.updateDraft(jobId, dept, (d) => {
      this.assertPending(d);
      d.status = "rejected";
      d.rejectReason = reason.trim() || null;
      d.decidedAt = this.now().toISOString();
      d.decidedBy = this.opts.actor;
    });
    await this.ledger.append({
      actor: this.opts.actor,
      action: "draft.rejected",
      jobId,
      dept,
      detail: { reason: reason.trim() },
    });
    return updated;
  }

  // ---- 원본 미리보기 ----

  /** 업무에 쓴 접수 파일과 지난주 확정본만 찾는다. 못 찾으면 사유 문자열. */
  private findInputFile(meta: JobMeta, fileName: string): InputFileRecord | string {
    if (fileName.includes("/") || fileName.includes("\\")) return "잘못된 파일 이름입니다.";
    const wanted = fileName.normalize("NFC");
    const hit = meta.inputFiles.find(
      (f) => (f.role === "inbox" || f.role === "previous") && path.basename(f.path).normalize("NFC") === wanted,
    );
    return hit ?? "이 업무에 쓴 파일이 아니어서 열 수 없습니다.";
  }

  /** 원본 파일을 엑셀 등 기본 프로그램으로 열 때 쓸 경로. */
  async resolveSourcePath(jobId: string, fileName: string): Promise<string> {
    const hit = this.findInputFile((await this.getJob(jobId)).meta, fileName);
    if (typeof hit === "string") throw new Error(hit);
    return hit.path;
  }

  /** 결과 항목이 가리키는 원본 행 주변을 보여 준다. 업무에 쓴 파일 외에는 열지 않는다. */
  async preview(jobId: string, ref: SourceRef, radius = 5): Promise<PreviewResult> {
    const job = await this.getJob(jobId);
    const empty: PreviewResult = {
      file: ref.file,
      sheet: ref.sheet,
      headers: [],
      rows: [],
      highlightRow: ref.row,
      highlightColumn: ref.column ?? null,
    };
    const hit = this.findInputFile(job.meta, ref.file);
    if (typeof hit === "string") return { ...empty, error: hit };
    try {
      const st = await stat(hit.path);
      if (st.size !== hit.size) {
        empty.error = "업무 실행 뒤 원본 파일이 바뀌었습니다. 아래 내용은 현재 파일 기준입니다.";
      }
      const table = await readTable(hit.path, job.meta.template.sheetName, job.meta.template.headerRow);
      const center = ref.row ?? table.rows[0]?.ref.row ?? 0;
      const rows = table.rows
        .filter((r) => ref.row === null || Math.abs((r.ref.row ?? 0) - center) <= radius)
        .slice(0, ref.row === null ? 20 : undefined)
        .map((r) => ({ row: r.ref.row ?? 0, values: table.headers.map((h) => r.values[h] ?? null) }));
      return { ...empty, sheet: table.sheet, headers: table.headers, rows };
    } catch (err) {
      const msg = err instanceof TableReadError || err instanceof Error ? err.message : String(err);
      return { ...empty, error: msg };
    }
  }
}
