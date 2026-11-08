import { createHash } from "node:crypto";
import { appendFile, readFile } from "node:fs/promises";

/**
 * 업무대장. 한 줄에 한 사건을 덧붙이기만 하는 JSONL이고, 각 줄은 앞 줄의 해시를 품는다.
 * 중간 줄을 고치거나 지우면 verify()에서 드러난다.
 */
export type LedgerAction =
  | "job.created"
  | "draft.ai_rewritten"
  | "draft.edited"
  | "draft.confirmed"
  | "draft.rejected"
  | "settings.model_changed";

export interface LedgerEntry {
  seq: number;
  at: string;
  actor: string;
  action: LedgerAction;
  jobId: string | null;
  dept: string | null;
  /** 사건의 요약 정보. 문서 본문은 넣지 않고 해시만 남긴다. */
  detail: Record<string, string | number | boolean | null>;
  prevHash: string;
  hash: string;
}

export function sha256(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

const GENESIS = "0".repeat(64);

function entryHash(e: Omit<LedgerEntry, "hash">): string {
  return sha256(JSON.stringify([e.seq, e.at, e.actor, e.action, e.jobId, e.dept, e.detail, e.prevHash]));
}

export class Ledger {
  private tail: Promise<void> = Promise.resolve();

  constructor(
    private readonly file: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async list(): Promise<LedgerEntry[]> {
    let text: string;
    try {
      text = await readFile(this.file, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
    return text
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as LedgerEntry);
  }

  /** 동시에 여러 사건이 들어와도 순서와 해시 사슬이 꼬이지 않게 직렬로 쓴다. */
  append(entry: Pick<LedgerEntry, "actor" | "action" | "jobId" | "dept" | "detail">): Promise<LedgerEntry> {
    const run = this.tail.then(async () => {
      const all = await this.list();
      const last = all.at(-1);
      const base = {
        seq: (last?.seq ?? 0) + 1,
        at: this.now().toISOString(),
        ...entry,
        prevHash: last?.hash ?? GENESIS,
      };
      const full: LedgerEntry = { ...base, hash: entryHash(base) };
      await appendFile(this.file, JSON.stringify(full) + "\n", "utf8");
      return full;
    });
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async verify(): Promise<{ ok: boolean; count: number; brokenAt: number | null }> {
    const all = await this.list();
    let prev = GENESIS;
    for (const e of all) {
      const { hash, ...rest } = e;
      if (e.prevHash !== prev || entryHash(rest) !== hash) {
        return { ok: false, count: all.length, brokenAt: e.seq };
      }
      prev = hash;
    }
    return { ok: true, count: all.length, brokenAt: null };
  }
}
