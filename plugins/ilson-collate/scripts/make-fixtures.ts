/**
 * 주간보고 취합 시험 자료 생성기. 모든 부서명, 인명, 수치는 가상이다.
 * 의도적으로 넣은 결함과 정답은 fixtures/weekly-report/expected.json에 사람이 따로 적어 두었다.
 * 이 스크립트는 정답을 계산하지 않는다(엔진과 같은 논리로 정답을 만들면 시험이 무의미해진다).
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ExcelJS from "exceljs";
import iconv from "iconv-lite";

const HEADERS = ["부서", "과제ID", "과제명", "담당자", "진행률(%)", "예산집행액(천원)", "주요실적", "차주계획"];
type Row = (string | number | null)[];

const FIXED_DATE = new Date("2026-11-06T00:00:00Z");

async function writeXlsx(file: string, sheetName: string, rows: Row[]): Promise<void> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "ilson-fixtures";
  wb.created = FIXED_DATE;
  wb.modified = FIXED_DATE;
  const ws = wb.addWorksheet(sheetName);
  ws.addRow(HEADERS);
  for (const r of rows) ws.addRow(r);
  await wb.xlsx.writeFile(file);
}

function toCsv(rows: Row[]): string {
  const esc = (v: string | number | null) => {
    const s = v === null ? "" : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [HEADERS, ...rows].map((r) => r.map(esc).join(",")).join("\r\n") + "\r\n";
}

// 지난주(2026-W44) 확정본. 행 번호는 머리글이 1행이므로 2행부터 시작한다.
const W44: Row[] = [
  ["기획조정실", "P-0101", "2027 업무계획 수립", "홍길동", 40, 12000, "부서 의견 수렴", "초안 작성"], // 2
  ["기획조정실", "P-0102", "성과지표 점검", "김철수", 70, 3500, "지표 정의서 보완", "중간 점검"], // 3
  ["운영지원과", "P-0201", "청사 시설 점검", "이영희", 50, 8000, "냉난방 설비 점검", "승강기 점검"], // 4
  ["운영지원과", "P-0202", "직원 교육 운영", "박민수", 30, 2000, "교육 수요 조사", "교육 계획 수립"], // 5
  ["정보화담당관", "P-0301", "업무망 PC 교체", "최지훈", 20, 45000, "물량 확정", "설치 일정 협의"], // 6
  ["정보화담당관", "P-0302", "정보보안 점검", "정수진", 60, 1500, "취약점 점검", "조치 결과 확인"], // 7
  ["감사담당관", "P-0401", "자체 감사 계획", "강동원", 10, 0, "대상 선정", "계획 보고"], // 8
  ["홍보담당관", "P-0501", "보도자료 배포", "윤서연", 80, 1200, "보도자료 3건", "기획 기사 협의"], // 9
  ["해양안전과", "P-0601", "선박 안전 점검", "한지민", 35, 22000, "점검 대상 확정", "현장 점검"], // 10
  ["해양안전과", "P-0602", "안전 교육", "서준호", 50, 3000, "교재 제작", "교육 실시"], // 11
  ["해양안전과", "P-0603", "구명장비 교체", "임하늘", 90, 5000, "납품 검수", "완료 보고"], // 12
];

export async function makeFixtures(rootDir: string): Promise<void> {
  const root = path.resolve(rootDir);
  await rm(path.join(root, "confirmed"), { recursive: true, force: true });
  await rm(path.join(root, "inbox"), { recursive: true, force: true });
  const confirmed = path.join(root, "confirmed");
  const inbox = path.join(root, "inbox", "2026-W45");
  await mkdir(confirmed, { recursive: true });
  await mkdir(inbox, { recursive: true });

  await writeFile(
    path.join(root, "roster.csv"),
    [
      "부서코드,부서명,제출대상,담당자",
      "D01,기획조정실,Y,홍길동",
      "D02,운영지원과,Y,이영희",
      "D03,정보화담당관,Y,최지훈",
      "D04,감사담당관,Y,강동원",
      "D05,홍보담당관,Y,윤서연",
      "D06,해양안전과,Y,한지민",
      "D07,대변인실,N,문하준",
    ].join("\n") + "\n",
  );

  await writeXlsx(path.join(confirmed, "2026-W44_주간보고_확정본.xlsx"), "주간보고", W44);

  // D01: 진행률과 예산이 바뀐 정상 제출.
  await writeXlsx(path.join(inbox, "기획조정실_주간보고_2026-W45.xlsx"), "주간보고", [
    ["기획조정실", "P-0101", "2027 업무계획 수립", "홍길동", 55, 15000, "초안 작성", "실국 검토"],
    ["기획조정실", "P-0102", "성과지표 점검", "김철수", 70, 3500, "중간 점검", "결과 보고"],
  ]);

  // D02: 2행 담당자 누락, 3행 진행률 변경, 4행은 3행의 완전 중복.
  const d02Row: Row = ["운영지원과", "P-0202", "직원 교육 운영", "박민수", 45, 2000, "교육 계획 수립", "1차 교육"];
  await writeXlsx(path.join(inbox, "운영지원과_주간보고_2026-W45.xlsx"), "주간보고", [
    ["운영지원과", "P-0201", "청사 시설 점검", null, 50, 8000, "승강기 점검", "소방 점검"],
    d02Row,
    [...d02Row],
  ]);

  // D03: CP949 CSV. 2행 진행률 '약 30'은 숫자 오류, 3행은 쉼표 숫자와 담당자 변경.
  await writeFile(
    path.join(inbox, "정보화담당관_주간보고_2026-W45.csv"),
    iconv.encode(
      toCsv([
        ["정보화담당관", "P-0301", "업무망 PC 교체", "최지훈", "약 30", "45,000", "설치 일정 협의", "1차 설치"],
        ["정보화담당관", "P-0302", "정보보안 점검", "문가영", "60", "1,500", "조치 결과 확인", "결과 보고"],
      ]),
      "cp949",
    ),
  );

  // D04: 미제출.

  // D05: 시트 이름이 양식과 다름.
  await writeXlsx(path.join(inbox, "홍보담당관_주간보고_2026-W45.xlsx"), "Sheet1", [
    ["홍보담당관", "P-0501", "보도자료 배포", "윤서연", 85, 1300, "기획 기사 협의", "기사 게재"],
  ]);

  // D06: 2행 진행률 변경, 3행 부서 값 오기, 4행은 2행과 키가 같고 값이 다른 중복,
  // 5행 신규 과제, P-0603은 빠짐.
  await writeXlsx(path.join(inbox, "해양안전과_주간보고_2026-W45.xlsx"), "주간보고", [
    ["해양안전과", "P-0601", "선박 안전 점검", "한지민", 40, 22000, "현장 점검", "결과 정리"],
    ["운영지원과", "P-0602", "안전 교육", "서준호", 50, 3000, "교육 실시", "만족도 조사"],
    ["해양안전과", "P-0601", "선박 안전 점검", "한지민", 45, 22000, "현장 점검", "결과 정리"],
    ["해양안전과", "P-0604", "항만 순찰 강화", "임하늘", 5, 0, "계획 수립", "순찰 개시"],
  ]);

  // 명단에 없는 파일과 엑셀 잠금 파일.
  await writeXlsx(path.join(inbox, "참고자료_메모.xlsx"), "메모", []);
  await writeFile(path.join(inbox, "~$기획조정실_주간보고_2026-W45.xlsx"), "lock");

}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const root = process.argv[2] ?? "fixtures/weekly-report";
  makeFixtures(root).then(
    () => console.log(`시험 자료 생성: ${path.resolve(root)}`),
    (err: unknown) => {
      console.error(err);
      process.exit(1);
    },
  );
}
