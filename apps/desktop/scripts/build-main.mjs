// 메인 프로세스와 preload를 의존성까지 한 파일로 묶는다.
// 설치본에 node_modules를 넣지 않으므로 pnpm 심볼릭 링크 문제가 없다.
import { build } from "esbuild";

const common = {
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  external: ["electron"],
  conditions: ["source"],
  sourcemap: true,
  logLevel: "info",
  legalComments: "linked",
};

await build({ ...common, entryPoints: ["src/main/main.ts"], outfile: "dist/main.cjs" });
await build({ ...common, entryPoints: ["src/main/preload.ts"], outfile: "dist/preload.cjs" });
