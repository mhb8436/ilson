// 실제 Electron 앱을 띄워 샘플 자료로 업무 한 건을 끝까지 처리하고 화면을 캡처한다.
// 사용: (Linux) xvfb-run -a node e2e/smoke.mjs <스크린샷 폴더>, (Windows) node e2e/smoke.mjs <스크린샷 폴더>
import { mkdtemp, mkdir } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { _electron: electron } = require("playwright-core");
const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, "..");
const shots = path.resolve(process.argv[2] ?? path.join(appDir, "e2e-shots"));
await mkdir(shots, { recursive: true });

// 기관 GPU 서버 대역: OpenAI 호환 API. 받은 항목을 그대로 살려 정중한 문안으로 돌려준다.
const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    res.setHeader("content-type", "application/json");
    if (req.url === "/v1/models") return res.end(JSON.stringify({ data: [{ id: "qwen3:4b" }] }));
    const prompt = JSON.parse(body).messages.at(-1).content;
    const to = /수신: (.+)/.exec(prompt)?.[1] ?? "";
    const items = prompt.split("\n").filter((l) => /^\d+\. /.test(l));
    const text = `${to} 담당자님께\n\n이번 주 주간보고를 취합하는 과정에서 아래 사항이 확인되어 보완을 요청드립니다.\n\n${items.join("\n")}\n\n바쁘신 중에 번거롭게 해 드려 죄송합니다. 수정본을 같은 폴더에 올려 주시면 다시 취합하겠습니다.`;
    res.end(JSON.stringify({ model: "qwen3:4b", choices: [{ message: { content: `<think>x</think>${text}` } }] }));
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const modelUrl = `http://127.0.0.1:${server.address().port}`;

const userData = await mkdtemp(path.join(os.tmpdir(), "ilson-e2e-"));
// ILSON_APP_EXE를 주면 설치본(패키징된 실행 파일)을 시험한다.
const packaged = process.env.ILSON_APP_EXE;
const app = await electron.launch({
  executablePath: packaged ?? createRequire(path.join(appDir, "package.json"))("electron"),
  args: packaged ? ["--no-sandbox"] : [appDir, "--no-sandbox"],
  env: { ...process.env, ILSON_USER_DATA: userData, LANG: "ko_KR.UTF-8" },
});
const win = await app.firstWindow();
await win.setViewportSize({ width: 1360, height: 860 });
const shot = (name) => win.screenshot({ path: path.join(shots, `${name}.png`) });
const errors = [];
win.on("pageerror", (e) => errors.push(e.message));

await win.getByRole("button", { name: "홈", exact: true }).waitFor();
await shot("01-home-first-run");

// 설정: 기관 GPU 서버 연결
await win.getByRole("button", { name: "설정", exact: true }).click();
await win.getByPlaceholder(/10\.10\.1\.20/).fill(modelUrl);
await win.getByPlaceholder("예: qwen3:4b").fill("qwen3:4b");
await win.getByRole("button", { name: "연결 시험" }).click();
await win.getByText(/연결 성공/).waitFor();
await win.getByRole("button", { name: "저장", exact: true }).click();
await win.getByText("저장했습니다.").waitFor();
await shot("02-settings-model-server");

// 업무 맡기기: 샘플 자료로 대조
await win.getByRole("button", { name: "업무 맡기기", exact: true }).click();
await win.getByRole("button", { name: "샘플 자료 채우기" }).click();
await shot("03-new-job");
await win.getByRole("button", { name: "대조 실행" }).click();
await win.getByText("부서별 제출 현황").waitFor();
await win.getByRole("cell", { name: /운영지원과_주간보고_2026-W45.xlsx \/ 주간보고 \/ 2행/ }).click();
await win.getByRole("button", { name: "원본 파일 열기" }).waitFor();
await win.locator("td.hl-cell").waitFor();
await shot("04-job-result-preview");

// 검토함: AI 다듬기 후 확정
await win.getByRole("button", { name: "검토함에서 문안 확인" }).click();
await win.getByRole("cell", { name: /운영지원과/ }).first().click();
await win.getByRole("button", { name: "AI 다듬기" }).click();
await win.getByText(/기관 모델 서버에서 문안을 다듬었습니다/).waitFor();
await win.getByRole("button", { name: "원본 보기" }).first().click();
await win.locator("td.hl-cell").waitFor();
await shot("05-review-ai-rewrite");
await win.getByRole("button", { name: "확정하여 업무대장 등록" }).click();
await win.getByText("확정하여 업무대장에 등록했습니다.").waitFor();

// 근거 표기를 지우면 검사에서 걸린다
await win.getByRole("cell", { name: /정보화담당관/ }).first().click();
await win.locator("textarea").fill("정보화담당관 담당자님, 진행률을 숫자로 적어 주세요.");
await win.getByText(/빠진 표기/).waitFor();
await shot("06-review-evidence-check-fail");

// 업무대장
await win.getByRole("button", { name: "업무대장", exact: true }).click();
await win.getByText(/변조 검사 통과/).waitFor();
await shot("07-ledger");

await win.getByRole("button", { name: "홈", exact: true }).click();
await win.getByText("최근 업무").waitFor();
await shot("08-home");

await app.close();
server.close();
if (errors.length) {
  console.error("화면 오류:", errors);
  process.exit(1);
}
console.log(`완료. 스크린샷: ${shots}`);
