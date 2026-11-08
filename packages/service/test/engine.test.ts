import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeFixtures } from "../../../plugins/ilson-collate/scripts/make-fixtures.js";
import { buildEngineConfig, EngineManager, IlsonService } from "../src/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(here, "../../../apps/desktop");
const enginePkg = path.join(desktopDir, "engine-runtime/node_modules/openclaw");

/** OpenAI 호환 모델 서버 흉내. 받은 요청을 기록한다. */
async function fakeServer(reply: (body: { model: string; messages: { content: unknown }[] }) => string) {
  const requests: { url: string; auth: string | undefined; body: { model: string; messages: { content: unknown }[]; stream?: boolean } | null }[] = [];
  const server = http.createServer((req, res) => {
    let b = "";
    req.on("data", (c: Buffer) => (b += c.toString("utf8")));
    req.on("end", () => {
      const body = b ? JSON.parse(b) : null;
      requests.push({ url: req.url ?? "", auth: req.headers.authorization, body });
      res.setHeader("content-type", "application/json");
      if (req.url?.endsWith("/models")) return res.end(JSON.stringify({ data: [{ id: "qwen3:4b" }] }));
      const text = reply(body);
      if (body?.stream) {
        res.setHeader("content-type", "text/event-stream");
        res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { role: "assistant", content: text }, finish_reason: null }] })}\n\n`);
        res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })}\n\n`);
        res.write("data: [DONE]\n\n");
        return res.end();
      }
      res.end(JSON.stringify({ model: body?.model, choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }] }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    requests,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

const box = { encrypt: (s: string) => `x${s}`, decrypt: (s: string) => s.slice(1) };

describe("실행 엔진 설정", () => {
  it("127.0.0.1 전용, 토큰 인증, 외부 카탈로그 차단, 도구 없음으로 만든다", () => {
    const cfg = buildEngineConfig({ baseUrl: "http://10.10.1.20:11434/v1/", model: "qwen3:4b", timeoutMs: 120_000, hasApiKey: false }, 40123) as {
      gateway: { bind: string; port: number; auth: { mode: string } };
      models: { mode: string; catalogRefresh: { enabled: boolean }; providers: Record<string, { baseUrl: string; apiKey: string; timeoutSeconds: number }> };
      agents: { defaults: { model: { primary: string }; skipBootstrap: boolean } };
      tools: { profile: string; deny: string[] };
      plugins: { slots: { memory: string } };
    };
    expect(cfg.gateway.bind).toBe("loopback");
    expect(cfg.gateway.port).toBe(40123);
    expect(cfg.gateway.auth.mode).toBe("token");
    expect(cfg.models.mode).toBe("replace");
    expect(cfg.models.catalogRefresh.enabled).toBe(false);
    expect(cfg.models.providers.agency?.baseUrl).toBe("http://10.10.1.20:11434/v1");
    expect(cfg.models.providers.agency?.timeoutSeconds).toBe(120);
    expect(cfg.agents.defaults.model.primary).toBe("agency/qwen3:4b");
    expect(cfg.agents.defaults.skipBootstrap).toBe(true);
    expect(cfg.tools).toEqual({ profile: "minimal", deny: ["gateway"] });
    expect(cfg.plugins.slots.memory).toBe("none");
  });

  it("API 키 값은 설정 파일에 쓰지 않고 환경변수 참조만 둔다", () => {
    const cfg = buildEngineConfig({ baseUrl: "http://gpu01:8000", model: "m", timeoutMs: 60_000, hasApiKey: true }, 1);
    expect(JSON.stringify(cfg)).toContain("${ILSON_MODEL_API_KEY}");
  });
});

