"use client";

import { useState } from "react";
import EmployeeCredentials from "./EmployeeCredentials";
import EmployeeEditor, { type EditValues } from "./EmployeeEditor";
import EmployeeResponsibles from "./EmployeeResponsibles";

type Option = { id: string; name: string };
type Evaluator = { id: string; employee_id: string; name: string };
type ProfileGoal = { id: string; period_month: string; title: string; target_value: number | null; actual_value: number | null; target_unit: string | null };
type ProfileEvaluation = { id: string; period_month: string; total_score: number | null; max_score: number | null; status: string; notes: string | null };
type ProfileRequest = { id: string; event_type: string; effective_date: string; end_date: string | null; status: string; reason: string | null; decision_reason: string | null; created_at: string };

export default function EmployeeProfileTabs({ employeeId, initialValues, canEdit, canManageAccounts, canAssignResponsibilities, branches, departments, jobTitles, initialUsername, initialRole, initialRoles, initialPermissions, initialBranchId, canAssignAdmin, evaluators, assignedEvaluatorIds, initialResponsibleIds, managers, goals, evaluations, requests }: {
  employeeId: string; initialValues: EditValues; canEdit: boolean; canManageAccounts: boolean; canAssignResponsibilities: boolean;
  branches: Option[]; departments: Option[]; jobTitles: (Option & { department_id: string | null })[];
  initialUsername: string; initialRole: string; initialRoles: string[]; initialPermissions: string[]; initialBranchId: string; canAssignAdmin: boolean;
  evaluators: Evaluator[]; assignedEvaluatorIds: string[]; initialResponsibleIds: string[]; managers: Array<{ profileId: string; employeeId: string; name: string }>;
  goals: ProfileGoal[]; evaluations: ProfileEvaluation[]; requests: ProfileRequest[];
}) {
  const [activeTab, setActiveTab] = useState("information");
  const tabs = [
    { id: "information", label: "المعلومات" },
    { id: "account", label: "دخول النظام والصلاحيات" },
    { id: "responsibles", label: "المسؤولون" },
    { id: "goals", label: `الأهداف (${goals.length})` },
    { id: "evaluations", label: `التقييمات (${evaluations.length})` },
    { id: "requests", label: `الطلبات (${requests.length})` },
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
    <section id="employee-tab-goals" role="tabpanel" aria-labelledby="employee-tab-button-goals" hidden={activeTab !== "goals"} className="employee-profile-activity">
      {goals.length ? goals.map((goal) => <article className="panel employee-profile-record" key={goal.id}><header><strong>{goal.title}</strong><span>{goal.period_month}</span></header><p>المستهدف: {goal.target_value ?? "—"} {goal.target_unit ?? ""}<b>النتيجة الفعلية: {goal.actual_value ?? "لم تسجل"} {goal.target_unit ?? ""}</b></p></article>) : <div className="panel employee-tab-locked"><strong>لا توجد أهداف مسجلة</strong><p>ستظهر أهداف الموظف هنا عند إضافتها.</p></div>}
    </section>
    <section id="employee-tab-evaluations" role="tabpanel" aria-labelledby="employee-tab-button-evaluations" hidden={activeTab !== "evaluations"} className="employee-profile-activity">
      {evaluations.length ? evaluations.map((evaluation) => <article className="panel employee-profile-record" key={evaluation.id}><header><strong>تقييم {evaluation.period_month}</strong><span>{evaluation.total_score ?? "—"} / {evaluation.max_score ?? "—"}</span></header><p>الحالة: {evaluation.status}{evaluation.notes && <b>{evaluation.notes}</b>}</p></article>) : <div className="panel employee-tab-locked"><strong>لا توجد تقييمات مسجلة</strong><p>ستظهر التقييمات التي يمكن للمستخدم الاطلاع عليها هنا.</p></div>}
    </section>
    <section id="employee-tab-requests" role="tabpanel" aria-labelledby="employee-tab-button-requests" hidden={activeTab !== "requests"} className="employee-profile-activity">
      {requests.length ? requests.map((request) => <article className="panel employee-profile-record" key={request.id}><header><strong>{request.event_type === "leave" ? "إجازة" : request.event_type === "permission" ? "إذن خروج" : request.event_type === "late" ? "تأخير" : request.event_type}</strong><span>{request.status}</span></header><p>الفترة: {request.effective_date}{request.end_date && request.end_date !== request.effective_date ? ` — ${request.end_date}` : ""}{request.reason && <b>السبب: {request.reason}</b>}{request.decision_reason && <b>سبب القرار: {request.decision_reason}</b>}</p></article>) : <div className="panel employee-tab-locked"><strong>لا توجد طلبات مسجلة</strong><p>ستظهر الإجازات والأذونات والقرارات المرتبطة بالموظف هنا.</p></div>}
    </section>
  </div>;
}
