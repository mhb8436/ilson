import { useEffect, useState } from "react";
import type { Navigate } from "../App";
import { api, errorText } from "../api";

function currentIsoWeek(date = new Date()): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const start = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const w = Math.ceil(((d.getTime() - start.getTime()) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(w).padStart(2, "0")}`;
}

function prevWeek(week: string): string {
  const m = /^(\d{4})-W(\d{2})$/.exec(week);
  if (!m) return "";
  const year = Number(m[1]);
  const w = Number(m[2]);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - (jan4.getUTCDay() || 7) + 1 + (w - 1) * 7 - 7);
  return currentIsoWeek(new Date(monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate()));
}

interface Form {
  week: string;
  previousWeek: string;
  rosterPath: string;
  inboxDir: string;
  previousFile: string;
  templatePath: string;
}

const SHEETS = [{ name: "엑셀, CSV", extensions: ["xlsx", "csv"] }];

function joinPath(dir: string, ...parts: string[]): string {
  const sep = dir.includes("\\") ? "\\" : "/";
  return [dir.replace(/[\\/]+$/, ""), ...parts].join(sep);
}

export function NewJobScreen({ navigate }: { navigate: Navigate }) {
  const week = currentIsoWeek();
  const [form, setForm] = useState<Form>({
    week,
    previousWeek: prevWeek(week),
    rosterPath: "",
    inboxDir: "",
    previousFile: "",
    templatePath: "",
  });
  const [sampleDir, setSampleDir] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    void api.appInfo().then((i) => setSampleDir(i.sampleDir));
    void api.getSettings().then((s) =>
      setForm((f) => ({
        ...f,
        rosterPath: s.defaults.rosterPath ?? "",
        templatePath: s.defaults.templatePath ?? "",
      })),
    );
  }, []);

  const set = (k: keyof Form, v: string) =>
    setForm((f) => ({ ...f, [k]: v, ...(k === "week" ? { previousWeek: prevWeek(v) } : {}) }));

  const useSample = () => {
    if (!sampleDir) return;
    setForm({
      week: "2026-W45",
      previousWeek: "2026-W44",
      rosterPath: joinPath(sampleDir, "roster.csv"),
      inboxDir: joinPath(sampleDir, "inbox", "2026-W45"),
      previousFile: joinPath(sampleDir, "confirmed", "2026-W44_주간보고_확정본.xlsx"),
      templatePath: joinPath(sampleDir, "template.json"),
    });
  };

  const run = async () => {
    setError("");
    if (!/^\d{4}-W\d{2}$/.test(form.week)) return setError("주차는 2026-W45 형식으로 입력하십시오.");
    if (!form.rosterPath) return setError("제출 명단 파일을 선택하십시오.");
    if (!form.inboxDir) return setError("이번 주 접수 폴더를 선택하십시오.");
    setRunning(true);
    try {
      const job = await api.createCollateJob({
        week: form.week,
        previousWeek: form.previousFile ? form.previousWeek || null : null,
        rosterPath: form.rosterPath,
        inboxDir: form.inboxDir,
        previousFile: form.previousFile || null,
        templatePath: form.templatePath || null,
      });
      const s = await api.getSettings();
      await api.saveDefaults({
        ...s.defaults,
        rosterPath: form.rosterPath,
        templatePath: form.templatePath || null,
      });
      navigate({ name: "job", jobId: job.meta.id });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setRunning(false);
    }
  };

  const pick = async (k: keyof Form, title: string, folder = false, json = false) => {
    const p = folder
      ? await api.pickFolder({ title })
      : await api.pickFile({ title, filters: json ? [{ name: "양식 설정", extensions: ["json"] }] : SHEETS });
    if (p) set(k, p);
  };

  return (
    <div className="page narrow">
      <h1>업무 맡기기: 주간보고 취합</h1>
      <p className="muted">
        제출 명단과 이번 주 접수 폴더를 맞춰 보고, 지난주 확정본과 비교합니다. 대조는 프로그램이 하며 모델 서버가 없어도
        결과가 나옵니다.
      </p>
      {sampleDir && (
        <div className="alert info">
          처음이라면 샘플 자료(가상 부서 7곳)로 먼저 해 보십시오.{" "}
          <button className="link" onClick={useSample}>
            샘플 자료 채우기
          </button>
        </div>
      )}
      {error && <div className="alert error">{error}</div>}

      <div className="form">
        <label>
          <span>이번 주차</span>
          <input value={form.week} onChange={(e) => set("week", e.target.value)} placeholder="2026-W45" />
        </label>
        <label>
          <span>제출 명단</span>
          <div className="path-row">
            <input value={form.rosterPath} onChange={(e) => set("rosterPath", e.target.value)} placeholder="부서코드, 부서명, 제출대상, 담당자 열이 있는 CSV" />
            <button onClick={() => pick("rosterPath", "제출 명단 선택")}>찾아보기</button>
          </div>
        </label>
        <label>
          <span>이번 주 접수 폴더</span>
          <div className="path-row">
            <input value={form.inboxDir} onChange={(e) => set("inboxDir", e.target.value)} placeholder="예: \\파일서버\주간보고\2026-W45" />
            <button onClick={() => pick("inboxDir", "이번 주 접수 폴더 선택", true)}>찾아보기</button>
          </div>
        </label>
        <label>
          <span>지난주 확정본 (선택)</span>
          <div className="path-row">
            <input value={form.previousFile} onChange={(e) => set("previousFile", e.target.value)} placeholder="없으면 전주 비교를 하지 않습니다" />
            <button onClick={() => pick("previousFile", "지난주 확정본 선택")}>찾아보기</button>
          </div>
        </label>
        <label>
          <span>비교 주차</span>
          <input value={form.previousWeek} onChange={(e) => set("previousWeek", e.target.value)} />
        </label>
        <label>
          <span>양식 설정 (선택)</span>
          <div className="path-row">
            <input value={form.templatePath} onChange={(e) => set("templatePath", e.target.value)} placeholder="비우면 기본 주간보고 양식" />
            <button onClick={() => pick("templatePath", "양식 설정 선택", false, true)}>찾아보기</button>
          </div>
        </label>
      </div>
      <div className="actions">
        <button className="primary" disabled={running} onClick={run}>
          {running ? "대조 중..." : "대조 실행"}
        </button>
      </div>
    </div>
  );
}
