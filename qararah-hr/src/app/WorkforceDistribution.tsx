"use client";

import { Fragment, useState } from "react";
import { toWesternDigits } from "@/lib/digits";
import WorkforceEmployeeModal from "./WorkforceEmployeeModal";

type WorkforceEmployee = {
  id: string;
  employee_number: string;
  first_name: string;
  last_name: string | null;
  full_name?: string | null;
  status: string;
  hired_on: string | null;
  job_title: { name: string } | null;
  branch: { name: string } | null;
  department: { name: string } | null;
};

export default function WorkforceDistribution({ employees, canManage, canAuditEvaluate }: { employees: WorkforceEmployee[]; canManage: boolean; canAuditEvaluate: boolean }) {
  const [selectedTitle, setSelectedTitle] = useState<string | null>(null);
  const [selectedEmployee, setSelectedEmployee] = useState<WorkforceEmployee | null>(null);
  const groups = new Map<string, WorkforceEmployee[]>();

  for (const employee of employees) {
    const title = employee.job_title?.name?.trim() || "بدون مسمى وظيفي";
    groups.set(title, [...(groups.get(title) ?? []), employee]);
  }

  const sortedGroups = [...groups.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], "ar"));
  const selectedEmployees = selectedTitle ? groups.get(selectedTitle) ?? [] : [];

  return <>
    <div className="workforce-grid">{sortedGroups.length ? sortedGroups.map(([title, members]) => <Fragment key={title}>
      <button className={`workforce-item${selectedTitle === title ? " selected" : ""}`} type="button" aria-expanded={selectedTitle === title} aria-controls={selectedTitle === title ? "workforce-employee-list" : undefined} onClick={() => setSelectedTitle((current) => current === title ? null : title)}><span>{title}</span><strong>{toWesternDigits(members.length)}</strong></button>
      {selectedTitle === title && <div className="workforce-employee-list" id="workforce-employee-list" aria-live="polite">
        <div className="workforce-employee-list-heading"><div><h3>موظفو صفة: {title}</h3><span>{toWesternDigits(selectedEmployees.length)} موظف</span></div><button type="button" onClick={() => setSelectedTitle(null)}>إغلاق</button></div>
        {selectedEmployees.length ? <ul>{selectedEmployees.map((employee) => {
          const name = employee.full_name || [employee.first_name, employee.last_name].filter(Boolean).join(" ") || "موظف بدون اسم";
          return <li key={employee.id}><span className="workforce-employee-avatar" aria-hidden="true">{name.charAt(0)}</span><button type="button" className="workforce-employee-open" onClick={() => setSelectedEmployee(employee)} aria-haspopup="dialog">{name}</button><span className="workforce-employee-number">{toWesternDigits(employee.employee_number)}</span></li>;
        })}</ul> : <p className="empty-message">لا يوجد موظفون نشطون بهذه الصفة.</p>}
      </div>}
    </Fragment>) : <p className="empty-message">لا توجد بيانات موظفين.</p>}</div>
    {selectedEmployee && <WorkforceEmployeeModal employee={selectedEmployee} canManage={canManage} canAuditEvaluate={canAuditEvaluate} onClose={() => setSelectedEmployee(null)} />}
  </>;
}
