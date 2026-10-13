import Link from "next/link";
import Image from "next/image";
import type { ReactNode } from "react";
import LogoutButton from "@/components/LogoutButton";

const navigation = [
  { label: "الرئيسية", href: "/", icon: "⌂", breadcrumb: "الرئيسية" },
  { label: "الموظفون", href: "/employees", icon: "♙", breadcrumb: "الموظفون" },
  { label: "استيراد الموظفين", href: "/employees/import", icon: "⇧", breadcrumb: "استيراد الموظفين" },
  { label: "الحضور والانصراف", href: "/attendance", icon: "◷", breadcrumb: "الحضور والانصراف" },
  { label: "استيراد الحضور", href: "/attendance/import", icon: "⇧", breadcrumb: "استيراد الحضور" },
  { label: "المؤثرات الأسبوعية", href: "/effects", icon: "▤", breadcrumb: "المؤثرات الأسبوعية" },
  { label: "أهدافي", href: "/goals", icon: "◎", breadcrumb: "أهدافي" },
  { label: "الإجازات والمأموريات", icon: "▣" },
  { label: "تقييم الأداء", href: "/evaluations", icon: "☆", breadcrumb: "تقييم الأداء" },
  { label: "تقييماتي", href: "/my-evaluations", icon: "☆", breadcrumb: "تقييماتي" },
  { label: "الإبلاغ", href: "/report", icon: "!", breadcrumb: "الإبلاغ" },
  { label: "سجل التدقيق", href: "/audit", icon: "◉", breadcrumb: "سجل التدقيق" },
  { label: "التقارير", href: "/attendance/report", icon: "▥", breadcrumb: "التقرير الأسبوعي" },
];

const employeeMobileNavigation = [
  { label: "طلب إذن", href: "/effects", icon: "◷", breadcrumb: "المؤثرات الأسبوعية" },
  { label: "أهدافي", href: "/goals", icon: "◎", breadcrumb: "أهدافي" },
  { label: "تقييماتي", href: "/my-evaluations", icon: "☆", breadcrumb: "تقييماتي" },
  { label: "الإبلاغ", href: "/report", icon: "!", breadcrumb: "الإبلاغ" },
];

export default function EmployeeWorkspace({ children, userName, email, roleLabel, breadcrumb }: { children: ReactNode; userName: string; email: string; roleLabel: string; breadcrumb: string }) {
  const isBasicEmployee = roleLabel.startsWith("موظف");
  return <main className={`app-shell employee-shell${isBasicEmployee ? " mobile-employee-shell" : ""}`} dir="rtl">
    <aside className="sidebar employee-sidebar">
      <div>
        <div className="brand employee-brand"><div className="brand-mark brand-logo-mark"><Image src="/qararah-mark.jpeg" alt="شعار قرارة" width={78} height={78} /></div><div><strong>قرارة</strong><span>نظام الموارد البشرية</span></div></div>
        <p className="menu-caption">القائمة الرئيسية</p>
        <nav className="nav-list" aria-label="القائمة الرئيسية">
          {navigation.filter((item) => (!isBasicEmployee || ["/", "/effects", "/goals", "/my-evaluations", "/report"].includes(item.href ?? "")) && !(roleLabel === "مراجع حسابات" && ["/employees/import", "/attendance/import"].includes(item.href ?? "")) && !(item.href === "/audit" && !["مدير النظام", "الإدارة الرئيسية", "مدير الموارد البشرية", "الموارد البشرية"].includes(roleLabel))).map((item) => {
            const active = item.breadcrumb === breadcrumb || (item.label === "الموظفون" && breadcrumb === "ملف الموظف");
            const className = `nav-item${active ? " active" : ""}${item.href ? "" : " nav-item-pending"}`;
            return item.href
              ? <Link className={className} href={item.href} key={item.label}><span className="nav-icon">{item.icon}</span><span>{item.label}</span></Link>
              : <div className={className} key={item.label} aria-disabled="true" title="سيتم تحديد محتوى هذه القائمة"><span className="nav-icon">{item.icon}</span><span>{item.label}</span></div>;
          })}
        </nav>
      </div>
      <div className="employee-sidebar-footer"><div className="employee-sidebar-user"><span className="employee-sidebar-avatar">{userName.trim().charAt(0) || "م"}</span><div><strong>{userName}</strong><small>{roleLabel}</small></div></div><div className="employee-sidebar-status"><i />نظام الموارد البشرية</div><LogoutButton /></div>
    </aside>
    <section className="workspace employee-workspace">
      <header className="topbar"><div className="breadcrumb"><Link href="/">نظام الموارد البشرية</Link><span>/</span>{breadcrumb}</div><div className="mobile-account-actions"><LogoutButton /></div><div className="profile"><div className="avatar">{userName.trim().charAt(0) || "م"}</div><div><strong>{userName}</strong><span>{roleLabel} · {email}</span></div></div></header>
      {children}
    </section>
    {isBasicEmployee && <nav className="employee-app-nav" aria-label="قائمة الموظف على الهاتف">{employeeMobileNavigation.map((item) => <Link className={`employee-app-nav-item${breadcrumb === item.breadcrumb ? " active" : ""}`} href={item.href} key={item.href}><span aria-hidden="true">{item.icon}</span><small>{item.label}</small></Link>)}</nav>}
  </main>;
}
