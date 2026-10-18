export type Role = "admin" | "hr" | "branch_manager" | "accountant" | "employee" | "auditor";
export type Criterion = { name: string; score: number; evidence: string };
export type EvaluatedEmployee = { id: string; employee_number: string; first_name: string; last_name: string | null; full_name: string | null; status: string; branch_id: string; department_id: string | null; department_name: string; job_title_name: string; branch_name: string };
export type EvaluatorOption = { employee_id: string; full_name: string; job_title_name: string; branch_name: string; has_system_account: boolean | null };
export type EvaluationAssignment = { employee_id: string; slot: number; evaluator_profile_id: string | null; evaluator_employee_id: string | null; evaluator_employee: { id: string; employee_number: string; first_name: string; last_name: string | null; full_name: string | null; job_title: { name: string } | null; branch: { name: string } | null } | null };
export type EvaluationRecord = { id: string; employee_id: string; period_month: string; evaluator_id: string | null; total_score: number | null; max_score: number; status: string; notes: string | null; evaluation_items: { criterion: string; score: number; max_score: number; evidence: string | null }[] };

const criterionNames = {
  accountant: [
    "الالتزام بالحضور وإدارة الوقت وإنجاز المهام",
    "العمل الجماعي والتعاون وتحمل المسؤولية",
    "إدارة السلف ومطابقتها مع الفرع",
    "دقة فواتير البيع والشراء بين الفروع",
    "متابعة مديونيات الزبائن ورفع التقرير المالي",
    "إدخال إيصالات القبض والتحويلات ومراجعة المرفقات",
    "إتمام المطابقة الشهرية مع الإدارة المالية في موعدها",
    "إدارة مصروفات الفرع وإضافة مستنداتها يوميًا",
    "إدارة حركة الخزينة اليومية وإرفاق المستندات",
  ],
  sales: [
    "الالتزام بالحضور وإدارة الوقت وإنجاز المهام",
    "تحقيق نسبة المبيعات المستهدفة خلال الشهر",
    "استقطاب زبائن جدد بالتسويق الخارجي",
    "تسويق المنتجات التي بها ركود",
    "متابعة الزبائن بعد البيع وعرض المنتجات الجديدة",
    "متابعة سداد مديونيات الزبائن",
    "المظهر ومهارات التواصل والتسويق والإقناع",
    "حل مشاكل الزبائن والمحافظة على استمرارية التعامل",
    "دقة الفواتير ومدخلات المنظومة",
    "رفع تقرير شهري باحتياجات الزبائن والسوق",
  ],
  general: [
    "الالتزام بالحضور وإدارة الوقت وإنجاز المهام",
    "جودة العمل ودقة النتائج",
    "الالتزام بالإجراءات والتعليمات المعتمدة",
    "إنجاز المهام في المواعيد المحددة",
    "العمل الجماعي والتعاون مع الفريق",
    "تحمل المسؤولية والمحافظة على ممتلكات الشركة",
    "التواصل المهني وخدمة الزملاء والعملاء",
    "التعامل مع المشكلات وإيجاد الحلول المناسبة",
    "رفع التقارير وتحديث المعلومات المطلوبة",
  ],
};

export const employeeName = (employee: EvaluatedEmployee) => employee.full_name || [employee.first_name, employee.last_name].filter(Boolean).join(" ");
export const templateFor = (title: string) => /محاسب/.test(title) ? "accountant" : /مبيعات|مندوب/.test(title) ? "sales" : "general";
export const currentCriteria = (title: string): string[] => criterionNames[templateFor(title)];
export const seedScores = (title: string): Criterion[] => currentCriteria(title).map((name) => ({ name, score: 3, evidence: "" }));
export const monthLabel = (month: string) => {
  const [year, number] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("ar-LY", { month: "long", year: "numeric", timeZone: "Africa/Tripoli" }).format(new Date(Date.UTC(year, number - 1, 15)));
};
