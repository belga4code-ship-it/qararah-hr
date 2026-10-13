"use client";

import { useState, type FormEvent } from "react";
import { saveEmployeeCredentials } from "./credentials-actions";

const roles = [
  ["employee", "موظف"],
  ["accountant", "محاسب"],
  ["branch_manager", "مدير فرع"],
  ["auditor", "مراجع حسابات"],
];

export default function EmployeeCredentials({ employeeId, initialUsername, initialRole, initialBranchId, branches, canAssignAdmin }: { employeeId: string; initialUsername: string; initialRole: string; initialBranchId: string; branches: { id: string; name: string }[]; canAssignAdmin: boolean }) {
  const [username, setUsername] = useState(initialUsername);
  const [password, setPassword] = useState("");
  const [role, setRole] = useState(initialRole || "employee");
  const [branchId, setBranchId] = useState(initialBranchId);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const roleOptions = [...roles, ...(canAssignAdmin || initialRole === "hr" ? [["hr", "مدير الموارد البشرية"]] : []), ...(canAssignAdmin ? [["admin", "مدير النظام"]] : [])];

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      const result = await saveEmployeeCredentials(employeeId, { username, password, role, branchId });
      if (result.error) throw new Error(result.error);
      setUsername(result.username ?? username.trim().toLowerCase());
      setPassword("");
      setNotice({ text: "تم حفظ حساب الدخول. الموظف يستطيع تسجيل الدخول باسم المستخدم الجديد.", error: false });
    } catch (error) {
      setNotice({ text: error instanceof Error ? error.message : "تعذر حفظ حساب الدخول.", error: true });
    } finally {
      setBusy(false);
    }
  }

  return <section className="panel employee-form-section"><div className="panel-heading"><div><h2>حساب الدخول والصلاحية</h2><p>أنشئ حساب الموظف أو غيّر اسم المستخدم وكلمة المرور والصلاحية من هنا.</p></div></div><form onSubmit={submit}><div className="employee-fields-grid">
    <label className="employee-field"><span>اسم المستخدم</span><input value={username} onChange={(event) => setUsername(event.target.value.toLowerCase())} dir="ltr" autoComplete="off" required minLength={3} maxLength={32} pattern="[A-Za-z0-9][A-Za-z0-9._-]{2,31}" placeholder="مثال: belga" /></label>
    <label className="employee-field"><span>كلمة المرور{initialUsername ? " (اتركها فارغة للإبقاء عليها)" : ""}</span><input value={password} onChange={(event) => setPassword(event.target.value)} dir="ltr" type="password" autoComplete="new-password" minLength={6} required={!initialUsername} placeholder={initialUsername ? "••••••••" : "6 أحرف على الأقل"} /></label>
    <label className="employee-field"><span>صلاحية الحساب</span><select value={role} onChange={(event) => setRole(event.target.value)}>{roleOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    {!["admin", "hr", "auditor"].includes(role) && <label className="employee-field"><span>الفرع</span><select required value={branchId} onChange={(event) => setBranchId(event.target.value)}><option value="">اختر الفرع</option>{branches.map((branch) => <option value={branch.id} key={branch.id}>{branch.name}</option>)}</select></label>}
  </div>{notice && <p className={`employee-save-message ${notice.error ? "error" : "success"}`} role="status">{notice.text}</p>}<div className="employee-save-row"><button className="primary-button employee-save-button" disabled={busy}>{busy ? "جارٍ حفظ الحساب…" : initialUsername ? "حفظ حساب الدخول" : "إنشاء حساب الدخول"}</button></div></form></section>;
}
