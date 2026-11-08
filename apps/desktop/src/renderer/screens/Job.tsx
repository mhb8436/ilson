import { useEffect, useMemo, useState } from "react";
import type { Finding, JobDetail } from "@ilson/service";
import type { Navigate } from "../App";
import { api, errorText } from "../api";
import { DEPT_STATUS_LABEL, DRAFT_STATUS_LABEL, FINDING_LABEL, formatTime } from "../labels";
import { SourcePreview } from "./SourcePreview";

type Filter = "department" | "reviewer" | "all";

function location(f: Finding): string {
  return [f.ref.file, f.ref.sheet, f.ref.row !== null ? `${f.ref.row}행` : null, f.ref.column].filter(Boolean).join(" / ");
}

export function JobScreen({ jobId, navigate }: { jobId: string; navigate: Navigate }) {
  const [job, setJob] = useState<JobDetail | null>(null);
  const [filter, setFilter] = useState<Filter>("department");
  const [dept, setDept] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .getJob(jobId)
      .then(setJob)
      .catch((e) => setError(errorText(e)));
  }, [jobId]);

  const rows = useMemo(() => {
    if (!job) return [];
    return job.report.findings
      .map((f, i) => ({ f, i }))
      .filter(({ f }) => (filter === "all" || f.audience === filter) && (!dept || f.dept === dept));
  }, [job, filter, dept]);

  if (error) return <div className="page"><div className="alert error">{error}</div></div>;
  if (!job) return <div className="page muted">불러오는 중...</div>;

  const r = job.report;
  const count = (a: Filter) => r.findings.filter((f) => a === "all" || f.audience === a).length;
  const deptCount = (code: string) => r.findings.filter((f) => f.dept === code && f.audience === "department").length;
  const selectedFinding = selected !== null ? (r.findings[selected] ?? null) : null;

  return (
    <div className="page wide">
      <div className="page-head">
        <div>
          <h1>{job.meta.title}</h1>
          <div className="muted">
            실행 {formatTime(job.meta.createdAt)} / 실행자 {job.meta.actor} / 비교 기준 {r.previousWeek ?? "없음"} 확정본 / 양식 {r.templateId}
          </div>
        </div>
        <div className="actions">
          <button onClick={() => navigate({ name: "new" })}>다시 대조</button>
          <button className="primary" onClick={() => navigate({ name: "review", jobId })}>
            검토함에서 문안 확인
          </button>
        </div>
      </div>

      <div className="split">
        <section className="panel side">
          <h2>부서별 제출 현황</h2>
          <table className="grid">
            <thead>
              <tr>
                <th>부서</th>
                <th>상태</th>
                <th>보완</th>
              </tr>
            </thead>
            <tbody>
              <tr className={`clickable ${dept === null ? "selected" : ""}`} onClick={() => setDept(null)}>
                <td colSpan={3}>전체 부서</td>
              </tr>
              {r.departments.map((d) => (
                <tr key={d.code} className={`clickable ${dept === d.code ? "selected" : ""}`} onClick={() => setDept(d.code)}>
                  <td>{d.name}</td>
                  <td className={`status-${d.status}`}>{DEPT_STATUS_LABEL[d.status]}</td>
                  <td>{deptCount(d.code) || ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <h2>보완 요청 초안</h2>
          {job.drafts.length === 0 ? (
            <p className="muted">보완을 요청할 부서가 없습니다.</p>
          ) : (
            <ul className="plain">
              {job.drafts.map((d) => (
                <li key={d.dept}>
                  <button className="link" onClick={() => navigate({ name: "review", jobId, dept: d.dept })}>
                    {d.deptName}
                  </button>{" "}
                  <span className="muted">{DRAFT_STATUS_LABEL[d.status]}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel main">
          <div className="filters">
            {(
              [
                ["department", "보완 요청 대상"],
                ["reviewer", "담당자 확인 대상"],
                ["all", "전체"],
              ] as [Filter, string][]
            ).map(([k, label]) => (
              <button key={k} className={`chip ${filter === k ? "active" : ""}`} onClick={() => setFilter(k)}>
                {label} {count(k)}
              </button>
            ))}
          </div>
          <div className="findings-scroll">
            <table className="grid findings">
              <thead>
                <tr>
                  <th>구분</th>
                  <th>위치</th>
                  <th>과제</th>
                  <th>내용</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={4} className="muted">
                      해당하는 결과가 없습니다.
                    </td>
                  </tr>
                )}
                {rows.map(({ f, i }) => (
                  <tr key={i} className={`clickable ${selected === i ? "selected" : ""}`} onClick={() => setSelected(i)}>
                    <td className="nowrap">{FINDING_LABEL[f.type]}</td>
                    <td>{location(f)}</td>
                    <td className="nowrap">{f.key ?? "-"}</td>
                    <td>{f.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <SourcePreview jobId={jobId} sourceRef={selectedFinding?.ref ?? null} />
        </section>
      </div>
    </div>
  );
}
