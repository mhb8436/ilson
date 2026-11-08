import { useEffect, useState } from "react";
import type { LedgerEntry } from "@ilson/service";
import type { Navigate } from "../App";
import { api, errorText } from "../api";
import { formatTime, LEDGER_ACTION_LABEL } from "../labels";

function detailText(e: LedgerEntry): string {
  const d = e.detail;
  switch (e.action) {
    case "job.created":
      return `결과 ${d.findings}건, 초안 ${d.drafts}건, 입력 파일 ${d.inputFiles}개`;
    case "draft.ai_rewritten":
      return `${d.model}, ${d.applied ? "적용" : "근거 표기 누락으로 미적용"}`;
    case "draft.confirmed":
      return `문안 출처: ${d.source === "base" ? "기본 문안" : d.source === "ai" ? "AI 문안" : "담당자 수정"}${d.evidenceOk ? "" : `, 근거 표기 누락(${d.missing})`}`;
    case "draft.rejected":
      return d.reason ? `사유: ${d.reason}` : "";
    case "settings.model_changed":
      return `${d.baseUrl} / ${d.model}`;
    default:
      return "";
  }
}

export function LedgerScreen({ navigate }: { navigate: Navigate }) {
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [verify, setVerify] = useState<{ ok: boolean; count: number; brokenAt: number | null } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([api.listLedger(), api.verifyLedger()])
      .then(([l, v]) => {
        setEntries([...l].reverse());
        setVerify(v);
      })
      .catch((e) => setError(errorText(e)));
  }, []);

  return (
    <div className="page wide">
      <h1>업무대장</h1>
      {error && <div className="alert error">{error}</div>}
      {verify && (
        <div className={`alert ${verify.ok ? "info" : "error"}`}>
          {verify.ok
            ? `기록 ${verify.count}건, 변조 검사 통과(각 기록이 앞 기록의 해시를 이어받습니다).`
            : `기록 ${verify.brokenAt}번에서 변조 또는 손상이 발견되었습니다. 정보화 담당자에게 알리십시오.`}
        </div>
      )}
      <table className="grid">
        <thead>
          <tr>
            <th>번호</th>
            <th>시각</th>
            <th>처리자</th>
            <th>구분</th>
            <th>업무</th>
            <th>부서</th>
            <th>내용</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.seq}>
              <td>{e.seq}</td>
              <td className="nowrap">{formatTime(e.at)}</td>
              <td>{e.actor}</td>
              <td className="nowrap">{LEDGER_ACTION_LABEL[e.action]}</td>
              <td>
                {e.jobId ? (
                  <button className="link" onClick={() => navigate({ name: "job", jobId: e.jobId! })}>
                    {e.jobId.split("-").slice(0, 2).join("-")}
                  </button>
                ) : (
                  "-"
                )}
              </td>
              <td>{e.dept ?? "-"}</td>
              <td>{detailText(e)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
