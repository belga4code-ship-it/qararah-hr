import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "نظام الموارد البشرية - شركة قرارة",
    short_name: "موارد قرارة",
    description: "إدارة شؤون الموظفين والحضور في شركة قرارة للرخام والجرانيت",
    lang: "ar-LY",
    dir: "rtl",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#f1f5f9",
    theme_color: "#101a32",
    prefer_related_applications: false,
    icons: [
      { src: "/qararah-pwa-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/qararah-pwa-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/qararah-pwa-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/qararah-pwa-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
