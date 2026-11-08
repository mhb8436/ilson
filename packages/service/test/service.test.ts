import { appendFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { makeFixtures } from "../../../plugins/ilson-collate/scripts/make-fixtures.js";
import { IlsonService, isoWeek, normalizeBaseUrl, previousIsoWeek, stripReasoning } from "../src/index.js";

/** Ollama/vLLM의 OpenAI 호환 API를 흉내 내는 시험용 서버. */
interface FakeServer {
  url: string;
  reply: string;
  requests: { path: string; auth: string | undefined; body: unknown }[];
  close(): Promise<void>;
}

async function startFakeModelServer(): Promise<FakeServer> {
  const state = { reply: "", requests: [] as FakeServer["requests"] };
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c: Buffer) => (body += c.toString("utf8")));
    req.on("end", () => {
      state.requests.push({ path: req.url ?? "", auth: req.headers.authorization, body: body ? JSON.parse(body) : null });
      res.setHeader("content-type", "application/json");
      if (req.url === "/v1/models") {
        res.end(JSON.stringify({ object: "list", data: [{ id: "qwen3:4b" }, { id: "qwen3:32b" }] }));
      } else if (req.url === "/v1/chat/completions") {
        res.end(JSON.stringify({ model: "qwen3:4b", choices: [{ message: { role: "assistant", content: state.reply } }] }));
      } else {
        res.statusCode = 404;
        res.end("{}");
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    get reply() {
      return state.reply;
    },
    set reply(v: string) {
      state.reply = v;
    },
    requests: state.requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

const box = { encrypt: (s: string) => `sealed:${Buffer.from(s).toString("base64")}`, decrypt: (s: string) => Buffer.from(s.slice(7), "base64").toString() };

let fixtures: string;
let dataDir: string;
let model: FakeServer;
let svc: IlsonService;

function jobInput() {
  return {
    rosterPath: path.join(fixtures, "roster.csv"),
    templatePath: null,
    inboxDir: path.join(fixtures, "inbox", "2026-W45"),
    previousFile: path.join(fixtures, "confirmed", "2026-W44_주간보고_확정본.xlsx"),
    week: "2026-W45",
    previousWeek: "2026-W44",
  };
}

beforeAll(async () => {
  fixtures = await mkdtemp(path.join(os.tmpdir(), "ilson-svc-fx-"));
  await makeFixtures(fixtures);
  model = await startFakeModelServer();
});

afterAll(async () => {
  await model.close();
  await rm(fixtures, { recursive: true, force: true });
});

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), "ilson-svc-data-"));
  svc = new IlsonService({ dataDir, actor: "tester", secretBox: box });
  await svc.init();
  model.requests.length = 0;
});

