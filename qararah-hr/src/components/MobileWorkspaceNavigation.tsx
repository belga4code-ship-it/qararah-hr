"use client";

import Link from "next/link";
import { useState } from "react";

type NavigationItem = { label: string; href: string; icon: string; breadcrumb?: string };

const employeeShortcuts: NavigationItem[] = [
  { label: "طلب إذن", href: "/effects", icon: "◷", breadcrumb: "المؤثرات الأسبوعية" },
  { label: "أهدافي", href: "/goals", icon: "◎", breadcrumb: "أهدافي" },
  { label: "تقييماتي", href: "/my-evaluations", icon: "☆", breadcrumb: "تقييماتي" },
  { label: "الإبلاغ", href: "/report", icon: "!", breadcrumb: "الإبلاغ" },
];

const primaryRoutes = ["/", "/employees", "/attendance", "/effects"];

export default function MobileWorkspaceNavigation({ items, roleLabel, breadcrumb }: { items: NavigationItem[]; roleLabel: string; breadcrumb: string }) {
  const [moreOpen, setMoreOpen] = useState(false);
  const isBasicEmployee = roleLabel.startsWith("موظف");
  const shortcuts = isBasicEmployee
    ? employeeShortcuts
    : primaryRoutes.flatMap((href) => {
      const item = items.find((candidate) => candidate.href === href);
      return item ? [item] : [];
    });
  const visibleItems = isBasicEmployee ? shortcuts : items.filter((item) => !shortcuts.some((shortcut) => shortcut.href === item.href));
  const isOnMoreRoute = visibleItems.some((item) => item.breadcrumb === breadcrumb || (item.href === "/employees" && breadcrumb === "ملف الموظف"));

  return <>
    {moreOpen && <div className="mobile-nav-backdrop" onClick={() => setMoreOpen(false)}>
      <section className="mobile-nav-sheet" role="dialog" aria-modal="true" aria-label="المزيد من صفحات النظام" onClick={(event) => event.stopPropagation()}>
        <div className="mobile-nav-sheet-heading"><div><strong>المزيد</strong><span>اختر صفحة من النظام</span></div><button type="button" onClick={() => setMoreOpen(false)} aria-label="إغلاق القائمة">×</button></div>
        <nav className="mobile-nav-more-list">{visibleItems.map((item) => {
          const active = item.breadcrumb === breadcrumb || (item.href === "/employees" && breadcrumb === "ملف الموظف");
          return <Link key={item.href} href={item.href} className={active ? "active" : ""} aria-current={active ? "page" : undefined} onClick={() => setMoreOpen(false)}><span aria-hidden="true">{item.icon}</span><span>{item.label}</span><b aria-hidden="true">←</b></Link>;
        })}</nav>
      </section>
    </div>}
    <nav className={`mobile-workspace-nav${isBasicEmployee ? " employee" : " has-more"}`} aria-label="التنقل على الهاتف">
      {shortcuts.map((item) => {
        const active = item.breadcrumb === breadcrumb || (item.href === "/employees" && breadcrumb === "ملف الموظف");
        return <Link key={item.href} href={item.href} className={`mobile-workspace-nav-item${active ? " active" : ""}`} aria-current={active ? "page" : undefined}><span aria-hidden="true">{item.icon}</span><small>{item.label}</small></Link>;
      })}
      {!isBasicEmployee && <button type="button" className={`mobile-workspace-nav-item${moreOpen || isOnMoreRoute ? " active" : ""}`} aria-expanded={moreOpen} onClick={() => setMoreOpen((open) => !open)}><span aria-hidden="true">⋯</span><small>المزيد</small></button>}
    </nav>
  </>;
}
