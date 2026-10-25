import type { Metadata, Viewport } from "next";
import ServiceWorkerRegistration from "@/components/ServiceWorkerRegistration";
import "./globals.css";

export const metadata: Metadata = {
  title: "نظام الموارد البشرية | شركة قرارة",
  description: "إدارة شؤون الموظفين والحضور في شركة قرارة للرخام والجرانيت",
  applicationName: "موارد قرارة",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "موارد قرارة" },
  icons: { icon: [{ url: "/qararah-pwa-192.png", sizes: "192x192", type: "image/png" }] },
};

export const viewport: Viewport = {
  themeColor: "#101a32",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ar-LY-u-nu-latn" dir="rtl">
      <body><ServiceWorkerRegistration />{children}</body>
    </html>
  );
}
