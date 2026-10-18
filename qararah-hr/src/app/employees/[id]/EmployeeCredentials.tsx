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

const branchManagerPermissions = [
  "عرض موظفي الفرع وملفاتهم الوظيفية",
  "متابعة الحضور والانصراف في الفرع وتصدير تقاريره",
  "عرض مؤثرات الفرع والطلبات والبلاغات",
  "تقديم طلب إجازة أو إذن أو تأخير نيابة عن موظف بالفرع",
  "اعتماد الطلبات المحالة له ضمن مسار الموافقة",
  "إرسال بلاغ نيابة عن موظف بالفرع",
  "تقديم طلب تعيين جديد ينتظر موافقة الإدارة",
];

const roleGuides: Record<string, { scope: string; summary: string; permissions: string[] }> = {
  employee: { scope: "بيانات الموظف نفسه", summary: "صفة الموظف الأساسية. تتيح له متابعة ملفه وطلباته الشخصية، ولا تمنحه مشاهدة ملفات زملائه أو تقارير الفروع.", permissions: ["عرض بيانات الملف الوظيفي الخاص به", "متابعة طلبات الإجازة والإذن والتأخير التي تخصه", "إنشاء طلب إجازة", "إنشاء طلب إذن خروج أو تأخير", "إرسال بلاغ ومتابعة حالته", "عرض أهدافه وتقدمه", "عرض تقييماته الموجهة إليه", "عدم عرض بيانات الموظفين الآخرين أو تقارير الفروع"] },
  accountant: { scope: "بحسب الفرع ومسار الاعتماد", summary: "تتيح الصفة أدوات متابعة الحسابات والحضور، وتبقى إجراءات الخصم والاعتماد مرتبطة بالصلاحيات ومسارات الموافقة الممنوحة للحساب.", permissions: ["فتح شاشة الحضور والانصراف", "متابعة سجلات الحضور ضمن نطاق الحساب", "متابعة الطلبات المحالة إليه في مسار الاعتماد", "اعتماد طلبات الحسابات عندما يكون هو المعتمد الحالي", "عرض بيانات الموظفين بالقدر الذي تسمح به صلاحيات الحساب", "تسجيل الخصومات عند منحه صلاحية الخصومات", "اعتماد الخصومات عند منحه صلاحية اعتمادها", "لا تمنح الصفة وحدها صلاحية إدارة الحسابات أو الصفات"] },
  branch_manager: { scope: "فرع الموظف المحدد فقط", summary: "مدير الفرع يتابع شؤون موظفي فرعه ويقدم الطلبات نيابة عنهم. الطلبات التي تتطلب موافقة الإدارة تبقى معلقة إلى أن تبت فيها الإدارة.", permissions: ["عرض قائمة موظفي الفرع وملفاتهم الوظيفية", "متابعة حضور وانصراف موظفي الفرع", "استخراج تقارير الحضور الخاصة بالفرع", "عرض طلبات الإجازات والأذونات والتأخير في الفرع", "إنشاء طلب إجازة نيابة عن موظف في الفرع", "إنشاء طلب إذن خروج أو تأخير نيابة عن موظف في الفرع", "إرسال بلاغ نيابة عن موظف أو عن واقعة في الفرع", "اعتماد الطلبات التي تحال إليه ضمن مسار الموافقة", "إرسال طلب تعيين لموظف جديد في الفرع", "يبقى طلب التعيين معلقًا حتى موافقة الإدارة", "لا يطّلع على بيانات الفروع الأخرى", "لا يدير حسابات الدخول أو يمنح صلاحيات النظام"] },
  auditor: { scope: "حسب نطاق المراجعة ومسارات الاعتماد", summary: "مراجع الحسابات يراجع المسائل المالية والطلبات المحالة إليه، ويعتمد الخصومات ضمن الصلاحية الممنوحة له.", permissions: ["مراجعة بيانات الحضور والتقارير المسموح بها", "عرض الطلبات المالية والخصومات", "تسجيل الخصومات مع توثيق السبب", "اعتماد أو رفض الخصم عند امتلاكه صلاحية الاعتماد", "اعتماد طلبات المحاسبين عندما يحال الطلب إليه", "إضافة تقييم للموظف إذا كان ضمن المقيّمين المعيّنين", "لا يدير حسابات الدخول أو الصفات"] },
  yard_supervisor: { scope: "نطاق الساحة والفرع المحدد للحساب", summary: "صفة إشرافية لمتابعة العاملين والسجلات المتعلقة بالساحة. تُضبط صلاحيات الموظفين والطلبات الإضافية حسب الحساب.", permissions: ["متابعة سجلات الحضور المتاحة ضمن نطاقه", "متابعة الموظفين الذين يسمح نطاق الحساب بعرضهم", "عرض الطلبات المحالة إليه فقط", "تقديم الطلبات الشخصية بصفة الموظف عند وجودها", "لا تمنح الصفة وحدها اعتماد الخصومات", "لا تمنح الصفة وحدها مشاهدة كل الفروع أو تقاريرها", "يمكن إضافة صلاحيات أخرى من إعدادات الحساب"] },
  hr: { scope: "جميع الفروع", summary: "مدير الموارد البشرية يتابع ملفات الموظفين والإجراءات الإدارية ومسارات الإجازات على مستوى الشركة.", permissions: ["عرض ملفات الموظفين في الفروع", "إدارة بيانات الموظفين وفق الصلاحيات المتاحة", "متابعة طلبات وإجراءات الموظفين", "الموافقة على طلبات الإجازة المحالة للموارد البشرية", "متابعة سجلات الحضور والانصراف", "استيراد ملفات الحضور عند توفر صلاحية الاستيراد", "إعداد ومراجعة تقارير الموارد البشرية", "إدارة حسابات وصفات الموظفين إذا منحه مدير النظام ذلك", "لا يملك صلاحيات مدير النظام تلقائيًا"] },
  admin: { scope: "النظام وجميع الفروع", summary: "مدير النظام يدير إعدادات الحسابات والصلاحيات ويشرف على إجراءات النظام عبر الفروع.", permissions: ["عرض وإدارة بيانات جميع الفروع", "إدارة حسابات الدخول وربطها بالموظفين", "تعيين صفات الموظفين وصلاحياتهم الإضافية", "اعتماد أو رفض الطلبات والإجراءات", "تسجيل وإدارة الخصومات", "عرض الحضور والتقارير وتصديرها", "إدارة الأهداف والتقييمات والمقيّمين", "الاطلاع على سجل التدقيق", "إدارة بقية صلاحيات النظام"] },
};

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
  const [roleInfo, setRoleInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const isBranchScoped = selectedRoles.some((role) => ["employee", "accountant", "branch_manager", "yard_supervisor"].includes(role));

  function toggle(value: string, values: string[], setter: (next: string[]) => void) {
    setter(values.includes(value) ? values.filter((item) => item !== value) : [...values, value]);
  }

  function permissionLabel(value: string, label: string) {
    if (selectedRoles.includes("branch_manager")) {
      const branchLabels: Record<string, string> = {
        "employees.view_all": "مشاهدة الموظفين في فرع المدير فقط",
        "attendance.view_all": "مشاهدة الحضور في فرع المدير فقط",
        "effects.view_all": "مشاهدة المؤثرات في فرع المدير فقط",
        "reports.view_all": "مشاهدة تقارير فرع المدير فقط",
        "reports.export": "تصدير تقارير فرع المدير فقط",
      };
      return branchLabels[value] ?? label;
    }
    return label;
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
    {showAccessModal && <div className="access-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowAccessModal(false); }}><section className="access-modal" role="dialog" aria-modal="true" aria-labelledby="access-modal-title"><header><div><span>إعداد الحساب</span><h2 id="access-modal-title">الصفات والصلاحيات</h2></div><button type="button" aria-label="إغلاق" onClick={() => setShowAccessModal(false)}>×</button></header><p className="access-modal-hint">اختر صفة الموظف الأساسية أو أكثر من صفة. اضغط «دليل الصلاحيات» لمعرفة نطاق كل صفة، ويمكن منح أذونات خاصة من القسم التالي.</p><div className="access-modal-body"><section className="access-modal-section access-roles-section"><h3>الصفات الوظيفية الأساسية</h3><p>اختر صفة أو أكثر، وافتح دليلها لمعرفة ما تسمح به.</p><div className="access-role-options">{permittedRoles.map(([value, label]) => <div className="access-role-card" key={value}><label><input type="checkbox" checked={selectedRoles.includes(value)} onChange={() => toggle(value, selectedRoles, setSelectedRoles)} /><span>{label}</span></label><button type="button" className="role-guide-trigger" onClick={() => setRoleInfo(value)}>دليل الصلاحيات</button></div>)}</div>{selectedRoles.includes("branch_manager") && <div className="branch-role-permissions"><h4>صلاحيات مدير الفرع المفعّلة تلقائيًا</h4><p>تسري على موظفي هذا الفرع فقط، ولا تحتاج اختيارها من الصلاحيات الإضافية.</p><div className="access-permission-list">{branchManagerPermissions.map((label) => <label key={label}><input type="checkbox" checked readOnly disabled /><span>{label}</span></label>)}</div></div>}</section><section className="access-modal-section access-permissions-section"><h3>صلاحيات إضافية لهذا الحساب</h3>{selectedRoles.includes("branch_manager") && <p className="access-permissions-admin-note">صلاحيات مدير الفرع الإضافية تبقى محدودة بفرعه فقط.</p>}{!canAssignAdmin && <p className="access-permissions-admin-note">منح الصلاحيات الإضافية متاح لمدير النظام فقط.</p>}<div className="access-permission-list">{permissions.map(([value, label]) => <label key={value}><input type="checkbox" checked={selectedPermissions.includes(value)} disabled={!canAssignAdmin} onChange={() => toggle(value, selectedPermissions, setSelectedPermissions)} /><span>{label}</span></label>)}</div></section></div><footer><button className="secondary-button" type="button" onClick={() => setShowAccessModal(false)}>إلغاء</button><button className="primary-button" type="button" onClick={() => setShowAccessModal(false)}>تم</button></footer></section></div>}
    {roleInfo && <div className="role-guide-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setRoleInfo(null); }}><section className="role-guide-modal" role="dialog" aria-modal="true" aria-labelledby="role-guide-title"><header><div><span>دليل وتخصيص الصلاحيات</span><h2 id="role-guide-title">{permittedRoles.find(([key]) => key === roleInfo)?.[1] ?? roleInfo}</h2></div><button type="button" aria-label="إغلاق الدليل" onClick={() => setRoleInfo(null)}>×</button></header><p className="role-guide-summary">{roleGuides[roleInfo]?.summary}</p><div className="role-guide-scope"><b>نطاق الصفة</b><span>{roleGuides[roleInfo]?.scope}</span></div><div className="role-guide-checklist"><h3>الصلاحيات الأساسية للصفة</h3>{roleGuides[roleInfo]?.permissions.map((item) => <label className="role-guide-capability" key={item}><input type="checkbox" checked readOnly disabled /><span>{item}</span></label>)}</div><div className="role-guide-checklist role-guide-grants"><h3>تحديد صلاحيات إضافية للحساب</h3><p>حدد ما يحتاجه هذا الحساب من الصلاحيات التالية. التغييرات تُحفظ عند الضغط على «حفظ حساب الدخول».</p>{permissions.map(([value, label]) => <label key={value}><input type="checkbox" checked={selectedPermissions.includes(value)} disabled={!canAssignAdmin} onChange={() => toggle(value, selectedPermissions, setSelectedPermissions)} /><span>{permissionLabel(value, label)}</span></label>)}{!canAssignAdmin && <small>تعديل الصلاحيات الإضافية متاح لمدير النظام فقط.</small>}</div><p className="role-guide-note">الصلاحيات الإضافية تُمنح للحساب وتضاف إلى صلاحيات صفاته. لا تلغي هذه القائمة صلاحية أساسية تفرضها الصفة. تظل صلاحيات مدير الفرع داخل فرعه فقط.</p><footer><button type="button" className="secondary-button" onClick={() => setRoleInfo(null)}>إغلاق</button><button type="button" className="primary-button" onClick={() => { toggle(roleInfo, selectedRoles, setSelectedRoles); setRoleInfo(null); }}>{selectedRoles.includes(roleInfo) ? "إزالة الصفة" : "إضافة الصفة"}</button></footer></section></div>}
  </section>;
}
