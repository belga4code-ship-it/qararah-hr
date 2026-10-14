"use client";

import { useState, type FormEvent } from "react";
import { saveEmployeeCredentials } from "./credentials-actions";

const roles = [
  ["employee", "موظف"], ["accountant", "محاسب"], ["branch_manager", "مدير فرع"],
  ["auditor", "مراجع حسابات"], ["yard_supervisor", "مسؤول ساحة"],
];
const permissions = [
  ["employees.view_all", "مشاهدة الموظفين في كل الفروع"],
  ["employees.view_sensitive", "مشاهدة البيانات الشخصية والمالية الحساسة"],
  ["employees.edit", "تعديل ملفات الموظفين"],
  ["employees.manage_accounts", "إدارة حسابات الدخول والصفات"],
  ["attendance.view_all", "مشاهدة الحضور في كل الفروع"],
  ["attendance.manage", "تعديل ومراجعة الحضور"],
  ["attendance.import", "استيراد ملفات الحضور"],
  ["effects.view_all", "مشاهدة المؤثرات في كل الفروع"],
  ["effects.create", "إنشاء الطلبات والإجراءات"],
  ["effects.approve", "اعتماد أو رفض الطلبات"],
  ["effects.manage_deductions", "تسجيل واعتماد الخصومات"],
  ["goals.view_all", "مشاهدة أهداف الموظفين"], ["goals.manage", "إضافة وتعديل الأهداف"],
  ["evaluations.view_all", "مشاهدة تقييمات الموظفين"], ["evaluations.evaluate", "تقييم الموظفين"],
  ["evaluations.assign", "تعيين المقيّمين"], ["reports.view_all", "مشاهدة التقارير"],
  ["reports.export", "تصدير التقارير"], ["audit.view", "مشاهدة سجل التدقيق"],
];

