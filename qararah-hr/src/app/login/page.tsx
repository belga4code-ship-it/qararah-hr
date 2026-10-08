"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);

    if (signInError) {
      setError("تعذر تسجيل الدخول. راجع البريد الإلكتروني وكلمة المرور.");
      return;
    }

    router.replace("/");
    router.refresh();
  }

  return (
    <main className="login-shell" dir="rtl">
      <section className="login-card">
        <div className="brand-mark login-mark">ق</div>
        <p className="eyebrow">شركة قرارة للرخام والجرانيت</p>
        <h1>تسجيل الدخول</h1>
        <p className="welcome-copy">ادخل إلى نظام الموارد البشرية بحسابك المعتمد.</p>
        <form className="login-form" onSubmit={handleSubmit}>
          <label htmlFor="email">البريد الإلكتروني</label>
          <input id="email" type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} />
          <label htmlFor="password">كلمة المرور</label>
          <input id="password" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} />
          {error && <p className="login-error" role="alert">{error}</p>}
          <button className="primary-button login-submit" type="submit" disabled={busy}>{busy ? "جارٍ الدخول..." : "دخول"}</button>
        </form>
        <p className="login-footnote">إن لم يكن لديك حساب، اطلب من مسؤول النظام إضافته من Supabase.</p>
      </section>
    </main>
  );
}
