import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "نظام الموارد البشرية | شركة قرارة",
  description: "إدارة شؤون الموظفين والحضور في شركة قرارة للرخام والجرانيت",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ar" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
