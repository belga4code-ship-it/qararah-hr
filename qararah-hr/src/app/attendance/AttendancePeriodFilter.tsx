"use client";

import { useState } from "react";
import { toWesternDigits } from "@/lib/digits";

const MONTHS = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];

export default function AttendancePeriodFilter({ month, period, from, to }: { month: string; period: string; from: string; to: string }) {
  const [selectedPeriod, setSelectedPeriod] = useState(period);
  const currentYear = new Date().getFullYear();
  const options = Array.from({ length: 9 }, (_, i) => currentYear - 5 + i).flatMap((year) => MONTHS.map((name, i) => {
    const value = `${year}-${String(i + 1).padStart(2, "0")}`;
    return <option value={value} key={value}>{name} {year}</option>;
  }));

  return <form className="attendance-period-filter" method="get">
    <label><span>الشهر</span><select name="month" defaultValue={month}>{options}</select></label>
    <label><span>الفترة</span><select name="period" value={selectedPeriod} onChange={(e) => setSelectedPeriod(e.target.value)}><option value="custom">من تاريخ إلى تاريخ</option><option value="1">الأسبوع الأول · 1–7</option><option value="2">الأسبوع الثاني · 8–14</option><option value="3">الأسبوع الثالث · 15–21</option><option value="4">الأسبوع الرابع · 22–نهاية الشهر</option><option value="all">كل الشهر</option></select></label>
    <label><span>من تاريخ</span><input type="text" inputMode="numeric" dir="ltr" name="from" placeholder="YYYY-MM-DD" pattern="\d{4}-\d{2}-\d{2}" maxLength={10} defaultValue={from} onChange={(e) => { e.currentTarget.value = toWesternDigits(e.currentTarget.value); setSelectedPeriod("custom"); }} /></label>
    <label><span>إلى تاريخ</span><input type="text" inputMode="numeric" dir="ltr" name="to" placeholder="YYYY-MM-DD" pattern="\d{4}-\d{2}-\d{2}" maxLength={10} defaultValue={to} onChange={(e) => { e.currentTarget.value = toWesternDigits(e.currentTarget.value); setSelectedPeriod("custom"); }} /></label>
    <button type="submit" className="secondary-button">عرض</button>
  </form>;
}
