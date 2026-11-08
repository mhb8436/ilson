/**
 * 설치본에 넣은 OpenClaw 게이트웨이를 일손과 함께 띄우고 끈다.
 *
 * - 별도 Node 설치 없이 Electron 실행 파일을 Node로 쓴다(ELECTRON_RUN_AS_NODE=1).
 * - 127.0.0.1에만 열고, 실행마다 새 토큰을 만든다.
 * - 도구는 쓰지 않는다(tools.profile=minimal, gateway 도구 차단). 모델 호출만 한다.
 * - 외부 카탈로그 갱신, 메모리 플러그인, 자동 업데이트, Bonjour, 채널을 끈다.
 * - 사용자의 기존 ~/.openclaw와 섞이지 않게 상태 폴더를 일손 데이터 폴더 아래에 둔다.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { normalizeBaseUrl } from "./model-client.js";

export const ENGINE_PROVIDER_ID = "agency";

export interface EngineModelSettings {
  baseUrl: string;
  model: string;
  timeoutMs: number;
  hasApiKey: boolean;
}

/** OpenClaw 설정 파일 내용. API 키 값은 넣지 않고 환경변수 참조만 둔다. */
export function buildEngineConfig(model: EngineModelSettings, port: number): Record<string, unknown> {
  return {
    gateway: {
      mode: "local",
      bind: "loopback",
      port,
      auth: { mode: "token" },
      http: { endpoints: { chatCompletions: { enabled: true } } },
    },
    models: {
      mode: "replace",
      catalogRefresh: { enabled: false },
      providers: {
        [ENGINE_PROVIDER_ID]: {
          baseUrl: `${normalizeBaseUrl(model.baseUrl)}/v1`,
          // 기관망 주소에는 비밀이 아닌 표식 값을 허용한다. 키가 있으면 실행 시 환경변수로만 넘긴다.
          apiKey: model.hasApiKey ? "${ILSON_MODEL_API_KEY}" : "agency-local",
          api: "openai-completions",
          timeoutSeconds: Math.max(10, Math.round(model.timeoutMs / 1000)),
          models: [{ id: model.model, name: model.model, reasoning: false, input: ["text"] }],
        },
      },
    },
    agents: {
      defaults: {
        model: { primary: `${ENGINE_PROVIDER_ID}/${model.model}` },
        skipBootstrap: true,
      },
    },
    tools: { profile: "minimal", deny: ["gateway"] },
    plugins: { slots: { memory: "none" } },
  };
}

export type EngineState = "not_configured" | "starting" | "ready" | "error" | "stopped";

export interface EngineStatus {
  state: EngineState;
  version: string;
  port: number | null;
  pid: number | null;
  message: string | null;
  startedAt: string | null;
  logFile: string;
}

export interface EngineEndpoint {
  baseUrl: string;
  token: string;
}

export interface EngineManagerOptions {
  /** openclaw 패키지 폴더(node_modules/openclaw). */
  packageDir: string;
  version: string;
  /** 엔진 상태와 설정을 둘 폴더. */
  dataDir: string;
  /** Node로 쓸 실행 파일. 데스크톱에서는 Electron 실행 파일(process.execPath). */
  nodeExecPath: string;
  /** 실행 파일이 Electron이면 true(ELECTRON_RUN_AS_NODE=1을 붙인다). */
  electronAsNode: boolean;
  readyTimeoutMs?: number;
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(port));
    });
  });
}

/** 게이트웨이에 넘길 환경변수. 사용자 PC의 다른 설정(프록시, NODE_OPTIONS 등)이 끼어들지 않게 필요한 것만 고른다. */
function baseEnv(): Record<string, string> {
  const keep =
    process.platform === "win32"
      ? ["SystemRoot", "SystemDrive", "windir", "TEMP", "TMP", "USERPROFILE", "USERNAME", "APPDATA", "LOCALAPPDATA", "ProgramData", "ComSpec", "PATH", "Path", "PATHEXT", "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE"]
      : ["PATH", "TMPDIR", "USER", "LANG"];
  const env: Record<string, string> = {};
  for (const k of keep) if (process.env[k] !== undefined) env[k] = process.env[k]!;
  return env;
}

export class EngineManager {
  private child: ChildProcess | null = null;
  private token = "";
  private status: EngineStatus;
  private readonly stateDir: string;
  private readonly logFile: string;
  private starting: Promise<void> | null = null;

  constructor(private readonly opts: EngineManagerOptions) {
    this.stateDir = path.join(opts.dataDir, "state");
    this.logFile = path.join(opts.dataDir, "gateway.log");
    this.status = {
      state: "not_configured",
      version: opts.version,
      port: null,
      pid: null,
      message: null,
      startedAt: null,
      logFile: this.logFile,
    };
  }

  getStatus(): EngineStatus {
    return { ...this.status };
  }

  installed(): boolean {
    return existsSync(path.join(this.opts.packageDir, "openclaw.mjs"));
  }

  /** 준비된 게이트웨이 주소와 토큰. 준비되지 않았으면 기다렸다가 돌려준다. */
  async endpoint(): Promise<EngineEndpoint> {
    if (this.starting) await this.starting.catch(() => undefined);
    if (this.status.state !== "ready" || !this.status.port) {
      throw new Error(
        this.status.state === "not_configured"
          ? "실행 엔진이 시작되지 않았습니다. 설정 화면에서 기관 GPU 서버를 먼저 저장하십시오."
          : `실행 엔진이 준비되지 않았습니다${this.status.message ? `: ${this.status.message}` : "."}`,
      );
    }
    return { baseUrl: `http://127.0.0.1:${this.status.port}`, token: this.token };
  }

