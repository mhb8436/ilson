import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, safeStorage, session, shell } from "electron";
import { IlsonService, type SecretBox } from "@ilson/service";
import { API_METHODS, type AppInfo, type IlsonApi, type IpcResult } from "../shared/api.js";

// 시험 자동화에서 데이터 폴더를 따로 쓰기 위한 설정. 설치본 사용자는 쓰지 않는다.
if (process.env.ILSON_USER_DATA) app.setPath("userData", process.env.ILSON_USER_DATA);

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

/** Windows에서는 DPAPI로 현재 사용자 계정에 묶어 암호화한다. */
const secretBox: SecretBox = {
  encrypt(plain) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error("이 PC에서 암호화 저장소를 쓸 수 없어 API 키를 저장하지 않았습니다.");
    return safeStorage.encryptString(plain).toString("base64");
  },
  decrypt(sealed) {
    return safeStorage.decryptString(Buffer.from(sealed, "base64"));
  },
};

function resourcePath(...parts: string[]): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, ...parts)
    : path.join(__dirname, "..", "..", "..", ...parts.map((p) => (p === "samples" ? "fixtures" : p)));
}

let service: IlsonService;
let win: BrowserWindow | null = null;

function handlers(): IlsonApi {
  return {
    async appInfo(): Promise<AppInfo> {
      const sample = resourcePath("samples", "weekly-report");
      const notices = resourcePath("THIRD_PARTY_NOTICES.md");
      return {
        version: app.getVersion(),
        dataDir: path.join(app.getPath("userData"), "data"),
        sampleDir: existsSync(sample) ? sample : null,
        user: os.userInfo().username,
        thirdPartyNotices: existsSync(notices) ? readFileSync(notices, "utf8") : "",
      };
    },
    getSettings: () => service.getSettings(),
    saveModelSettings: (input) => service.saveModelSettings(input),
    saveDefaults: (d) => service.saveDefaults(d),
    testModel: (input) => service.testModel(input),
    async pickFile(opts) {
      const r = await dialog.showOpenDialog(win!, { title: opts.title, properties: ["openFile"], filters: opts.filters });
      return r.canceled ? null : (r.filePaths[0] ?? null);
    },
    async pickFolder(opts) {
      const r = await dialog.showOpenDialog(win!, { title: opts.title, properties: ["openDirectory"] });
      return r.canceled ? null : (r.filePaths[0] ?? null);
    },
    createCollateJob: (input) => service.createCollateJob(input),
    listJobs: () => service.listJobs(),
    getJob: (id) => service.getJob(id),
    listReviewItems: () => service.listReviewItems(),
    preview: (jobId, ref) => service.preview(jobId, ref),
    async openSource(jobId, file) {
      // 업무에 쓴 파일만 연다. 화면이 임의 경로를 넘겨도 열리지 않는다.
      const p = await service.resolveSourcePath(jobId, file);
      const err = await shell.openPath(p);
      if (err) throw new Error(`파일을 열 수 없습니다: ${err}`);
    },
    aiRewrite: (jobId, dept) => service.aiRewrite(jobId, dept),
    saveDraftText: (jobId, dept, text) => service.saveDraftText(jobId, dept, text),
    confirmDraft: (jobId, dept, text) => service.confirmDraft(jobId, dept, text),
    rejectDraft: (jobId, dept, reason) => service.rejectDraft(jobId, dept, reason),
    listLedger: () => service.ledger.list(),
    verifyLedger: () => service.ledger.verify(),
    async copyText(text) {
      clipboard.writeText(text);
    },
  };
}

function registerIpc(): void {
  const impl = handlers() as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
  for (const name of API_METHODS) {
    ipcMain.handle(`ilson:${name}`, async (event, ...args): Promise<IpcResult<unknown>> => {
      // 우리 창에서 온 요청만 받는다.
      if (!win || event.sender !== win.webContents) return { ok: false, error: "허용되지 않은 요청입니다." };
      try {
        return { ok: true, data: await impl[name]!(...args) };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    });
  }
}

function lockDownNetwork(): void {
  // 화면은 로컬 파일만 읽는다. 모델 서버 호출은 메인 프로세스에서만 한다.
  session.defaultSession.webRequest.onBeforeRequest((details, cb) => {
    const ok = details.url.startsWith("file://") || details.url.startsWith("devtools://") || details.url.startsWith("data:");
    cb({ cancel: !ok });
  });
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
}

async function createWindow(): Promise<void> {
  win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1100,
    minHeight: 700,
    title: "일손 - 크래프틱 업무비서",
    backgroundColor: "#ffffff",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  win.once("ready-to-show", () => win?.show());
  await win.loadFile(path.join(__dirname, "renderer", "index.html"));
}

app.on("second-instance", () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  service = new IlsonService({
    dataDir: path.join(app.getPath("userData"), "data"),
    actor: os.userInfo().username,
    secretBox,
  });
  await service.init();
  lockDownNetwork();
  registerIpc();
  await createWindow();
});

app.on("window-all-closed", () => app.quit());
