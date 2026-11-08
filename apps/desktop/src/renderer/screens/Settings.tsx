import { useEffect, useState } from "react";
import type { ConnectionTestResult, EngineStatus } from "@ilson/service";
import type { AppInfo } from "../../shared/api";
import { api, errorText } from "../api";
import { ENGINE_STATE_LABEL, formatTime } from "../labels";

export function SettingsScreen({ onSaved }: { onSaved: () => void }) {
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [timeoutSec, setTimeoutSec] = useState(120);
  const [apiKey, setApiKey] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [clearKey, setClearKey] = useState(false);
  const [test, setTest] = useState<ConnectionTestResult | null>(null);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showNotices, setShowNotices] = useState(false);
  const [engine, setEngine] = useState<EngineStatus | null>(null);

  useEffect(() => {
    const load = () => void api.engineStatus().then(setEngine);
    load();
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, []);

  const restartEngine = async () => {
    setBusy("engine");
    setError("");
    try {
      setEngine(await api.restartEngine());
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy("");
    }
  };

  useEffect(() => {
    void api.appInfo().then(setInfo);
    void api.getSettings().then((s) => {
      if (s.model) {
        setBaseUrl(s.model.baseUrl);
        setModel(s.model.model);
        setTimeoutSec(Math.round(s.model.timeoutMs / 1000));
        setHasKey(s.model.hasApiKey);
      }
    });
  }, []);

  const input = () => ({
    baseUrl,
    model,
    timeoutMs: timeoutSec * 1000,
    ...(clearKey ? { apiKey: "" } : apiKey ? { apiKey } : {}),
  });

  const runTest = async () => {
    setBusy("test");
    setError("");
    setNotice("");
    try {
      setTest(await api.testModel(input()));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy("");
    }
  };

  const save = async () => {
    setBusy("save");
    setError("");
    setNotice("");
    try {
      const s = await api.saveModelSettings(input());
      setHasKey(!!s.model?.hasApiKey);
      setApiKey("");
      setClearKey(false);
      setNotice("저장했습니다. 실행 엔진을 새 설정으로 다시 시작합니다.");
      onSaved();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="page narrow">
      <h1>설정</h1>
      <h2>기관 GPU 서버 (모델)</h2>
      <p className="muted">
        기관 내부망의 Ollama 또는 vLLM 서버 주소를 입력합니다. 일손은 이 주소 외의 외부로 연결하지 않습니다.
      </p>
      {error && <div className="alert error">{error}</div>}
      {notice && <div className="alert info">{notice}</div>}
      <div className="form">
        <label>
          <span>서버 주소</span>
          <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="예: http://10.10.1.20:11434 (Ollama), http://gpu01:8000 (vLLM)" />
        </label>
        <label>
          <span>모델 이름</span>
          <div className="path-row">
            <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="예: qwen3:4b" list="model-list" />
            <datalist id="model-list">
              {test?.models.map((m) => <option key={m} value={m} />)}
            </datalist>
          </div>
        </label>
        <label>
          <span>응답 대기 시간(초)</span>
          <input type="number" min={10} max={600} value={timeoutSec} onChange={(e) => setTimeoutSec(Number(e.target.value) || 120)} />
        </label>
        <label>
          <span>API 키 (vLLM에 키를 건 경우만)</span>
          <input type="password" value={apiKey} disabled={clearKey} onChange={(e) => setApiKey(e.target.value)} placeholder={hasKey ? "저장되어 있음. 바꿀 때만 입력" : "없으면 비워 둠"} />
        </label>
        {hasKey && (
          <label className="inline">
            <input type="checkbox" checked={clearKey} onChange={(e) => setClearKey(e.target.checked)} /> 저장된 API 키 삭제
          </label>
        )}
      </div>
      <div className="actions">
        <button disabled={!baseUrl || !!busy} onClick={runTest}>
          {busy === "test" ? "시험 중..." : "연결 시험"}
        </button>
        <button className="primary" disabled={!baseUrl || !model || !!busy} onClick={save}>
          저장
        </button>
      </div>
      {test && (
        <div className={`alert ${test.ok && test.modelFound ? "info" : test.ok ? "warn" : "error"}`}>
          {test.ok
            ? `연결 성공 (${test.latencyMs}ms). 서버 모델: ${test.models.join(", ") || "없음"}. ${
                test.modelFound ? `'${model}' 확인됨.` : `'${model}'이(가) 서버 목록에 없습니다. 모델 이름을 확인하십시오.`
              }`
            : `연결 실패: ${test.error}`}
        </div>
      )}

      <h2>실행 엔진 (OpenClaw)</h2>
      <p className="muted">
        프로그램에 들어 있는 OpenClaw를 이 PC 안에서만(127.0.0.1) 실행합니다. AI 다듬기는 이 엔진을 거쳐 위의 기관 GPU 서버로
        갑니다. 엔진은 파일, 명령 실행 같은 도구를 쓰지 않도록 설정되어 있습니다.
      </p>
      {engine && (
        <table className="grid kv">
          <tbody>
            <tr>
              <th>상태</th>
              <td className={engine.state === "ready" ? "check ok" : engine.state === "error" ? "check fail" : ""}>
                {ENGINE_STATE_LABEL[engine.state]}
              </td>
            </tr>
            <tr>
              <th>버전</th>
              <td>OpenClaw {engine.version}</td>
            </tr>
            <tr>
              <th>주소</th>
              <td>{engine.port ? `127.0.0.1:${engine.port} (이 PC 안에서만 접속)` : "-"}</td>
            </tr>
            <tr>
              <th>시작 시각</th>
              <td>{engine.startedAt ? formatTime(engine.startedAt) : "-"}</td>
            </tr>
            {engine.message && (
              <tr>
                <th>내용</th>
                <td>{engine.message}</td>
              </tr>
            )}
            <tr>
              <th>기록 파일</th>
              <td>{engine.logFile}</td>
            </tr>
          </tbody>
        </table>
      )}
      <div className="actions">
        <button disabled={!!busy || engine?.state === "not_configured"} onClick={restartEngine}>
          {busy === "engine" ? "다시 시작하는 중..." : "실행 엔진 다시 시작"}
        </button>
      </div>

      <h2>프로그램 정보</h2>
      {info && (
        <table className="grid kv">
          <tbody>
            <tr>
              <th>버전</th>
              <td>{info.version}</td>
            </tr>
            <tr>
              <th>사용자</th>
              <td>{info.user}</td>
            </tr>
            <tr>
              <th>데이터 폴더</th>
              <td>{info.dataDir}</td>
            </tr>
            <tr>
              <th>오픈소스 고지</th>
              <td>
                <button className="link" onClick={() => setShowNotices((v) => !v)}>
                  {showNotices ? "닫기" : "보기"}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      )}
      {showNotices && info && <pre className="notices">{info.thirdPartyNotices || "고지 파일이 없습니다."}</pre>}
    </div>
  );
}
