"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
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
    const identifier = email.trim();
    const loginEmail = identifier.includes("@") ? identifier : `${identifier.toLowerCase()}@qararah.test`;
    const { error: signInError } = await supabase.auth.signInWithPassword({ email: loginEmail, password });
    setBusy(false);

    if (signInError) {
      setError("تعذر تسجيل الدخول. راجع اسم المستخدم أو البريد الإلكتروني وكلمة المرور.");
      return;
    }

    router.replace("/");
    router.refresh();
  }

  return (
    <main className="login-shell" dir="rtl">
      <section className="login-card">
        <Image className="login-logo" src="/qararah-logo.jpeg" alt="شعار شركة قرارة للرخام والجرانيت" width={200} height={200} priority />
        <p className="eyebrow">شركة قرارة للرخام والجرانيت</p>
        <h1>تسجيل الدخول</h1>
        <p className="welcome-copy">ادخل إلى نظام الموارد البشرية بحسابك المعتمد.</p>
        <form className="login-form" onSubmit={handleSubmit}>
          <label htmlFor="email">اسم المستخدم أو البريد الإلكتروني</label>
          <input id="email" type="text" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="belga" />
          <label htmlFor="password">كلمة المرور</label>
          <input id="password" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} />
          {error && <p className="login-error" role="alert">{error}</p>}
          <button className="primary-button login-submit" type="submit" disabled={busy}>{busy ? "جارٍ الدخول..." : "دخول"}</button>
        </form>
        <p className="login-footnote">إذا لم يكن لديك حساب، اطلب من الموارد البشرية إنشاءه من ملف الموظف.</p>
      </section>
    </main>
  );
}
