"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const internalEmail = (username: string) => `${username}@qararah.test`;

export async function saveEmployeeCredentials(
  employeeId: string,
  input: { username: string; password: string; roles: string[]; additionalPermissions: string[]; branchId: string },
) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(employeeId)) return { error: "معرّف الموظف غير صحيح." };
  if (!input || typeof input.username !== "string" || typeof input.password !== "string" || !Array.isArray(input.roles) || !Array.isArray(input.additionalPermissions) || typeof input.branchId !== "string") return { error: "بيانات الحساب غير مكتملة." };
  const username = input.username.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(username)) {
    return { error: "اسم المستخدم يجب أن يكون 3 إلى 32 حرفاً إنجليزياً أو رقماً، ويمكن استخدام النقطة والشرطة." };
  }
  if (input.password && input.password.length < 6) {
    return { error: "كلمة المرور يجب ألا تقل عن 6 أحرف." };
  }
  const allowedRoles = ["employee", "accountant", "branch_manager", "hr", "admin", "auditor", "yard_supervisor"];
  const allowedPermissions = ["employees.view_all", "employees.view_sensitive", "employees.edit", "employees.manage_accounts", "attendance.view_all", "attendance.manage", "attendance.import", "effects.view_all", "effects.create", "effects.approve", "effects.manage_deductions", "goals.view_all", "goals.manage", "evaluations.view_all", "evaluations.evaluate", "evaluations.assign", "reports.view_all", "reports.export", "audit.view"];
  const roles = [...new Set(input.roles)];
  const additionalPermissions = [...new Set(input.additionalPermissions)];
  if (!roles.length || roles.some((role) => !allowedRoles.includes(role))) return { error: "اختر صفة واحدة على الأقل من الصفات المتاحة." };
  if (additionalPermissions.some((permission) => !allowedPermissions.includes(permission))) return { error: "تحتوي الصلاحيات على خيار غير معروف." };
  const primaryRole = ["admin", "hr", "auditor", "branch_manager", "accountant", "employee"].find((role) => roles.includes(role)) ?? "employee";

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "انتهت الجلسة. سجّل الدخول مرة أخرى." };
  let { data: actor, error: actorError } = await supabase.from("profiles").select("role,additional_permissions").eq("id", user.id).maybeSingle();
  if (!actor && actorError && /additional_permissions/i.test(actorError.message)) {
    const legacyActor = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
    actor = legacyActor.data as typeof actor;
    actorError = legacyActor.error;
  }
  const actorPermissions = (actor?.additional_permissions as string[] | null) ?? [];
  if (!actor || (!["hr", "admin"].includes(actor.role) && !actorPermissions.includes("employees.manage_accounts"))) return { error: "ليس لديك صلاحية إدارة حسابات الموظفين." };

  const admin = createAdminClient();
  const [{ data: employee, error: employeeError }, { data: linkedProfile, error: profileError }] = await Promise.all([
    admin.from("employees").select("id,full_name,first_name,last_name,branch_id").eq("id", employeeId).maybeSingle(),
    admin.from("profiles").select("id,username").eq("employee_id", employeeId).maybeSingle(),
  ]);
  if (employeeError || !employee) return { error: "لم يتم العثور على الموظف." };
  if (profileError) return { error: "تعذر قراءة ملف الحساب. تأكد من تطبيق تحديث قاعدة البيانات." };
  const { data: usernameOwner, error: usernameError } = await admin.from("profiles").select("id").ilike("username", username).maybeSingle();
  if (usernameError) return { error: "تعذر التأكد من توفر اسم المستخدم." };
  if (usernameOwner && usernameOwner.id !== linkedProfile?.id) return { error: "اسم المستخدم مستخدم مسبقاً. اختر اسماً آخر." };
  if (roles.some((role) => ["admin", "hr"].includes(role)) && actor.role !== "admin") return { error: "صلاحية مدير النظام أو الموارد البشرية يمنحها مدير النظام فقط." };
  if (roles.includes("admin") && actor.role !== "admin") return { error: "صلاحية مدير النظام يمنحها مدير النظام فقط." };
  if (additionalPermissions.includes("employees.manage_accounts") && actor.role !== "admin") return { error: "صلاحية إدارة حسابات وصلاحيات الموظفين يمنحها مدير النظام فقط." };
  const branchScoped = roles.some((role) => ["employee", "accountant", "branch_manager", "yard_supervisor"].includes(role));
  if (branchScoped && !input.branchId) return { error: "اختر الفرع لهذا الحساب." };
  if (input.branchId) {
    const { data: branch } = await admin.from("branches").select("id").eq("id", input.branchId).maybeSingle();
    if (!branch) return { error: "الفرع المختار غير موجود." };
  }
  if (branchScoped) {
    const { error: branchUpdateError } = await admin.from("employees").update({ branch_id: input.branchId }).eq("id", employeeId);
    if (branchUpdateError) return { error: `تعذر ربط الموظف بالفرع: ${branchUpdateError.message}` };
  }

  const authEmail = internalEmail(username);
  const fullName = employee.full_name || [employee.first_name, employee.last_name].filter(Boolean).join(" ");
  let authUserId = linkedProfile?.id as string | undefined;
  let createdUserId: string | undefined;

  if (authUserId) {
    const update: { email: string; email_confirm: boolean; password?: string } = { email: authEmail, email_confirm: true };
    if (input.password) update.password = input.password;
    const { error } = await admin.auth.admin.updateUserById(authUserId, update);
    if (error) return { error: error.message.includes("already") ? "اسم المستخدم مستخدم لحساب آخر." : `تعذر تحديث بيانات الدخول: ${error.message}` };
  } else {
    if (!input.password) return { error: "أدخل كلمة مرور لإنشاء حساب الدخول." };
    const { data, error } = await admin.auth.admin.createUser({
      email: authEmail,
      password: input.password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });
    if (error || !data.user) return { error: error?.message.includes("already") ? "اسم المستخدم مستخدم مسبقاً. اختر اسماً آخر." : `تعذر إنشاء حساب الدخول: ${error?.message ?? "خطأ غير معروف"}` };
    authUserId = data.user.id;
    createdUserId = data.user.id;
  }

  const { error: upsertError } = await admin.from("profiles").upsert({
    id: authUserId,
    employee_id: employee.id,
    full_name: fullName,
    role: primaryRole,
    user_roles: roles,
    additional_permissions: additionalPermissions,
    branch_id: branchScoped ? input.branchId : null,
    username,
  }, { onConflict: "id" });
  if (upsertError) {
    if (createdUserId) await admin.auth.admin.deleteUser(createdUserId);
    return { error: `تم تجهيز الحساب لكن تعذر حفظ ربطه بالموظف: ${upsertError.message}` };
  }

  return { username };
}