describe("주간보고 취합 업무", () => {
  it("업무를 만들면 결과, 초안, 입력 파일 해시가 저장되고 업무대장에 남는다", async () => {
    const job = await svc.createCollateJob(jobInput());
    expect(job.report.findings).toHaveLength(15);
    expect(job.drafts.map((d) => d.dept)).toEqual(["D02", "D03", "D04", "D05", "D06"]);
    expect(job.meta.inputFiles.every((f) => /^[0-9a-f]{64}$/.test(f.sha256))).toBe(true);
    expect(job.meta.inputFiles.filter((f) => f.role === "inbox")).toHaveLength(6);
    const again = await svc.getJob(job.meta.id);
    expect(again).toEqual(job);
    const ledger = await svc.ledger.list();
    expect(ledger.map((e) => e.action)).toEqual(["job.created"]);
    expect(ledger[0]?.detail.findings).toBe(15);
  });

  it("모든 초안을 확정 또는 반려하면 업무가 완료된다", async () => {
    const job = await svc.createCollateJob(jobInput());
    for (const d of job.drafts.slice(1)) await svc.confirmDraft(job.meta.id, d.dept, d.text);
    expect((await svc.getJob(job.meta.id)).meta.status).toBe("review");
    const done = await svc.rejectDraft(job.meta.id, "D02", "전화로 처리");
    expect(done.meta.status).toBe("done");
    await expect(svc.confirmDraft(job.meta.id, "D02", "x")).rejects.toThrow("이미 확정 또는 반려");
    const items = await svc.listReviewItems();
    expect(items.filter((i) => i.status === "pending")).toHaveLength(0);
  });

  it("담당자가 근거 표기를 지운 문안은 검사에서 표시된다", async () => {
    const job = await svc.createCollateJob(jobInput());
    const updated = await svc.saveDraftText(job.meta.id, "D02", "담당자 칸을 채워 주세요.");
    const d02 = updated.drafts.find((d) => d.dept === "D02")!;
    expect(d02.textCheck.ok).toBe(false);
    expect(d02.textCheck.missing).toContain("P-0201");
  });

  it("원본 미리보기는 해당 행을 보여 주고, 업무에 쓰지 않은 파일은 열지 않는다", async () => {
    const job = await svc.createCollateJob(jobInput());
    const f = job.report.findings.find((x) => x.type === "required_empty")!;
    const p = await svc.preview(job.meta.id, f.ref);
    expect(p.error).toBeUndefined();
    expect(p.highlightRow).toBe(2);
    expect(p.headers).toContain("담당자");
    expect(p.rows.map((r) => r.row)).toEqual([2, 3, 4]);
    const removed = job.report.findings.find((x) => x.type === "row_removed")!;
    expect((await svc.preview(job.meta.id, removed.ref)).rows.some((r) => r.row === 12)).toBe(true);
    expect((await svc.preview(job.meta.id, { file: "../../secret.xlsx", sheet: null, row: 1 })).error).toBeTruthy();
    expect((await svc.preview(job.meta.id, { file: "other.xlsx", sheet: null, row: 1 })).error).toContain("이 업무에 쓴 파일이 아니어서");
  });
});

describe("기관 모델 서버 연결", () => {
  it("저장 전 주소로 연결을 시험하고 모델 목록을 받는다", async () => {
    const r = await svc.testModel({ baseUrl: `${model.url}/v1/`, model: "qwen3:4b", timeoutMs: 5000 });
    expect(r.ok).toBe(true);
    expect(r.models).toEqual(["qwen3:4b", "qwen3:32b"]);
    expect(r.modelFound).toBe(true);
  });

  it("연결이 거부되면 이해할 수 있는 오류를 돌려준다", async () => {
    // 열었다 닫은 포트를 써서 연결 거부를 만든다.
    const probe = http.createServer();
    await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
    const { port } = probe.address() as AddressInfo;
    await new Promise<void>((resolve) => probe.close(() => resolve()));
    const r = await svc.testModel({ baseUrl: `http://127.0.0.1:${port}`, model: "x", timeoutMs: 3000 });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("연결");
  });

  it("API 키는 암호화해 저장하고 화면에는 값 대신 저장 여부만 준다", async () => {
    const s = await svc.saveModelSettings({ baseUrl: model.url, model: "qwen3:4b", timeoutMs: 5000, apiKey: "k-123" });
    expect(s.model).toEqual({ baseUrl: model.url, model: "qwen3:4b", timeoutMs: 5000, hasApiKey: true });
    const raw = await readFile(path.join(dataDir, "settings.json"), "utf8");
    expect(raw).not.toContain("k-123");
    await svc.testModel();
    expect(model.requests.at(-1)?.auth).toBe("Bearer k-123");
    const kept = await svc.saveModelSettings({ baseUrl: model.url, model: "qwen3:32b", timeoutMs: 5000 });
    expect(kept.model?.hasApiKey).toBe(true);
    const cleared = await svc.saveModelSettings({ baseUrl: model.url, model: "qwen3:32b", timeoutMs: 5000, apiKey: "" });
    expect(cleared.model?.hasApiKey).toBe(false);
  });

  it("잘못된 주소 형식은 저장하지 않는다", async () => {
    await expect(svc.saveModelSettings({ baseUrl: "10.0.0.1:11434", model: "m", timeoutMs: 1 })).rejects.toThrow("형식");
    await expect(svc.saveModelSettings({ baseUrl: "ftp://x", model: "m", timeoutMs: 1 })).rejects.toThrow("http");
  });

  it("모델 문안이 근거 표기 검사를 통과하면 편집 문안에 반영한다", async () => {
    await svc.saveModelSettings({ baseUrl: model.url, model: "qwen3:4b", timeoutMs: 5000 });
    const job = await svc.createCollateJob(jobInput());
    const d02 = job.drafts.find((d) => d.dept === "D02")!;
    model.reply = `<think>생각</think>운영지원과 이영희 님, ${d02.mustMention.join(", ")} 관련 보완 부탁드립니다.`;
    const updated = await svc.aiRewrite(job.meta.id, "D02");
    const after = updated.drafts.find((d) => d.dept === "D02")!;
    expect(after.ai?.check.ok).toBe(true);
    expect(after.text).toBe(model.reply.replace("<think>생각</think>", ""));
    // 모델에는 사실 목록만 보낸다.
    const sent = model.requests.find((r) => r.path === "/v1/chat/completions")?.body as { messages: { content: string }[] };
    expect(sent.messages[1]?.content).toBe(d02.rewritePrompt);
    const last = (await svc.ledger.list()).at(-1);
    expect(last?.action).toBe("draft.ai_rewritten");
    expect(last?.detail.applied).toBe(true);
  });

  it("모델 문안에서 근거 표기가 빠지면 편집 문안을 바꾸지 않는다", async () => {
    await svc.saveModelSettings({ baseUrl: model.url, model: "qwen3:4b", timeoutMs: 5000 });
    const job = await svc.createCollateJob(jobInput());
    model.reply = "보완 부탁드립니다. 승인 완료 처리하였습니다.";
    const updated = await svc.aiRewrite(job.meta.id, "D02");
    const d02 = updated.drafts.find((d) => d.dept === "D02")!;
    expect(d02.ai?.check.ok).toBe(false);
    expect(d02.text).toBe(d02.baseText);
    expect(d02.status).toBe("pending");
  });

  it("모델 서버를 설정하지 않으면 다듬기를 거부한다", async () => {
    const job = await svc.createCollateJob(jobInput());
    await expect(svc.aiRewrite(job.meta.id, "D02")).rejects.toThrow("모델 서버가 설정되지 않았습니다");
  });
});

