"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LogoutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleLogout() {
    setBusy(true);
    setError("");
    const { error: signOutError } = await createClient().auth.signOut();

    if (signOutError) {
      setError("تعذر تسجيل الخروج. حاول مرة أخرى.");
      setBusy(false);
      return;
    }

    router.replace("/login");
    router.refresh();
  }

  return <div className="logout-area">
    <button className="logout-button" type="button" onClick={handleLogout} disabled={busy}>
      <span className="logout-icon" aria-hidden="true">↪</span>
      <span>{busy ? "جارٍ تسجيل الخروج..." : "تسجيل الخروج"}</span>
    </button>
    {error && <p className="logout-error" role="alert">{error}</p>}
  </div>;
}