export default function EmployeeCredentials({ employeeId, initialUsername, initialRole, initialRoles, initialPermissions, initialBranchId, branches, canAssignAdmin }: {
  employeeId: string; initialUsername: string; initialRole: string; initialRoles: string[]; initialPermissions: string[];
  initialBranchId: string; branches: { id: string; name: string }[]; canAssignAdmin: boolean;
}) {
  const [username, setUsername] = useState(initialUsername);
  const [password, setPassword] = useState("");
  const permittedRoles = [...roles, ...(canAssignAdmin || initialRoles.includes("hr") ? [["hr", "مدير الموارد البشرية"]] : []), ...(canAssignAdmin ? [["admin", "مدير النظام"]] : [])];
  const [selectedRoles, setSelectedRoles] = useState<string[]>(initialRoles.length ? initialRoles : [initialRole || "employee"]);
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>(initialPermissions);
  const [branchId, setBranchId] = useState(initialBranchId);
  const [showAccessModal, setShowAccessModal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const isBranchScoped = selectedRoles.some((role) => ["employee", "accountant", "branch_manager", "yard_supervisor"].includes(role));

  function toggle(value: string, values: string[], setter: (next: string[]) => void) {
    setter(values.includes(value) ? values.filter((item) => item !== value) : [...values, value]);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      const result = await saveEmployeeCredentials(employeeId, { username, password, roles: selectedRoles, additionalPermissions: selectedPermissions, branchId });
      if (result.error) throw new Error(result.error);
      setUsername(result.username ?? username.trim().toLowerCase());
      setPassword("");
      setNotice({ text: "تم حفظ الحساب والصفات والصلاحيات الإضافية.", error: false });
    } catch (error) {
      setNotice({ text: error instanceof Error ? error.message : "تعذر حفظ حساب الدخول.", error: true });
    } finally {
      setBusy(false);
    }
  }

  return <section className="panel employee-form-section"><div className="panel-heading"><div><h2>حساب الدخول والصلاحيات</h2><p>يمكن ربط الحساب بأكثر من صفة وإضافة صلاحيات خاصة بهذا المستخدم.</p></div></div><form onSubmit={submit}><div className="employee-fields-grid">
    <label className="employee-field"><span>اسم المستخدم</span><input value={username} onChange={(event) => setUsername(event.target.value.toLowerCase())} dir="ltr" autoComplete="off" required minLength={3} maxLength={32} pattern="[A-Za-z0-9][A-Za-z0-9._-]{2,31}" placeholder="مثال: belga" /></label>
    <label className="employee-field"><span>كلمة المرور{initialUsername ? " (اتركها فارغة للإبقاء عليها)" : ""}</span><input value={password} onChange={(event) => setPassword(event.target.value)} dir="ltr" type="password" autoComplete="new-password" minLength={6} required={!initialUsername} placeholder={initialUsername ? "••••••••" : "6 أحرف على الأقل"} /></label>
    <div className="employee-field"><span>الصفات ({selectedRoles.length})</span><button className="access-configure-button" type="button" onClick={() => setShowAccessModal(true)}>{selectedRoles.map((role) => permittedRoles.find(([key]) => key === role)?.[1] ?? role).join("، ") || "اختر الصفات"}<b>تعديل</b></button></div>
    <div className="employee-field"><span>صلاحيات إضافية ({selectedPermissions.length})</span><button className="access-configure-button" type="button" onClick={() => setShowAccessModal(true)}>{selectedPermissions.length ? `تم تحديد ${selectedPermissions.length} صلاحيات إضافية` : "لم تُضف صلاحيات إضافية"}<b>تخصيص</b></button></div>
    {isBranchScoped && <label className="employee-field"><span>الفرع</span><select required value={branchId} onChange={(event) => setBranchId(event.target.value)}><option value="">اختر الفرع</option>{branches.map((branch) => <option value={branch.id} key={branch.id}>{branch.name}</option>)}</select></label>}
  </div>{notice && <p className={`employee-save-message ${notice.error ? "error" : "success"}`} role="status">{notice.text}</p>}<div className="employee-save-row"><button className="primary-button employee-save-button" disabled={busy || selectedRoles.length === 0}>{busy ? "جارٍ حفظ الحساب…" : initialUsername ? "حفظ حساب الدخول" : "إنشاء حساب الدخول"}</button></div></form>
    {showAccessModal && <div className="access-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowAccessModal(false); }}><section className="access-modal" role="dialog" aria-modal="true" aria-labelledby="access-modal-title"><header><div><span>إعداد الحساب</span><h2 id="access-modal-title">الصفات والصلاحيات</h2></div><button type="button" aria-label="إغلاق" onClick={() => setShowAccessModal(false)}>×</button></header><p className="access-modal-hint">اختر صفة الموظف الأساسية أو أكثر من صفة. صلاحيات كل صفة تُضاف تلقائيًا، ويمكن منح أذونات خاصة من القسم التالي.</p><div className="access-modal-body"><section className="access-modal-section access-roles-section"><h3>الصفات الوظيفية الأساسية</h3><p>مثل موظف، محاسب، مدير فرع، مراجع حسابات أو مسؤول ساحة.</p><div className="access-role-options">{permittedRoles.map(([value, label]) => <label key={value}><input type="checkbox" checked={selectedRoles.includes(value)} onChange={() => toggle(value, selectedRoles, setSelectedRoles)} /><span>{label}</span></label>)}</div></section><section className="access-modal-section access-permissions-section"><h3>صلاحيات إضافية لهذا الحساب</h3><div className="access-permission-list">{permissions.map(([value, label]) => <label key={value}><input type="checkbox" checked={selectedPermissions.includes(value)} onChange={() => toggle(value, selectedPermissions, setSelectedPermissions)} /><span>{label}</span></label>)}</div></section></div><footer><button className="secondary-button" type="button" onClick={() => setShowAccessModal(false)}>إلغاء</button><button className="primary-button" type="button" onClick={() => setShowAccessModal(false)}>تم</button></footer></section></div>}
  </section>;
}
