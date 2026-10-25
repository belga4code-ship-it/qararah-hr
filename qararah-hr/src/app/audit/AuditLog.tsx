"use client";

import { useMemo, useState } from "react";
import { toWesternDigits } from "@/lib/digits";

export type AuditRow = {
  id: string;
  entity_table: string;
  entity_id: string;
  employee_id: string | null;
  branch_id: string | null;
  action: "INSERT" | "UPDATE" | "DELETE";
  changed_fields: string[];
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  created_at: string;
  actor: { full_name: string } | null;
  employee: { employee_number: string; full_name: string | null; first_name: string; last_name: string | null } | null;
  branch: { name: string } | null;
};

const tableLabels: Record<string, string> = { employee_goals: "أهداف الموظفين", profiles: "حساب مستخدم", employees: "ملف موظف", hr_events: "إجراء موارد بشرية", attendance_records: "سجل حضور", evaluations: "تقييم شهري" };
const fieldLabels: Record<string, string> = { title: "اسم الهدف", description: "تفاصيل الهدف", target_value: "القيمة المستهدفة", actual_value: "الإنجاز الفعلي", target_unit: "وحدة القياس", goal_revision: "إصدار الهدف", goal_edit_reason: "سبب تعديل الهدف", goal_edited_at: "وقت تعديل الهدف", goal_edited_by: "منفذ تعديل الهدف", deleted_at: "وقت حذف الهدف", deleted_by: "حذف الهدف بواسطة", delete_reason: "سبب حذف الهدف", report_revision: "رقم التعديل", report_edit_reason: "سبب تعديل التقرير", report_edited_at: "وقت التعديل", report_edited_by: "منفذ التعديل", username: "اسم المستخدم", full_name: "الاسم", role: "الصلاحية", branch_id: "الفرع", employee_id: "الموظف المرتبط", employee_number: "الرقم الوظيفي", status: "الحالة", hired_on: "تاريخ التعيين", zkt_user_id: "كود البصمة", job_title_id: "الوظيفة", department_id: "القسم", event_type: "نوع الإجراء", effective_date: "تاريخ الإجراء", end_date: "تاريخ النهاية", reason: "السبب", amount: "المبلغ", amount_unit: "وحدة المبلغ", decision_reason: "سبب القرار", attendance_date: "تاريخ الحضور", first_in: "وقت الدخول", last_out: "وقت الخروج", exception_note: "ملاحظة البصمة", period_month: "شهر التقييم", total_score: "النتيجة", max_score: "أعلى نتيجة", evaluator_id: "المقيّم", created_by: "سُجل بواسطة", approved_by: "اعتمده" };
const actionLabels = { INSERT: "إضافة", UPDATE: "تعديل", DELETE: "حذف" };
const fmt = (value: unknown) => value == null || value === "" ? "—" : typeof value === "object" ? JSON.stringify(value) : toWesternDigits(String(value));