  /** 설정이 바뀌면 다시 시작한다. 모델 서버가 없으면 띄우지 않는다. */
  async restart(model: EngineModelSettings | null, apiKey?: string): Promise<EngineStatus> {
    await this.stop();
    if (!model) {
      this.status = { ...this.status, state: "not_configured", message: null, port: null, pid: null };
      return this.getStatus();
    }
    if (!this.installed()) {
      this.status = { ...this.status, state: "error", message: "실행 엔진 파일이 설치본에 없습니다." };
      return this.getStatus();
    }
    this.starting = this.start(model, apiKey);
    try {
      await this.starting;
    } catch {
      // 상태에 사유를 남겼다.
    } finally {
      this.starting = null;
    }
    return this.getStatus();
  }

  private async start(model: EngineModelSettings, apiKey?: string): Promise<void> {
    const port = await freePort();
    this.token = randomBytes(24).toString("hex");
    await mkdir(this.stateDir, { recursive: true });
    const configPath = path.join(this.stateDir, "openclaw.json");
    await writeFile(configPath, JSON.stringify(buildEngineConfig(model, port), null, 2) + "\n", "utf8");

    const env: Record<string, string> = {
      ...baseEnv(),
      HOME: this.opts.dataDir,
      OPENCLAW_HOME: this.opts.dataDir,
      OPENCLAW_STATE_DIR: this.stateDir,
      OPENCLAW_CONFIG_PATH: configPath,
      OPENCLAW_WORKSPACE_DIR: path.join(this.opts.dataDir, "workspace"),
      OPENCLAW_GATEWAY_TOKEN: this.token,
      OPENCLAW_OFFLINE: "1",
      OPENCLAW_NO_AUTO_UPDATE: "1",
      OPENCLAW_DISABLE_BONJOUR: "1",
      OPENCLAW_SKIP_CHANNELS: "1",
      OPENCLAW_CLAWHUB_URL: "http://127.0.0.1:9",
      CLAWHUB_DISABLE_TELEMETRY: "1",
      NODE_COMPILE_CACHE: path.join(this.opts.dataDir, "compile-cache"),
    };
    if (process.platform === "win32") env.USERPROFILE = env.USERPROFILE ?? this.opts.dataDir;
    if (apiKey) env.ILSON_MODEL_API_KEY = apiKey;
    if (this.opts.electronAsNode) env.ELECTRON_RUN_AS_NODE = "1";

    const log = createWriteStream(this.logFile, { flags: "a" });
    log.write(`\n=== ${new Date().toISOString()} 엔진 시작 (OpenClaw ${this.opts.version}, 127.0.0.1:${port}) ===\n`);
    const child = spawn(
      this.opts.nodeExecPath,
      [path.join(this.opts.packageDir, "openclaw.mjs"), "gateway", "run", "--bind", "loopback", "--port", String(port)],
      {
        cwd: this.opts.dataDir,
        env,
        windowsHide: true,
        // POSIX에서는 프로세스 그룹째 끌 수 있게 분리한다. Windows는 taskkill /T로 끈다.
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    child.stdout?.pipe(log, { end: false });
    child.stderr?.pipe(log, { end: false });
    this.child = child;
    this.status = {
      ...this.status,
      state: "starting",
      port,
      pid: child.pid ?? null,
      message: null,
      startedAt: new Date().toISOString(),
    };

    let exitInfo: string | null = null;
    child.once("exit", (code, signal) => {
      exitInfo = `엔진이 종료되었습니다(코드 ${code ?? "-"}${signal ? `, ${signal}` : ""}). 기록: ${this.logFile}`;
      if (this.child === child) {
        this.child = null;
        // 일손이 끈 경우(stopped)나 이미 사유를 남긴 경우(error)는 그대로 둔다.
        const expected = this.status.state === "stopped" || this.status.state === "error";
        this.status = expected
          ? { ...this.status, pid: null }
          : { ...this.status, state: "error", pid: null, message: exitInfo };
      }
      log.end();
    });

    const deadline = Date.now() + (this.opts.readyTimeoutMs ?? 120_000);
    while (Date.now() < deadline) {
      if (exitInfo) throw new Error(exitInfo);
      try {
        const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(2000) });
        if (res.ok) {
          this.status = { ...this.status, state: "ready", message: null };
          return;
        }
      } catch {
        // 아직 열리지 않음
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    this.status = { ...this.status, state: "error", message: `엔진이 제한 시간 안에 준비되지 않았습니다. 기록: ${this.logFile}` };
    await this.stop("error");
    throw new Error(this.status.message ?? "엔진 준비 실패");
  }

  /** 엔진과 그 하위 프로세스를 모두 끈다. */
  async stop(finalState: EngineState = "stopped"): Promise<void> {
    const child = this.child;
    if (!child || child.pid === undefined) {
      if (this.status.state !== "not_configured") this.status = { ...this.status, state: finalState, pid: null };
      return;
    }
    this.status = { ...this.status, state: finalState, pid: null };
    const exited = new Promise<void>((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) return resolve();
      child.once("exit", () => resolve());
    });
    try {
      if (process.platform === "win32") {
        spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
      } else {
        process.kill(-child.pid, "SIGTERM");
      }
    } catch {
      child.kill("SIGTERM");
    }
    const timer = setTimeout(() => {
      try {
        if (process.platform !== "win32") process.kill(-child.pid!, "SIGKILL");
        else child.kill("SIGKILL");
      } catch {
        // 이미 종료됨
      }
    }, 8000);
    await exited;
    clearTimeout(timer);
    this.child = null;
  }
}
