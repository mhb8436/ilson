/** 대조 기준이 되는 보고 양식 정의. 기관 양식마다 JSON 한 개로 관리한다. */
export interface TemplateConfig {
  templateId: string;
  /** 읽을 시트 이름. CSV에는 적용하지 않는다. */
  sheetName: string;
  /** 머리글 행 번호(1부터). */
  headerRow: number;
  /** 행이 어느 부서 것인지 적는 열. */
  deptColumn: string;
  /** 같은 과제를 식별하는 열. 여러 개면 묶어서 키로 쓴다. */
  keyColumns: string[];
  /** 비어 있으면 보완 요청 대상인 열. */
  requiredColumns: string[];
  /** 지난주 확정본과 값을 비교할 열. */
  compareColumns: string[];
  /** 숫자로 읽어야 하는 열. 쉼표, 공백, % 기호는 제거하고 해석한다. */
  numericColumns: string[];
}

export interface RosterEntry {
  code: string;
  name: string;
  /** 이번 주기 제출 대상 여부. */
  required: boolean;
  contact: string;
}

/** 원본 위치. 결과의 모든 항목은 이 위치로 되돌아갈 수 있어야 한다. */
export interface SourceRef {
  file: string;
  /** XLSX 시트 이름. CSV는 null. */
  sheet: string | null;
  /** 원본 파일 기준 행 번호(1부터, 머리글 포함). */
  row: number | null;
  column?: string;
}

export type CellValue = string | number | null;

export interface SourceRow {
  ref: SourceRef;
  values: Record<string, CellValue>;
}

export interface SourceTable {
  file: string;
  sheet: string | null;
  headers: string[];
  rows: SourceRow[];
}

export type FindingType =
  | "submission_missing"
  | "multiple_files"
  | "unknown_file"
  | "unreadable_file"
  | "sheet_missing"
  | "header_missing"
  | "dept_mismatch"
  | "required_empty"
  | "invalid_number"
  | "duplicate_row"
  | "value_changed"
  | "row_added"
  | "row_removed";

/** 담당자 확인만 필요한 항목과 부서에 보완을 요청할 항목을 구분한다. */
export type FindingAudience = "department" | "reviewer";

export interface Finding {
  type: FindingType;
  audience: FindingAudience;
  /** 부서 코드. 어느 부서에도 속하지 않는 파일이면 null. */
  dept: string | null;
  key: string | null;
  ref: SourceRef;
  /** 비교 대상 위치(중복의 첫 행, 지난주 확정본의 행 등). */
  relatedRef?: SourceRef;
  before?: CellValue;
  after?: CellValue;
  delta?: number;
  /** 중복 행이 첫 행과 값까지 같은지 여부. */
  exactDuplicate?: boolean;
  message: string;
}

export type DeptStatus = "submitted" | "missing" | "unreadable" | "not_required";

export interface DeptSummary {
  code: string;
  name: string;
  status: DeptStatus;
  files: string[];
  rowCount: number;
}

export interface CollateReport {
  templateId: string;
  week: string;
  previousWeek: string | null;
  departments: DeptSummary[];
  findings: Finding[];
  counts: Partial<Record<FindingType, number>>;
}
