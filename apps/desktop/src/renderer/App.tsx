import { useCallback, useEffect, useState } from "react";
import type { EngineState } from "@ilson/service";
import { api } from "./api";
import { ENGINE_STATE_LABEL } from "./labels";
import { HomeScreen } from "./screens/Home";
import { JobScreen } from "./screens/Job";
import { LedgerScreen } from "./screens/Ledger";
import { NewJobScreen } from "./screens/NewJob";
import { ReviewScreen } from "./screens/Review";
import { SettingsScreen } from "./screens/Settings";

export type Route =
  | { name: "home" }
  | { name: "new" }
  | { name: "job"; jobId: string }
  | { name: "review"; jobId?: string; dept?: string }
  | { name: "ledger" }
  | { name: "settings" };

export type Navigate = (route: Route) => void;

const TABS: { name: Route["name"]; label: string }[] = [
  { name: "home", label: "홈" },
  { name: "new", label: "업무 맡기기" },
  { name: "review", label: "검토함" },
  { name: "ledger", label: "업무대장" },
  { name: "settings", label: "설정" },
];

export function App() {
  const [route, setRoute] = useState<Route>({ name: "home" });
  const [pending, setPending] = useState(0);
  const [engineState, setEngineState] = useState<EngineState | null>(null);

  const refreshBadges = useCallback(async () => {
    const items = await api.listReviewItems();
    setPending(items.filter((i) => i.status === "pending").length);
    setEngineState((await api.engineStatus()).state);
  }, []);

  useEffect(() => {
    void refreshBadges();
  }, [route, refreshBadges]);

  // 실행 엔진은 뒤에서 시작하므로 상태를 주기적으로 확인한다.
  useEffect(() => {
    const t = setInterval(() => {
      void api.engineStatus().then((s) => setEngineState(s.state));
    }, 1500);
    return () => clearInterval(t);
  }, []);

  const navigate: Navigate = (r) => setRoute(r);
  const active = route.name === "job" ? "home" : route.name;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          일손 <span className="brand-sub">크래프틱 업무비서</span>
        </div>
        <nav className="tabs">
          {TABS.map((t) => (
            <button
              key={t.name}
              className={`tab ${active === t.name ? "active" : ""}`}
              onClick={() => navigate({ name: t.name } as Route)}
            >
              {t.label}
              {t.name === "review" && pending > 0 ? <span className="count">{pending}</span> : null}
            </button>
          ))}
        </nav>
        <div className={`model-state ${engineState === "ready" ? "ok" : engineState === "starting" ? "" : "warn"}`}>
          {engineState ? ENGINE_STATE_LABEL[engineState] : ""}
        </div>
      </header>
      <main className="content">
        {route.name === "home" && <HomeScreen navigate={navigate} />}
        {route.name === "new" && <NewJobScreen navigate={navigate} />}
        {route.name === "job" && <JobScreen jobId={route.jobId} navigate={navigate} />}
        {route.name === "review" && (
          <ReviewScreen
            navigate={navigate}
            initial={route.jobId && route.dept ? { jobId: route.jobId, dept: route.dept } : null}
            onChanged={refreshBadges}
          />
        )}
        {route.name === "ledger" && <LedgerScreen navigate={navigate} />}
        {route.name === "settings" && <SettingsScreen onSaved={refreshBadges} />}
      </main>
    </div>
  );
}