describe("AI 다듬기 경로", () => {
  let fixtures: string;
  beforeAll(async () => {
    fixtures = await mkdtemp(path.join(os.tmpdir(), "ilson-eng-fx-"));
    await makeFixtures(fixtures);
  });
  afterAll(() => rm(fixtures, { recursive: true, force: true }));

  it("실행 엔진이 있으면 엔진(openclaw/default)으로 보내고 업무대장에 경로를 남긴다", async () => {
    const gw = await fakeServer((b) => {
      const prompt = String(b.messages.at(-1)?.content ?? "");
      return prompt.split("\n").filter((l) => /^\d+\. /.test(l)).join("\n") + "\n" + prompt.match(/수신: (.+)/)?.[1];
    });
    const dataDir = await mkdtemp(path.join(os.tmpdir(), "ilson-eng-data-"));
    const svc = new IlsonService({
      dataDir,
      actor: "tester",
      secretBox: box,
      engine: { version: "2026.11.1", endpoint: async () => ({ baseUrl: gw.url, token: "gw-token" }) },
    });
    await svc.init();
    await svc.saveModelSettings({ baseUrl: "http://10.10.1.20:11434", model: "qwen3:4b", timeoutMs: 30_000 });
    const job = await svc.createCollateJob({
      rosterPath: path.join(fixtures, "roster.csv"),
      templatePath: null,
      inboxDir: path.join(fixtures, "inbox", "2026-W45"),
      previousFile: path.join(fixtures, "confirmed", "2026-W44_주간보고_확정본.xlsx"),
      week: "2026-W45",
      previousWeek: "2026-W44",
    });
    const updated = await svc.aiRewrite(job.meta.id, "D02");
    const d02 = updated.drafts.find((d) => d.dept === "D02")!;
    expect(d02.ai?.check.ok).toBe(true);
    expect(d02.ai?.model).toBe("qwen3:4b");
    const req = gw.requests.find((r) => r.url === "/v1/chat/completions")!;
    expect(req.body?.model).toBe("openclaw/default");
    expect(req.auth).toBe("Bearer gw-token");
    const last = (await svc.ledger.list()).at(-1)!;
    expect(last.detail.route).toBe("openclaw 2026.11.1");
    await gw.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  it("엔진이 준비되지 않았으면 이유를 알려 주고 기관 서버로 우회하지 않는다", async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), "ilson-eng-data-"));
    const svc = new IlsonService({
      dataDir,
      actor: "tester",
      secretBox: box,
      engine: {
        version: "2026.11.1",
        endpoint: async () => {
          throw new Error("실행 엔진이 준비되지 않았습니다.");
        },
      },
    });
    await svc.init();
    await svc.saveModelSettings({ baseUrl: "http://127.0.0.1:9", model: "qwen3:4b", timeoutMs: 30_000 });
    const job = await svc.createCollateJob({
      rosterPath: path.join(fixtures, "roster.csv"),
      templatePath: null,
      inboxDir: path.join(fixtures, "inbox", "2026-W45"),
      previousFile: null,
      week: "2026-W45",
      previousWeek: null,
    });
    await expect(svc.aiRewrite(job.meta.id, "D02")).rejects.toThrow("실행 엔진이 준비되지 않았습니다");
    await rm(dataDir, { recursive: true, force: true });
  });
});

/**
 * 설치본에 넣는 실제 OpenClaw를 Electron 실행 파일로 띄워 본다.
 * apps/desktop/engine-runtime에 엔진을 설치했을 때만 돈다(pnpm --filter @ilson/desktop engine:install).
 */
function electronPath(): string | null {
  try {
    const p = createRequire(path.join(desktopDir, "package.json"))("electron") as unknown as string;
    return existsSync(p) ? p : null;
  } catch {
    return null;
  }
}
const canRunEngine = existsSync(path.join(enginePkg, "openclaw.mjs")) && electronPath() !== null && process.platform !== "win32";

describe.skipIf(!canRunEngine)("내장 OpenClaw 실제 실행", () => {
  it(
    "엔진을 띄워 기관 모델 서버까지 호출하고, 끄면 프로세스가 남지 않는다",
    async () => {
      const agency = await fakeServer(() => "엔진을 거친 문안");
      const dataDir = await mkdtemp(path.join(os.tmpdir(), "ilson-engine-"));
      const version = JSON.parse(await readFile(path.join(enginePkg, "package.json"), "utf8")).version as string;
      const mgr = new EngineManager({
        packageDir: enginePkg,
        version,
        dataDir,
        nodeExecPath: electronPath()!,
        electronAsNode: true,
        readyTimeoutMs: 150_000,
      });
      const status = await mgr.restart({ baseUrl: agency.url, model: "qwen3:4b", timeoutMs: 60_000, hasApiKey: false });
      expect(status.message).toBeNull();
      expect(status.state).toBe("ready");
      const ep = await mgr.endpoint();
      expect(ep.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);

      // 토큰 없이는 거부한다.
      const denied = await fetch(`${ep.baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "openclaw/default", messages: [{ role: "user", content: "x" }] }),
      });
      expect(denied.status).toBe(401);

      const res = await fetch(`${ep.baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${ep.token}` },
        body: JSON.stringify({ model: "openclaw/default", messages: [{ role: "user", content: "보완 요청 문안을 다듬어라." }] }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { choices: { message: { content: string } }[] };
      expect(body.choices[0]?.message.content).toBe("엔진을 거친 문안");
      // 엔진은 설정한 기관 모델 이름으로 모델 서버를 부른다.
      expect(agency.requests.some((r) => r.url === "/v1/chat/completions" && r.body?.model === "qwen3:4b")).toBe(true);

      const pid = status.pid!;
      await mgr.stop();
      expect(mgr.getStatus().state).toBe("stopped");
      expect(() => process.kill(pid, 0)).toThrow();
      await agency.close();
      await rm(dataDir, { recursive: true, force: true });
    },
    240_000,
  );
});
