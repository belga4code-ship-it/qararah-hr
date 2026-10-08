export default function SetupRequiredPage() {
  return (
    <main className="login-shell" dir="rtl">
      <section className="login-card">
        <div className="brand-mark login-mark">ق</div>
        <p className="eyebrow">شركة قرارة للرخام والجرانيت</p>
        <h1>الحساب يحتاج إعدادًا</h1>
        <p className="welcome-copy">تم تسجيل الدخول، لكن ملف الحساب غير موجود في جدول profiles. أضف حسابك وصلاحية الموارد البشرية من Supabase، ثم حدّث هذه الصفحة.</p>
        <a className="primary-button login-submit setup-link" href="/login">العودة إلى تسجيل الدخول</a>
      </section>
    </main>
  );
}
