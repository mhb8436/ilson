import { useCallback, useEffect, useState } from "react";
import type { DraftRecord, JobDetail, ReviewItem } from "@ilson/service";
import type { Navigate } from "../App";
import { api, errorText } from "../api";
import { DRAFT_STATUS_LABEL, FINDING_LABEL, formatTime } from "../labels";
import { SourcePreview } from "./SourcePreview";

interface Selection {
  jobId: string;
  dept: string;
}

export function ReviewScreen({
  navigate,
  initial,
  onChanged,
}: {
  navigate: Navigate;
  initial: Selection | null;
  onChanged: () => void;
}) {
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [sel, setSel] = useState<Selection | null>(initial);
  const [job, setJob] = useState<JobDetail | null>(null);
  const [text, setText] = useState("");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [evidence, setEvidence] = useState<number | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");

  const loadItems = useCallback(async () => {
    const list = await api.listReviewItems();
    setItems(list);
    return list;
  }, []);

  useEffect(() => {
    void loadItems().then((list) => {
      if (!initial) {
        const first = list.find((i) => i.status === "pending");
        if (first) setSel({ jobId: first.jobId, dept: first.dept });
      }
    });
  }, [loadItems, initial]);

  useEffect(() => {
    setError("");
    setNotice("");
    setEvidence(null);
    setRejecting(false);
    setReason("");
    if (!sel) return setJob(null);
    api
      .getJob(sel.jobId)
      .then((j) => {
        setJob(j);
        setText(j.drafts.find((d) => d.dept === sel.dept)?.text ?? "");
        setDirty(false);
      })
      .catch((e) => setError(errorText(e)));
  }, [sel]);

  const draft: DraftRecord | undefined = job?.drafts.find((d) => d.dept === sel?.dept);

  const act = async (label: string, fn: () => Promise<JobDetail>, message: string) => {
    setBusy(label);
    setError("");
    setNotice("");
    try {
      const j = await fn();
      setJob(j);
      setText(j.drafts.find((d) => d.dept === sel?.dept)?.text ?? "");
      setDirty(false);
      setNotice(message);
      await loadItems();
      onChanged();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy("");
    }
  };

  const visible = items.filter((i) => showDone || i.status === "pending");
  const pending = draft?.status === "pending";
  const missing = draft
    ? draft.mustMention.filter((m) => !text.normalize("NFC").includes(m))
    : [];

  return (
    <div className="page wide">
      <h1>검토함</h1>
      <div className="split">
        <section className="panel side">
          <label className="inline">
            <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> 확정, 반려 건도 보기
          </label>
          {visible.length === 0 ? (
            <p className="muted">검토할 문안이 없습니다.</p>
          ) : (
            <table className="grid">
              <thead>
                <tr>
                  <th>업무</th>
                  <th>부서</th>
                  <th>상태</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((i) => (
                  <tr
                    key={`${i.jobId}:${i.dept}`}
                    className={`clickable ${sel?.jobId === i.jobId && sel.dept === i.dept ? "selected" : ""}`}
                    onClick={() => setSel({ jobId: i.jobId, dept: i.dept })}
                  >
                    <td>{i.week}</td>
                    <td>
                      {i.deptName} <span className="muted">({i.itemCount})</span>
                    </td>
                    <td>{DRAFT_STATUS_LABEL[i.status]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="panel main">
          {error && <div className="alert error">{error}</div>}
          {notice && <div className="alert info">{notice}</div>}
          {!draft || !job ? (
            <p className="muted">왼쪽에서 문안을 고르십시오.</p>
          ) : (
            <>
              <div className="page-head">
                <div>
                  <h2>
                    {draft.deptName} 보완 요청 <span className="muted">({job.meta.input.week})</span>
                  </h2>
                  <div className="muted">
                    상태: {DRAFT_STATUS_LABEL[draft.status]}
                    {draft.decidedAt ? ` / ${formatTime(draft.decidedAt)} ${draft.decidedBy}` : ""}
                    {draft.rejectReason ? ` / 반려 사유: ${draft.rejectReason}` : ""}
                  </div>
                </div>
                <button onClick={() => navigate({ name: "job", jobId: job.meta.id })}>대조 결과 보기</button>
              </div>

              <div className="review-body">
                <div className="editor">
                  <div className="editor-label">요청 문안 {pending ? "(편집 가능)" : ""}</div>
                  <textarea
                    value={text}
                    readOnly={!pending}
                    onChange={(e) => {
                      setText(e.target.value);
                      setDirty(true);
                    }}
                  />
                  <div className={`check ${missing.length ? "fail" : "ok"}`}>
                    근거 표기 검사: {missing.length ? `빠진 표기 ${missing.join(", ")}` : "통과"}
                  </div>
                  {draft.ai && !draft.ai.check.ok && (
                    <div className="alert warn">
                      AI 문안({draft.ai.model})에서 근거 표기({draft.ai.check.missing.join(", ")})가 빠져 적용하지 않았습니다.
                      <details>
                        <summary>AI 문안 보기</summary>
                        <pre>{draft.ai.text}</pre>
                      </details>
                    </div>
                  )}
                  {draft.ai && draft.ai.check.ok && (
                    <div className="muted small">
                      AI 다듬기 적용: {draft.ai.model}, {formatTime(draft.ai.at)}
                    </div>
                  )}
                </div>
                <div className="evidence">
                  <div className="editor-label">근거</div>
                  <ol>
                    {draft.findingIndexes.map((fi) => {
                      const f = job.report.findings[fi];
                      if (!f) return null;
                      return (
                        <li key={fi} className={evidence === fi ? "selected" : ""}>
                          <div>
                            <b>{FINDING_LABEL[f.type]}</b> {f.key ?? ""}
                          </div>
                          <div className="muted small">
                            {[f.ref.file, f.ref.sheet, f.ref.row !== null ? `${f.ref.row}행` : null, f.ref.column]
                              .filter(Boolean)
                              .join(" / ")}
                          </div>
                          {f.type !== "submission_missing" && (
                            <button className="link" onClick={() => setEvidence(fi)}>
                              원본 보기
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                </div>
              </div>

              <div className="actions spread">
                <div className="actions">
                  <button disabled={!pending || !!busy} onClick={() => { setText(draft.baseText); setDirty(true); }}>
                    기본 문안으로
                  </button>
                  <button
                    disabled={!pending || !!busy}
                    onClick={() =>
                      act("ai", () => api.aiRewrite(job.meta.id, draft.dept), "기관 모델 서버에서 문안을 다듬었습니다. 근거 표기 검사 결과를 확인하십시오.")
                    }
                  >
                    {busy === "ai" ? "다듬는 중..." : "AI 다듬기"}
                  </button>
                  <button
                    disabled={!pending || !dirty || !!busy}
                    onClick={() => act("save", () => api.saveDraftText(job.meta.id, draft.dept, text), "수정한 문안을 저장했습니다.")}
                  >
                    저장
                  </button>
                  <button onClick={() => api.copyText(text).then(() => setNotice("문안을 복사했습니다. 메일이나 메신저에 붙여 넣으십시오."))}>
                    문안 복사
                  </button>
                </div>
                <div className="actions">
                  <button disabled={!pending || !!busy} onClick={() => setRejecting((v) => !v)}>
                    반려
                  </button>
                  <button
                    className="primary"
                    disabled={!pending || !!busy}
                    onClick={() => {
                      if (missing.length && !window.confirm(`근거 표기(${missing.join(", ")})가 빠졌습니다. 그래도 확정하시겠습니까?`)) return;
                      void act("confirm", () => api.confirmDraft(job.meta.id, draft.dept, text), "확정하여 업무대장에 등록했습니다.");
                    }}
                  >
                    확정하여 업무대장 등록
                  </button>
                </div>
              </div>
              {rejecting && pending && (
                <div className="reject-row">
                  <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="반려 사유 (예: 전화로 처리함)" />
                  <button
                    disabled={!!busy}
                    onClick={() => void act("reject", () => api.rejectDraft(job.meta.id, draft.dept, reason), "반려했습니다.")}
                  >
                    반려 확정
                  </button>
                  <button onClick={() => setRejecting(false)}>취소</button>
                </div>
              )}
              {evidence !== null && <SourcePreview jobId={job.meta.id} sourceRef={job.report.findings[evidence]?.ref ?? null} />}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
