# Employee roster mapping

Source: `DATA BAISE 2026.xlsx`, sheet `DATA BAISE 2026`.

## Core employee fields

| Workbook column | Supabase target |
| --- | --- |
| الكود الوظيفى | `employees.employee_number` |
| كود البصمة | `employees.zkt_user_id` |
| الاسم | `employees.full_name` |
| الوظيفة | `job_titles.name` / `employees.job_title_id` |
| القسم | `departments.name` / `employees.department_id` |
| الفرع | `branches.name` / `employees.branch_id` |
| رمز الفرع | `branches.branch_code` |
| تاريخ التعيين بالشركة | `employees.hired_on` |
| الحالة | `employees.status`; only the exact value `نشط` becomes active; other values need review |
| راتب الموظف تحديث يوليو26 | `employee_private.salary_amount` |
| المؤهل الدراسى | `employee_private.education` |
| دفعة التخرج | `employee_private.graduation_year` |
| تاريخ الميلاد | `employee_private.date_of_birth` |
| الديانة | `employee_private.religion` |
| الحالة الاجتماعية | `employee_private.marital_status` |
| فصيلة الدم | `employee_private.blood_type` |
| تاريخ إنتهاء الاقامه | `employee_private.residency_expires_on` |
| رقم الجوال | `employee_private.phone` |
| رقم الرجوع اليه في حالة الطوارئ | `employee_private.emergency_phone` |
| اسم الشخص | `employee_private.emergency_contact_name` |
| رقم جواز السفر | `employee_private.passport_number` |
| تاريخ دخول الى ليبيا | `employee_private.entered_libya_on` |
| البلد الام | `employee_private.home_country` |
| العنوان | `employee_private.address` |
| ملاحظات / ملاحظات 2026 | `employee_private.notes` |
| All source columns, including source-only fields such as status date and row number | `employee_private.source_data` (`jsonb`) |

## Restricted employee details

The workbook includes salary, contact, identity, emergency-contact, education,
and personal details. These are written to `employee_private`, which has RLS
access only for users with the `hr` or `admin` role. The `source_data` JSONB
column retains every named source column, including fields not represented by
dedicated database columns.

## Source checks

- 145 employee records are present; all 145 employee codes are populated and unique.
- 137 biometric codes are populated and unique; 8 employee rows have no code.
- The first attendance export contains 12 distinct device codes, all of which
  match a biometric code in this workbook.
- The status column is incomplete and includes non-status notes/dates. Import
  should flag these rows for review rather than infer active status.
- The source contains private employee data. Only parsed field values are saved;
  the workbook file itself is not uploaded to Supabase.
