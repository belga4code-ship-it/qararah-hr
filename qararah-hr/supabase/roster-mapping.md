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
| الحالة | `employees.status`, only after value review |

## Restricted employee details

The workbook also has pay, contact, identity, emergency contact, education,
and personal details. These map to `employee_private`, which has access only
for users with the `hr` or `admin` role. Do not import these fields until the
company confirms which fields it wants to keep in the system.

## Source checks

- 145 employee records are present; all 145 employee codes are populated and unique.
- 137 biometric codes are populated and unique; 8 employee rows have no code.
- The first attendance export contains 12 distinct device codes, all of which
  match a biometric code in this workbook.
- The status column is incomplete and includes non-status notes/dates. Import
  should flag these rows for review rather than infer active status.
- The source contains private employee data. The workbook itself has not been
  uploaded to Supabase.
