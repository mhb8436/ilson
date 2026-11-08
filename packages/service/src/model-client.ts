/**
 * 기관 GPU 서버의 모델 연결. Ollama와 vLLM 모두 OpenAI 호환 API(/v1/models, /v1/chat/completions)를 제공하므로
 * 그 하나만 쓴다. 외부 LLM으로 대체 호출하는 경로는 두지 않는다.
 */
export interface ModelServerConfig {
  /** 예: http://10.10.1.20:11434 (Ollama), http://gpu01.agency.local:8000 (vLLM). /v1은 붙여도 되고 안 붙여도 된다. */
  baseUrl: string;
  model: string;
  /** vLLM에 --api-key를 건 경우만. */
  apiKey?: string;
  timeoutMs?: number;
}

export interface ConnectionTestResult {
  ok: boolean;
  latencyMs: number;
  models: string[];
  modelFound: boolean;
  error?: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatResult {
  text: string;
  model: string;
  latencyMs: number;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error(`모델 서버 주소 형식이 올바르지 않습니다: ${raw}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("모델 서버 주소는 http:// 또는 https://로 시작해야 합니다.");
  }
  if (url.username || url.password) {
    throw new Error("주소에 계정 정보를 넣지 마십시오. API 키 칸을 사용하십시오.");
  }
  return trimmed.replace(/\/v1$/, "");
}

/** Qwen3 등 추론형 모델이 내보내는 <think> 블록은 문안에서 뺀다. */
export function stripReasoning(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

export class ModelClient {
  private readonly base: string;

  constructor(
    private readonly config: ModelServerConfig,
    private readonly fetchImpl: FetchLike = fetch,
  ) {
    this.base = normalizeBaseUrl(config.baseUrl);
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { "content-type": "application/json" };
    if (this.config.apiKey) h.authorization = `Bearer ${this.config.apiKey}`;
    return h;
  }

  private async request(path: string, init: RequestInit): Promise<unknown> {
    const res = await this.fetchImpl(`${this.base}${path}`, {
      ...init,
      headers: this.headers(),
      signal: AbortSignal.timeout(this.config.timeoutMs ?? 120_000),
    });
    const body = await res.text();
    if (!res.ok) {
      throw new Error(`모델 서버 응답 오류 ${res.status}: ${body.slice(0, 300)}`);
    }
    try {
      return JSON.parse(body) as unknown;
    } catch {
      throw new Error("모델 서버 응답을 해석할 수 없습니다(JSON 아님).");
    }
  }

  async testConnection(): Promise<ConnectionTestResult> {
    const started = Date.now();
    try {
      const data = (await this.request("/v1/models", { method: "GET" })) as { data?: { id?: string }[] };
      const models = (data.data ?? []).map((m) => m.id ?? "").filter(Boolean);
      return {
        ok: true,
        latencyMs: Date.now() - started,
        models,
        modelFound: models.includes(this.config.model),
      };
    } catch (err) {
      return {
        ok: false,
        latencyMs: Date.now() - started,
        models: [],
        modelFound: false,
        error: describeError(err),
      };
    }
  }

  async chat(messages: ChatMessage[], opts: { temperature?: number; maxTokens?: number } = {}): Promise<ChatResult> {
    const started = Date.now();
    const data = (await this.request("/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({
        model: this.config.model,
        messages,
        temperature: opts.temperature ?? 0.2,
        max_tokens: opts.maxTokens ?? 1024,
        stream: false,
      }),
    })) as { model?: string; choices?: { message?: { content?: string } }[] };
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new Error("모델 서버 응답에 문안이 없습니다.");
    return { text: stripReasoning(content), model: data.model ?? this.config.model, latencyMs: Date.now() - started };
  }
}

export function describeError(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === "TimeoutError") return "모델 서버 응답 시간이 초과되었습니다.";
    const cause = (err as Error & { cause?: { code?: string } }).cause;
    if (cause?.code === "ECONNREFUSED") return "모델 서버에 연결할 수 없습니다(연결 거부). 주소와 포트를 확인하십시오.";
    if (cause?.code === "ENOTFOUND") return "모델 서버 주소를 찾을 수 없습니다. 주소를 확인하십시오.";
    if (cause?.code === "ETIMEDOUT" || cause?.code === "UND_ERR_CONNECT_TIMEOUT") {
      return "모델 서버 연결 시간이 초과되었습니다. 방화벽과 주소를 확인하십시오.";
    }
    return err.message;
  }
  return String(err);
}
