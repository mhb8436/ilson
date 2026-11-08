import { useEffect, useState } from "react";
import type { JobListItem, Settings } from "@ilson/service";
import type { Navigate } from "../App";
import { api, errorText } from "../api";
import { formatTime, JOB_STATUS_LABEL } from "../labels";

export function HomeScreen({ navigate }: { navigate: Navigate }) {
  const [jobs, setJobs] = useState<JobListItem[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([api.listJobs(), api.getSettings()])
      .then(([j, s]) => {
        setJobs(j);
        setSettings(s);
      })
      .catch((e) => setError(errorText(e)));
  }, []);

  const pending = jobs.reduce((n, j) => n + j.pendingDrafts, 0);

  return (
    <div className="page">
      <h1>홈</h1>
      {error && <div className="alert error">{error}</div>}
      {settings && !settings.model && (
        <div className="alert warn">
          기관 GPU 서버가 아직 연결되지 않았습니다. 대조는 모델 없이도 되지만, 문안 다듬기를 쓰려면 연결이 필요합니다.{" "}
          <button className="link" onClick={() => navigate({ name: "settings" })}>
            설정으로 이동
          </button>
        </div>
      )}
      <div className="cards">
        <div className="card">
          <div className="card-label">검토 대기</div>
          <div className="card-value">{pending}건</div>
          <button onClick={() => navigate({ name: "review" })}>검토함 열기</button>
        </div>
        <div className="card">
          <div className="card-label">처리한 업무</div>
          <div className="card-value">{jobs.length}건</div>
          <button onClick={() => navigate({ name: "ledger" })}>업무대장 보기</button>
        </div>
        <div className="card">
          <div className="card-label">새 업무</div>
          <div className="card-value small">주간보고 취합</div>
          <button className="primary" onClick={() => navigate({ name: "new" })}>
            업무 맡기기
          </button>
        </div>
      </div>

      <h2>최근 업무</h2>
      {jobs.length === 0 ? (
        <p className="muted">아직 처리한 업무가 없습니다. [업무 맡기기]에서 샘플 자료로 시작해 볼 수 있습니다.</p>
      ) : (
        <table className="grid">
          <thead>
            <tr>
              <th>업무</th>
              <th>실행 시각</th>
              <th>결과</th>
              <th>검토 대기</th>
              <th>상태</th>
            </tr>
          </thead>
          <tbody>
            {jobs.slice(0, 10).map((j) => (
              <tr key={j.id} className="clickable" onClick={() => navigate({ name: "job", jobId: j.id })}>
                <td>{j.title}</td>
                <td>{formatTime(j.createdAt)}</td>
                <td>{j.findingCount}건</td>
                <td>{j.pendingDrafts}건</td>
                <td>{JOB_STATUS_LABEL[j.status]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
