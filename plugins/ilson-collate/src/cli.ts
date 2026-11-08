#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { collate } from "./collate.js";
import { loadRoster, loadTemplateConfig } from "./inputs.js";
import { renderMarkdown } from "./render.js";
import { buildRequestDrafts } from "./request-draft.js";

const USAGE = `사용법: ilson-collate --config <양식.json> --roster <명단.csv> --inbox <접수폴더> --week <주차>
                     [--previous <지난주 확정본.xlsx> --previous-week <주차>] [--out <결과폴더>]`;

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      config: { type: "string" },
      roster: { type: "string" },
      inbox: { type: "string" },
      week: { type: "string" },
      previous: { type: "string" },
      "previous-week": { type: "string" },
      out: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help || !values.config || !values.roster || !values.inbox || !values.week) {
    console.error(USAGE);
    return values.help ? 0 : 2;
  }
  const config = await loadTemplateConfig(values.config);
  const roster = await loadRoster(values.roster);
  const report = await collate({
    config,
    roster,
    week: values.week,
    inboxDir: values.inbox,
    ...(values.previous ? { previousFile: values.previous } : {}),
    ...(values["previous-week"] ? { previousWeek: values["previous-week"] } : {}),
  });
  const markdown = renderMarkdown(report);
  const drafts = buildRequestDrafts(report, roster);
  if (!values.out) {
    process.stdout.write(markdown);
    return 0;
  }
  const out = path.resolve(values.out);
  await mkdir(path.join(out, "requests"), { recursive: true });
  await writeFile(path.join(out, "report.json"), JSON.stringify(report, null, 2) + "\n");
  await writeFile(path.join(out, "report.md"), markdown);
  for (const d of drafts) {
    await writeFile(path.join(out, "requests", `${d.dept}_${d.deptName}.txt`), d.text + "\n");
  }
  console.log(`결과 ${report.findings.length}건, 보완 요청 초안 ${drafts.length}건 -> ${out}`);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
