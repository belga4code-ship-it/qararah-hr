import { lateMinutesAfter915 } from "@/lib/attendance";

export type AttendanceScoreRecord = { attendance_date: string; first_in: string | null; last_out: string | null; status: string; exception_note: string | null; reviewed_at: string | null };
export type AttendanceScoreImport = { source_file: string; period_start: string | null; period_end: string | null };
export type AttendanceScoreEvent = { event_type: string; effective_date: string; end_date: string | null };
export type AttendanceScoreResult = {
  state: "ready" | "provisional" | "exempt" | "incomplete" | "unavailable";
  reason: string;
  scheduleAvailable: boolean;
  score: number | null;
  expectedDays: number;
  presentDays: number;
  absentDays: number;
  completePunchDays: number;
  lateDays: number;
  lateMinutes: number;
  earlyDays: number;
  earlyMinutes: number;
  incompletePunchDays: number;
  missingPunchDays: number;
  missingPunches: number;
  missingDates: string[];
  unresolvedDates: string[];
  importFiles: string[];
  daily: Array<{ date: string; firstIn: string | null; lastOut: string | null; status: string; late: number; early: number; missingPunches: number; exempted: boolean }>;
};

const minutesOf = (value: string) => {
  const match = value.match(/^(\d{1,2}):(\d{2})/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
};
const round = (value: number) => Math.round(value * 10) / 10;

function containsDate(event: AttendanceScoreEvent, date: string) {
  return event.effective_date <= date && (!event.end_date || event.end_date >= date);
}

function importCoverageIsComplete(imports: AttendanceScoreImport[], start: string, end: string) {
  const ranges = imports
    .filter((item) => item.period_start && item.period_end)
    .map((item) => ({ start: item.period_start!, end: item.period_end! }))
    .sort((a, b) => a.start.localeCompare(b.start));
  if (!ranges.length || ranges[0].start > start) return false;
  let coveredThrough = ranges[0].end;
  for (const range of ranges.slice(1)) {
    const nextDay = new Date(`${coveredThrough}T12:00:00Z`);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    if (range.start > nextDay.toISOString().slice(0, 10)) break;
    if (range.end > coveredThrough) coveredThrough = range.end;
    if (coveredThrough >= end) return true;
  }
  return coveredThrough >= end;
}

function importedRanges(imports: AttendanceScoreImport[]) {
  return imports.filter((item) => item.period_start && item.period_end).map((item) => ({ start: item.period_start!, end: item.period_end! }));
}

export function calculateAttendanceScore({ employeeRequired, month, records, imports, events }: {
  employeeRequired: boolean;
  month: string;
  records: AttendanceScoreRecord[];
  imports: AttendanceScoreImport[];
  events: AttendanceScoreEvent[];
}): AttendanceScoreResult {
  const empty = { scheduleAvailable: true, expectedDays: 0, presentDays: 0, absentDays: 0, completePunchDays: 0, lateDays: 0, lateMinutes: 0, earlyDays: 0, earlyMinutes: 0, incompletePunchDays: 0, missingPunchDays: 0, missingPunches: 0, missingDates: [] as string[], unresolvedDates: [] as string[], importFiles: [...new Set(imports.map((item) => item.source_file).filter(Boolean))], daily: [] as AttendanceScoreResult["daily"] };
  if (!employeeRequired) return { ...empty, state: "exempt", reason: "الموظف معفى من تسجيل البصمة؛ لا تُحتسب له درجة حضور آلية.", score: null };

  // Company-wide schedule supplied by HR: Saturday–Thursday, 09:00–17:00,
  // with Thursday ending at 14:30. The established monthly report considers
  // arrivals after 09:15 late, so the shared rule grants a 15-minute grace.
  const workDays = new Set([0, 1, 2, 3, 4, 6]); // Friday (5) is the weekly day off.
  const scheduleForDate = (date: string) => {
    const day = new Date(`${date}T12:00:00Z`).getUTCDay();
    return { startMinute: 9 * 60, endMinute: day === 4 ? 14 * 60 + 30 : 17 * 60 };
  };
  const start = `${month}-01`;
  const endDate = new Date(`${start}T12:00:00Z`);
  endDate.setUTCMonth(endDate.getUTCMonth() + 1);
  endDate.setUTCDate(0);
  const end = endDate.toISOString().slice(0, 10);
  const scheduleAvailable = true;

  const byDate = new Map(records.map((record) => [record.attendance_date, record]));
  const leaveEvents = events.filter((event) => ["leave", "mission"].includes(event.event_type));
  const latePermissionEvents = events.filter((event) => event.event_type === "late_permission");
  const earlyPermissionEvents = events.filter((event) => event.event_type === "permission");
  const validRanges = importedRanges(imports);
  const missingCoverage = !importCoverageIsComplete(imports, start, end);
  const coveredDates = new Set<string>();
  for (const range of validRanges) {
    const rangeStart = range.start < start ? start : range.start;
    const rangeEnd = range.end > end ? end : range.end;
    if (rangeStart > rangeEnd) continue;
    for (let day = new Date(`${rangeStart}T12:00:00Z`); day.toISOString().slice(0, 10) <= rangeEnd; day.setUTCDate(day.getUTCDate() + 1)) coveredDates.add(day.toISOString().slice(0, 10));
  }
  // Attendance rows themselves are a valid source if an older import has no
  // matching attendance_imports metadata row.
  for (const record of records) if (record.attendance_date >= start && record.attendance_date <= end) coveredDates.add(record.attendance_date);
  const expected = new Set<string>();
  for (let date = new Date(`${start}T12:00:00Z`); date.toISOString().slice(0, 10) <= end; date.setUTCDate(date.getUTCDate() + 1)) {
    const key = date.toISOString().slice(0, 10);
    if (!workDays.has(date.getUTCDay()) || !coveredDates.has(key)) continue;
    const record = byDate.get(key);
    const approvedLeave = leaveEvents.some((event) => containsDate(event, key));
    if (approvedLeave || record?.status === "leave" || record?.status === "on_mission") continue;
    expected.add(key);
  }
  const coveredExpected = [...expected].sort();
  const result = { ...empty, scheduleAvailable, expectedDays: coveredExpected.length };
  result.expectedDays = coveredExpected.length;
  let scheduledMinutes = 0;
  for (const date of coveredExpected) {
    const record = byDate.get(date);
    if (!record) {
      result.missingDates.push(date);
      result.absentDays++;
      result.daily.push({ date, firstIn: null, lastOut: null, status: "absent", late: 0, early: 0, missingPunches: 0, exempted: false });
      continue;
    }
    if (record.status === "needs_review" || (record.status === "incomplete" && !record.reviewed_at)) result.unresolvedDates.push(date);
    if (record.status === "absent") { result.absentDays++; result.daily.push({ date, firstIn: record.first_in, lastOut: record.last_out, status: record.status, late: 0, early: 0, missingPunches: 0, exempted: false }); continue; }
    const worked = Boolean(record.first_in || record.last_out) || ["present", "late", "incomplete"].includes(record.status);
    if (!worked) {
      result.absentDays++;
      result.daily.push({ date, firstIn: record.first_in, lastOut: record.last_out, status: record.status, late: 0, early: 0, missingPunches: 0, exempted: false });
      continue;
    }
    result.presentDays++;
    const { startMinute, endMinute } = scheduleForDate(date);
    scheduledMinutes += endMinute - startMinute;
    const complete = Boolean(record.first_in && record.last_out);
    if (complete) result.completePunchDays++;
    else {
      result.incompletePunchDays++;
      result.missingPunchDays++;
      result.missingPunches += Number(!record.first_in) + Number(!record.last_out);
    }
    const lateAuthorized = latePermissionEvents.some((event) => containsDate(event, date));
    const earlyAuthorized = earlyPermissionEvents.some((event) => containsDate(event, date));
    const firstMinute = record.first_in ? minutesOf(record.first_in) : null;
    const lastMinute = record.last_out ? minutesOf(record.last_out) : null;
    const reportLateMinutes = firstMinute !== null ? lateMinutesAfter915(record.first_in) ?? 0 : 0;
    const late = lateAuthorized ? 0 : reportLateMinutes;
    const early = !earlyAuthorized && lastMinute !== null ? Math.max(0, endMinute - lastMinute) : 0;
    if (late > 0) { result.lateDays++; result.lateMinutes += late; }
    if (early > 0) { result.earlyDays++; result.earlyMinutes += early; }
    result.daily.push({ date, firstIn: record.first_in, lastOut: record.last_out, status: record.status, late, early, missingPunches: Number(!record.first_in) + Number(!record.last_out), exempted: lateAuthorized || earlyAuthorized });
  }

  if (!records.length || result.expectedDays === 0) return { ...result, state: "incomplete", reason: "لا توجد سجلات حضور لهذا الموظف في الشهر المحدد.", score: null };
  const attendance = result.expectedDays ? 60 * (result.presentDays / result.expectedDays) : 0;
  const expectedPunches = result.presentDays * 2;
  const recordedPunches = expectedPunches - result.missingPunches;
  const punchCompleteness = expectedPunches ? 15 * (recordedPunches / expectedPunches) : 0;
  const time = scheduledMinutes ? 25 * Math.max(0, 1 - (result.lateMinutes + result.earlyMinutes) / scheduledMinutes) : 0;
  const rawScore = attendance + time + punchCompleteness;
  const score = Math.min(100, Math.max(0, round(rawScore)));
  const state = missingCoverage || result.missingDates.length > 0 || result.unresolvedDates.length > 0 ? "provisional" : "ready";
  const reasons = [
    missingCoverage ? "الفترة المستوردة لا تغطي الشهر كاملًا." : "",
    result.missingPunches ? `${result.missingPunches} بصمة ناقصة خلال ${result.missingPunchDays} أيام.` : "",
    result.unresolvedDates.length ? `${result.unresolvedDates.length} سجلًا يحتاج مراجعة؛ حُسبت الدرجة مؤقتًا من أوقات السجلات المتاحة.` : "",
    result.missingDates.length ? `${result.missingDates.length} أيام دوام لا تحتوي على سجل حضور واحتُسبت غيابًا.` : "",
    !missingCoverage ? "تم احتساب الدرجة من سجلات قاعدة البيانات ودوام الشركة المعتمد." : "",
  ].filter(Boolean);
  return { ...result, state, reason: reasons.join(" "), score };
}
