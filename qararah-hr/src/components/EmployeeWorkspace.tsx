import Link from "next/link";
import Image from "next/image";
import type { ReactNode } from "react";
import LogoutButton from "@/components/LogoutButton";
import MobileWorkspaceNavigation from "@/components/MobileWorkspaceNavigation";
import { createClient } from "@/lib/supabase/server";

const navigation = [
  { label: "الرئيسية", href: "/", icon: "⌂", breadcrumb: "الرئيسية" },
  { label: "الموظفون", href: "/employees", icon: "♙", breadcrumb: "الموظفون" },
  { label: "الحضور والانصراف", href: "/attendance", icon: "◷", breadcrumb: "الحضور والانصراف" },
  { label: "الطلبات والقرارات", href: "/effects", icon: "▤", breadcrumb: "الطلبات والقرارات" },
  { label: "أهدافي", href: "/goals", icon: "◎", breadcrumb: "أهدافي" },
  { label: "الإجازات والمأموريات", icon: "▣" },
  { label: "تقييم الأداء", href: "/evaluations", icon: "☆", breadcrumb: "تقييم الأداء" },
  { label: "تقييماتي", href: "/my-evaluations", icon: "☆", breadcrumb: "تقييماتي" },
  { label: "الإبلاغ", href: "/report", icon: "!", breadcrumb: "الإبلاغ" },
  { label: "سجل التدقيق", href: "/audit", icon: "◉", breadcrumb: "سجل التدقيق" },
  { label: "التقارير", href: "/attendance/report", icon: "▥", breadcrumb: "التقرير الأسبوعي" },
];

const roleNames: Record<string, string> = { admin: "مدير النظام", hr: "مدير الموارد البشرية", branch_manager: "مدير الفرع", accountant: "محاسب", auditor: "مراجع الحسابات", employee: "موظف", yard_supervisor: "مسؤول ساحة" };
type AccessProfile = { role?: string; user_roles?: string[] | null; additional_permissions?: string[] | null };

export default async function EmployeeWorkspace({ children, userName, email, roleLabel, breadcrumb, initialAccessProfile }: { children: ReactNode; userName: string; email: string; roleLabel: string; breadcrumb: string; initialAccessProfile?: AccessProfile | null }) {
  let accessProfile: AccessProfile | null = initialAccessProfile ?? null;
  if (!initialAccessProfile) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const extendedProfile = await supabase.from("profiles").select("role,user_roles,additional_permissions").eq("id", user.id).maybeSingle();
      if (extendedProfile.data) accessProfile = extendedProfile.data as unknown as AccessProfile;
      else if (extendedProfile.error && /user_roles|additional_permissions/i.test(extendedProfile.error.message)) {
        const legacyProfile = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
        accessProfile = legacyProfile.data as unknown as AccessProfile;
      }
    }
  }
  const roles = [...new Set([roleLabel, accessProfile?.role, ...((accessProfile?.user_roles as string[] | null) ?? [])].filter((role): role is string => Boolean(role)))];
  const permissions = (accessProfile?.additional_permissions as string[] | null) ?? [];
  const hasRole = (...values: string[]) => values.some((value) => roles.includes(value));
  const hasPermission = (...values: string[]) => values.some((value) => permissions.includes(value));
  const isBasicEmployee = hasRole("employee") && !hasRole("admin", "hr", "branch_manager", "accountant", "auditor", "yard_supervisor");
  const canSee = (href: string) => {
    if (href === "/") return true;
    if (href === "/employees") return hasRole("admin", "hr", "branch_manager", "auditor") || hasPermission("employees.view_all", "employees.edit", "employees.manage_accounts");
    if (href === "/attendance/import") return hasRole("admin", "hr") || hasPermission("attendance.import");
    if (href === "/attendance") return hasRole("admin", "hr", "branch_manager", "accountant", "auditor", "yard_supervisor") || hasPermission("attendance.view_all", "attendance.manage", "attendance.import");
    if (href === "/effects") return true;
    if (href === "/goals") return true;
    if (href === "/evaluations") return hasRole("admin", "hr", "branch_manager", "accountant", "auditor") || hasPermission("evaluations.view_all", "evaluations.evaluate", "evaluations.assign");
    if (href === "/my-evaluations" || href === "/report") return true;
    if (href === "/attendance/report") return hasRole("admin", "hr", "auditor", "branch_manager") || hasPermission("reports.view_all", "reports.export");
    if (href === "/audit") return hasRole("admin", "hr") || hasPermission("audit.view");
    return false;
  };
  const roleDisplay = [...new Set([...(accessProfile?.user_roles as string[] | null ?? []), accessProfile?.role].filter((role): role is string => Boolean(role)))].map((role) => roleNames[role] ?? role).join(" · ") || roleLabel;
  const visibleNavigation = navigation.filter((item): item is typeof item & { href: string } => typeof item.href === "string" && canSee(item.href));
  const mobileItems = visibleNavigation;
  return <main className={`app-shell employee-shell${isBasicEmployee ? " mobile-employee-shell" : ""}`} dir="rtl">
    <aside className="sidebar employee-sidebar">
      <div>
        <div className="brand employee-brand"><div className="brand-mark brand-logo-mark"><Image src="/qararah-mark.jpeg" alt="شعار قرارة" width={78} height={78} /></div><div><strong>قرارة</strong><span>نظام الموارد البشرية</span></div></div>
        <p className="menu-caption">القائمة الرئيسية</p>
        <nav className="nav-list" aria-label="القائمة الرئيسية">
          {visibleNavigation.map((item) => {
            const active = item.breadcrumb === breadcrumb || (item.label === "الموظفون" && breadcrumb === "ملف الموظف");
            const className = `nav-item${active ? " active" : ""}${item.href ? "" : " nav-item-pending"}`;
            return item.href
              ? <Link className={className} href={item.href} key={item.label}><span className="nav-icon">{item.icon}</span><span>{item.label}</span></Link>
              : <div className={className} key={item.label} aria-disabled="true" title="سيتم تحديد محتوى هذه القائمة"><span className="nav-icon">{item.icon}</span><span>{item.label}</span></div>;
          })}
        </nav>
      </div>
      <div className="employee-sidebar-footer"><div className="employee-sidebar-user"><span className="employee-sidebar-avatar">{userName.trim().charAt(0) || "م"}</span><div><strong>{userName}</strong><small>{roleDisplay}</small></div></div><div className="employee-sidebar-status"><i />نظام الموارد البشرية</div><LogoutButton /></div>
    </aside>
    <section className="workspace employee-workspace">
      <header className="topbar"><div className="breadcrumb"><Link href="/">نظام الموارد البشرية</Link><span>/</span>{breadcrumb}</div><div className="mobile-account-actions"><LogoutButton /></div><div className="profile"><div className="avatar">{userName.trim().charAt(0) || "م"}</div><div><strong>{userName}</strong><span>{roleDisplay} · {email}</span></div></div></header>
      {children}
    </section>
    <MobileWorkspaceNavigation items={mobileItems} roleLabel={roleLabel} breadcrumb={breadcrumb} />
  </main>;
}
