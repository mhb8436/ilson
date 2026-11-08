import type { TemplateConfig } from "@ilson/collate";

/** 기관 양식을 받기 전까지 쓰는 기본 주간보고 양식. 기관마다 JSON 파일로 바꿔 끼운다. */
export const DEFAULT_WEEKLY_TEMPLATE: TemplateConfig = {
  templateId: "weekly-report-v1",
  sheetName: "주간보고",
  headerRow: 1,
  deptColumn: "부서",
  keyColumns: ["과제ID"],
  requiredColumns: ["과제명", "담당자", "진행률(%)"],
  compareColumns: ["담당자", "진행률(%)", "예산집행액(천원)"],
  numericColumns: ["진행률(%)", "예산집행액(천원)"],
};
