import Link from "next/link";
import type { ReactNode } from "react";

const navigation = [
  { label: "الرئيسية", href: "/", icon: "⌂", breadcrumb: "الرئيسية" },
  { label: "الموظفون", href: "/employees", icon: "♙", breadcrumb: "الموظفون" },
  { label: "استيراد الموظفين", href: "/employees/import", icon: "⇧", breadcrumb: "استيراد الموظفين" },
  { label: "الحضور والانصراف", href: "/attendance", icon: "◷", breadcrumb: "الحضور والانصراف" },
  { label: "استيراد الحضور", href: "/attendance/import", icon: "⇧", breadcrumb: "استيراد الحضور" },
  { label: "المؤثرات الأسبوعية", icon: "▤" },
  { label: "الإجازات والمأموريات", icon: "▣" },
  { label: "تقييم الأداء", icon: "☆" },
  { label: "التقارير", href: "/attendance/report", icon: "▥", breadcrumb: "التقرير الأسبوعي" },
];

export default function EmployeeWorkspace({ children, userName, email, roleLabel, breadcrumb }: { children: ReactNode; userName: string; email: string; roleLabel: string; breadcrumb: string }) {
  return <main className="app-shell employee-shell" dir="rtl">
    <aside className="sidebar employee-sidebar">
      <div>
        <div className="brand employee-brand"><div className="brand-mark">ق</div><div><strong>قرارة</strong><span>نظام الموارد البشرية</span></div></div>
        <p className="menu-caption">القائمة الرئيسية</p>
        <nav className="nav-list" aria-label="القائمة الرئيسية">
          {navigation.map((item) => {
            const active = item.breadcrumb === breadcrumb || (item.label === "الموظفون" && breadcrumb === "ملف الموظف");
            const className = `nav-item${active ? " active" : ""}${item.href ? "" : " nav-item-pending"}`;
            return item.href
              ? <Link className={className} href={item.href} key={item.label}><span className="nav-icon">{item.icon}</span><span>{item.label}</span></Link>
              : <div className={className} key={item.label} aria-disabled="true" title="سيتم تحديد محتوى هذه القائمة"><span className="nav-icon">{item.icon}</span><span>{item.label}</span></div>;
          })}
        </nav>
      </div>
      <div className="employee-sidebar-footer"><div className="employee-sidebar-user"><span className="employee-sidebar-avatar">{userName.trim().charAt(0) || "م"}</span><div><strong>{userName}</strong><small>{roleLabel}</small></div></div><div className="employee-sidebar-status"><i />نظام الموارد البشرية</div></div>
    </aside>
    <section className="workspace employee-workspace">
      <header className="topbar"><div className="breadcrumb"><Link href="/">نظام الموارد البشرية</Link><span>/</span>{breadcrumb}</div><div className="profile"><div className="avatar">{userName.trim().charAt(0) || "م"}</div><div><strong>{userName}</strong><span>{roleLabel} · {email}</span></div></div></header>
      {children}
    </section>
  </main>;
}
