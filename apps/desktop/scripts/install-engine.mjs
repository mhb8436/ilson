// 설치본에 넣을 OpenClaw를 engine-runtime에 설치하고, 버전 고정과 라이선스 목록을 확인한다.
// OpenClaw는 Node 24 이상을 요구하므로 이 스크립트는 Node 24 이상에서 실행한다(CI도 같음).
// 실행 시점에는 별도 Node가 필요 없다(Electron 실행 파일을 Node로 쓴다).
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const runtimeDir = path.resolve(here, "../engine-runtime");
const pin = JSON.parse(readFileSync(path.resolve(here, "../../../engine/openclaw.pin.json"), "utf8"));
const wanted = JSON.parse(readFileSync(path.join(runtimeDir, "package.json"), "utf8")).dependencies.openclaw;
if (wanted !== pin.version) {
  throw new Error(`engine-runtime의 openclaw(${wanted})가 engine/openclaw.pin.json(${pin.version})과 다릅니다.`);
}
const major = Number(process.versions.node.split(".")[0]);
if (major < 24) throw new Error(`엔진 설치에는 Node 24 이상이 필요합니다(현재 ${process.versions.node}).`);

const installed = path.join(runtimeDir, "node_modules/openclaw/package.json");
const current = existsSync(installed) ? JSON.parse(readFileSync(installed, "utf8")).version : null;
if (current !== pin.version || process.argv.includes("--force")) {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  // 설치 스크립트는 실행하지 않는다. 게이트웨이 실행에 필요하지 않고, 반입 형상을 lockfile 그대로 유지한다.
  execFileSync(npm, ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], {
    cwd: runtimeDir,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
}

// 엔진에 들어간 패키지의 라이선스 목록. 설치본의 resources/engine에 함께 넣는다.
const rows = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (name.startsWith(".")) continue;
    const full = path.join(dir, name);
    if (name.startsWith("@")) {
      walk(full);
      continue;
    }
    const pj = path.join(full, "package.json");
    if (!existsSync(pj)) continue;
    const p = JSON.parse(readFileSync(pj, "utf8"));
    const lic = typeof p.license === "string" ? p.license : (p.license?.type ?? "확인 필요");
    rows.push(`${p.name}@${p.version}\t${lic}`);
    const nested = path.join(full, "node_modules");
    if (existsSync(nested)) walk(nested);
  }
}
walk(path.join(runtimeDir, "node_modules"));
rows.sort();
writeFileSync(
  path.join(runtimeDir, "ENGINE_LICENSES.txt"),
  `OpenClaw ${pin.version} 실행 엔진에 포함된 패키지와 라이선스 (${rows.length}개)\n\n${rows.join("\n")}\n`,
);
console.log(`OpenClaw ${pin.version} 준비 완료, 패키지 ${rows.length}개`);