export default function AuditLog({ rows }: { rows: AuditRow[] }) {
  const [search, setSearch] = useState("");
  const [branch, setBranch] = useState("all");
  const [action, setAction] = useState("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const branches = useMemo(() => [...new Map(rows.filter((row) => row.branch).map((row) => [row.branch_id, row.branch!.name])).entries()], [rows]);
  const visible = useMemo(() => rows.filter((row) => {
    const employeeName = row.employee?.full_name || [row.employee?.first_name, row.employee?.last_name].filter(Boolean).join(" ") || "";
    const haystack = [tableLabels[row.entity_table] ?? row.entity_table, employeeName, row.employee?.employee_number, row.branch?.name, row.actor?.full_name, ...row.changed_fields].filter(Boolean).join(" ").toLocaleLowerCase("ar");
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Tripoli", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(row.created_at));
    return (action === "all" || row.action === action) && (branch === "all" || row.branch_id === branch) && (!fromDate || day >= fromDate) && (!toDate || day <= toDate) && (!search || haystack.includes(search.trim().toLocaleLowerCase("ar")));
  }), [rows, action, branch, search, fromDate, toDate]);

  const renderDetails = (row: AuditRow) => {
    const before = row.old_data ?? {};
    const after = row.new_data ?? {};
    return <details><summary>تفاصيل التغيير</summary><dl>
      {row.changed_fields.map((field) => <div key={field}>
        <dt>{fieldLabels[field] ?? field}</dt>
        <dd>{row.action !== "INSERT" && <span>قبل: {fmt(before[field])}</span>}{row.action !== "DELETE" && <span>بعد: {fmt(after[field])}</span>}</dd>
      </div>)}
    </dl></details>;
  };
  const renderAction = (row: AuditRow) => <span className={`audit-action ${row.action.toLowerCase()}`}>{row.entity_table === "employee_goals" && row.action === "UPDATE" && row.new_data?.deleted_at && !row.old_data?.deleted_at ? "حذف هدف" : actionLabels[row.action]}</span>;
  const renderTimestamp = (row: AuditRow) => new Intl.DateTimeFormat("ar-LY", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Tripoli" }).format(new Date(row.created_at));
  const employeeName = (row: AuditRow) => row.employee?.full_name || [row.employee?.first_name, row.employee?.last_name].filter(Boolean).join(" ") || "—";

  return <div className="audit-log-content" dir="rtl">
    <section className="panel audit-filters"><label className="audit-search"><span>بحث</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="الموظف، الفرع، المنفذ، نوع التغيير…" /></label><label><span>الفرع</span><select value={branch} onChange={(event) => setBranch(event.target.value)}><option value="all">كل الفروع</option>{branches.map(([id, name]) => <option key={id} value={id ?? ""}>{name}</option>)}</select></label><label><span>العملية</span><select value={action} onChange={(event) => setAction(event.target.value)}><option value="all">الكل</option><option value="INSERT">إضافة</option><option value="UPDATE">تعديل</option><option value="DELETE">حذف</option></select></label><label><span>من تاريخ</span><input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} /></label><label><span>إلى تاريخ</span><input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} /></label><strong>{toWesternDigits(visible.length)} حركة</strong></section>
    <section className="panel audit-table-panel">
      <div className="audit-entry-cards">{visible.length ? visible.map((row) => <article className="audit-entry-card" key={row.id}>
        <header><div>{renderAction(row)}<span className="audit-card-entity">{tableLabels[row.entity_table] ?? row.entity_table}</span></div><time dir="ltr">{renderTimestamp(row)}</time></header>
        <div className="audit-card-grid"><span><small>الموظف</small><b>{employeeName(row)}{row.employee?.employee_number && <small dir="ltr">{toWesternDigits(row.employee.employee_number)}</small>}</b></span><span><small>الفرع</small><b>{row.branch?.name ?? "—"}</b></span><span><small>بواسطة</small><b>{row.actor?.full_name ?? "مستخدم النظام"}</b></span></div>
        <div className="audit-card-fields"><small>الحقول المتغيرة</small><span>{row.changed_fields.map((field) => fieldLabels[field] ?? field).join("، ") || "—"}</span></div>
        {renderDetails(row)}
      </article>) : <p className="audit-card-empty">لا توجد حركات تطابق البحث والفلاتر.</p>}</div>
      <div className="audit-table-wrap"><table className="audit-table">
        <thead><tr><th>التاريخ والوقت</th><th>العملية</th><th>السجل</th><th>الموظف</th><th>الفرع</th><th>بواسطة</th><th>الحقول المتغيرة</th><th>التفاصيل</th></tr></thead>
        <tbody>{visible.length ? visible.map((row) => {
          return <tr key={row.id}>
            <td dir="ltr">{renderTimestamp(row)}</td>
            <td>{renderAction(row)}</td>
            <td>{tableLabels[row.entity_table] ?? row.entity_table}</td>
            <td>{employeeName(row)}{row.employee?.employee_number && <small dir="ltr">{toWesternDigits(row.employee.employee_number)}</small>}</td>
            <td>{row.branch?.name ?? "—"}</td><td>{row.actor?.full_name ?? "مستخدم النظام"}</td>
            <td>{row.changed_fields.map((field) => fieldLabels[field] ?? field).join("، ") || "—"}</td>
            <td>{renderDetails(row)}</td>
          </tr>;
        }) : <tr><td colSpan={8} className="empty-table">لا توجد حركات تطابق البحث. تظهر التغييرات الجديدة بعد تطبيق تحديث سجل التدقيق.</td></tr>}</tbody>
      </table></div>
      <p className="audit-note">نعرض آخر {toWesternDigits(rows.length)} حركة. بيانات الراتب والهوية الخام مستثناة من سجل التدقيق.</p>
    </section>
  </div>;
}
