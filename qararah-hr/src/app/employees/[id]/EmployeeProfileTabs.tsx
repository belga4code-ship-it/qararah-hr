"use client";

import { useState } from "react";
import EmployeeCredentials from "./EmployeeCredentials";
import EmployeeEditor, { type EditValues } from "./EmployeeEditor";
import EmployeeResponsibles from "./EmployeeResponsibles";

type Option = { id: string; name: string };
type Evaluator = { id: string; employee_id: string; name: string };

export default function EmployeeProfileTabs({ employeeId, initialValues, canEdit, canManageAccounts, canAssignResponsibilities, branches, departments, jobTitles, initialUsername, initialRole, initialRoles, initialPermissions, initialBranchId, canAssignAdmin, evaluators, assignedEvaluatorIds, initialResponsibleIds, managers }: {
  employeeId: string; initialValues: EditValues; canEdit: boolean; canManageAccounts: boolean; canAssignResponsibilities: boolean;
  branches: Option[]; departments: Option[]; jobTitles: (Option & { department_id: string | null })[];
  initialUsername: string; initialRole: string; initialRoles: string[]; initialPermissions: string[]; initialBranchId: string; canAssignAdmin: boolean;
  evaluators: Evaluator[]; assignedEvaluatorIds: string[]; initialResponsibleIds: string[]; managers: Array<{ profileId: string; employeeId: string; name: string }>;
}) {
  const [activeTab, setActiveTab] = useState("information");
  const tabs = [
    { id: "information", label: "المعلومات" },
    { id: "account", label: "دخول النظام والصلاحيات" },
    { id: "responsibles", label: "المسؤولون" },
  ];

  return <div className="employee-profile-tabs">
    <nav className="employee-profile-tab-list" aria-label="أقسام ملف الموظف" role="tablist">
      {tabs.map((tab) => <button key={tab.id} type="button" role="tab" aria-selected={activeTab === tab.id} aria-controls={`employee-tab-${tab.id}`} id={`employee-tab-button-${tab.id}`} className={activeTab === tab.id ? "active" : ""} onClick={() => setActiveTab(tab.id)}>{tab.label}</button>)}
    </nav>
    <section id="employee-tab-information" role="tabpanel" aria-labelledby="employee-tab-button-information" hidden={activeTab !== "information"}>
      <EmployeeEditor employeeId={employeeId} initialValues={initialValues} canEdit={canEdit} branches={branches} departments={departments} jobTitles={jobTitles} />
    </section>
    <section id="employee-tab-account" role="tabpanel" aria-labelledby="employee-tab-button-account" hidden={activeTab !== "account"}>
      {canManageAccounts ? <EmployeeCredentials employeeId={employeeId} initialUsername={initialUsername} initialRole={initialRole} initialRoles={initialRoles} initialPermissions={initialPermissions} initialBranchId={initialBranchId} branches={branches} canAssignAdmin={canAssignAdmin} /> : <div className="panel employee-tab-locked"><strong>صلاحيات حساب الدخول</strong><p>إدارة حساب الدخول والصفات والصلاحيات متاحة للموارد البشرية ومدير النظام فقط.</p></div>}
    </section>
    <section id="employee-tab-responsibles" role="tabpanel" aria-labelledby="employee-tab-button-responsibles" hidden={activeTab !== "responsibles"}>
      <EmployeeResponsibles employeeId={employeeId} initialResponsibleIds={initialResponsibleIds} managers={managers} evaluators={evaluators} initialEvaluatorIds={assignedEvaluatorIds} canAssign={canAssignResponsibilities} />
    </section>
  </div>;
}