describe("업무대장 무결성", () => {
  it("기록을 고치면 검증에서 드러난다", async () => {
    const job = await svc.createCollateJob(jobInput());
    await svc.confirmDraft(job.meta.id, "D03", job.drafts.find((d) => d.dept === "D03")!.text);
    expect(await svc.ledger.verify()).toEqual({ ok: true, count: 2, brokenAt: null });
    const file = path.join(dataDir, "ledger.jsonl");
    const lines = (await readFile(file, "utf8")).trim().split("\n");
    await writeFile(file, lines[0]!.replace('"tester"', '"intruder"') + "\n" + lines[1] + "\n");
    expect((await svc.ledger.verify()).brokenAt).toBe(1);
  });

  it("동시에 들어온 기록도 순서와 사슬이 유지된다", async () => {
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        svc.ledger.append({ actor: "a", action: "draft.edited", jobId: "j", dept: String(i), detail: {} }),
      ),
    );
    const v = await svc.ledger.verify();
    expect(v).toEqual({ ok: true, count: 10, brokenAt: null });
    await appendFile(path.join(dataDir, "ledger.jsonl"), "");
  });
});

describe("보조 함수", () => {
  it("주차 계산", () => {
    expect(isoWeek(new Date(2026, 10, 5))).toBe("2026-W45");
    expect(isoWeek(new Date(2027, 0, 1))).toBe("2026-W53");
    expect(previousIsoWeek("2026-W45")).toBe("2026-W44");
    expect(previousIsoWeek("2027-W01")).toBe("2026-W53");
  });

  it("주소 정규화와 추론 블록 제거", () => {
    expect(normalizeBaseUrl(" http://gpu01:8000/v1/ ")).toBe("http://gpu01:8000");
    expect(stripReasoning("<think>a\nb</think>\n본문")).toBe("본문");
  });
});
