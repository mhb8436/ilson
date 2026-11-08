import { useEffect, useState } from "react";
import type { PreviewResult, SourceRef } from "@ilson/service";
import { api, errorText } from "../api";

/** 결과 항목이 가리키는 원본 행을 강조해 보여 준다. */
export function SourcePreview({ jobId, sourceRef }: { jobId: string; sourceRef: SourceRef | null }) {
  const [data, setData] = useState<PreviewResult | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setData(null);
    setError("");
    if (!sourceRef) return;
    api
      .preview(jobId, sourceRef)
      .then(setData)
      .catch((e) => setError(errorText(e)));
  }, [jobId, sourceRef]);

  if (!sourceRef) return <div className="preview empty muted">결과 목록에서 항목을 고르면 원본이 여기에 표시됩니다.</div>;

  const openFile = () => api.openSource(jobId, sourceRef.file).catch((e) => setError(errorText(e)));
  const hlCol = data?.highlightColumn ? data.headers.indexOf(data.highlightColumn) : -1;

  return (
    <div className="preview">
      <div className="preview-head">
        <span>
          원본: <b>{sourceRef.file}</b>
          {data?.sheet ? ` / ${data.sheet} 시트` : ""}
          {sourceRef.row !== null ? ` / ${sourceRef.row}행` : ""}
          {sourceRef.column ? ` / ${sourceRef.column}` : ""}
        </span>
        <button onClick={openFile}>원본 파일 열기</button>
      </div>
      {(error || data?.error) && <div className="alert warn">{error || data?.error}</div>}
      {data && data.headers.length > 0 && (
        <div className="preview-scroll">
          <table className="grid sheet">
            <thead>
              <tr>
                <th className="rownum">행</th>
                {data.headers.map((h, i) => (
                  <th key={h} className={i === hlCol ? "hl-col" : ""}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => {
                const hlRow = r.row === data.highlightRow;
                return (
                  <tr key={r.row} className={hlRow ? "hl-row" : ""}>
                    <td className="rownum">{r.row}</td>
                    {r.values.map((v, i) => (
                      <td key={i} className={hlRow && i === hlCol ? "hl-cell" : ""}>
                        {v === null ? <span className="blank">(빈칸)</span> : String(v)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
