"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { toWesternDigits } from "@/lib/digits";

export type EmployeeListRow = {
  id: string;
  employee_number: string;
  first_name: string;
  last_name: string | null;
  full_name: string | null;
  zkt_user_id: string | null;
  status: string;
  branch: { name: string } | null;
  department: { name: string } | null;
  job_title: { name: string } | null;
};

const statusLabels: Record<string, string> = { active: "نشط", on_leave: "في إجازة", suspended: "موقوف", terminated: "منتهي الخدمة", needs_review: "يحتاج مراجعة" };

export default function EmployeesList({ employees, canEdit }: { employees: EmployeeListRow[]; canEdit: boolean }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const summary = [
    { label: "إجمالي الموظفين", count: employees.length, note: "كل السجلات", tone: "total", icon: "♙" },
    { label: "موظفون نشطون", count: employees.filter((employee) => employee.status === "active").length, note: "على رأس العمل", tone: "active", icon: "✓" },
    { label: "تحتاج مراجعة", count: employees.filter((employee) => employee.status === "needs_review").length, note: "تحقق من بياناتهم", tone: "review", icon: "!" },
    { label: "بدون كود بصمة", count: employees.filter((employee) => !employee.zkt_user_id).length, note: "تحتاج استكمال", tone: "missing", icon: "◉" },
  ];
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("ar");
    return employees.filter((employee) => {
      const name = employee.full_name || [employee.first_name, employee.last_name].filter(Boolean).join(" ");
      const matchesText = !needle || [name, employee.employee_number, employee.zkt_user_id, employee.branch?.name, employee.department?.name, employee.job_title?.name].some((value) => value && toWesternDigits(value).toLocaleLowerCase("ar").includes(needle));
      return matchesText && (status === "all" || employee.status === status);
    });
  }, [employees, query, status]);

  return <>
    <div className="employee-stats-grid" aria-label="ملخص الموظفين">{summary.map((item) => <article className={`employee-stat-card ${item.tone}`} key={item.tone}><div className="employee-stat-top"><span>{item.label}</span><span className="employee-stat-icon" aria-hidden="true">{item.icon}</span></div><strong>{toWesternDigits(item.count)}</strong><small>{item.note}</small></article>)}</div>
    <div className="employee-tools"><label className="employee-search"><span aria-hidden="true">⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ابحث بالاسم أو الكود أو القسم أو الفرع" aria-label="ابحث عن موظف" /></label><label className="employee-filter"><span>الحالة</span><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">كل الحالات</option>{Object.entries(statusLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><span className="employee-result-count">{toWesternDigits(filtered.length)} من {toWesternDigits(employees.length)} موظف</span></div>
    <div className="table-wrap employees-table-wrap"><table className="employees-list-table"><thead><tr><th>الكود الوظيفي</th><th>اسم الموظف</th><th>كود البصمة</th><th>الوظيفة</th><th>القسم</th><th>الفرع</th><th>الحالة</th><th>الإجراء</th></tr></thead><tbody>{filtered.length ? filtered.map((employee) => {
      const name = employee.full_name || [employee.first_name, employee.last_name].filter(Boolean).join(" ");
      return <tr key={employee.id}><td className="code-cell">{toWesternDigits(employee.employee_number)}</td><td><div className="employee-cell"><span className="employee-avatar">{name.charAt(0) || "؟"}</span><strong>{name}</strong></div></td><td className="code-cell">{toWesternDigits(employee.zkt_user_id ?? "—")}</td><td>{employee.job_title?.name ?? "—"}</td><td>{employee.department?.name ?? "—"}</td><td>{employee.branch?.name ?? "—"}</td><td><span className={`status-pill ${employee.status === "active" ? "green" : "amber"}`}>{statusLabels[employee.status] ?? employee.status}</span></td><td><Link className="employee-open-link" href={`/employees/${employee.id}`}>{canEdit ? "فتح الملف وتعديل" : "فتح الملف"}<span aria-hidden="true">←</span></Link></td></tr>;
    }) : <tr><td colSpan={8} className="empty-table">{employees.length ? "ما لقيناش موظف يطابق البحث." : "ما فيش موظفين في قاعدة البيانات لحد الآن. استورد ملف Excel لإضافة السجلات."}</td></tr>}</tbody></table></div>
  </>;
}
