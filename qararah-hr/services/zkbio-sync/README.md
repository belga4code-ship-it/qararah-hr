# Qararah HR — ZKBio Time sync service

Windows background sync client for ZKBio Time 9.0.6. It reads terminal and transaction API data and can submit immutable raw punches to a dedicated Supabase Edge Function. The service does **not** write to `attendance_records`; the HR application can later aggregate raw punches under its existing rules.

## Safety defaults

- `.env.example` starts with `SYNC_MODE=dry-run`. Dry run reads ZKBio and prints counts/field names only; it never sends records to Supabase and never advances the cursor.
- The first run requires `SYNC_INITIAL_FROM`, so a full-history import cannot happen accidentally.
- `push` mode requires a dedicated Edge Function URL and machine token. No Supabase service-role key belongs on this Windows machine.
- Configure the Supabase migration and Edge Function in a **separate staging project first**. This package does not apply migrations, deploy functions, install its task, or connect to a production project automatically.
- Device status codes are preserved as returned; this service does not interpret them.

## Prerequisites

- Windows Server or the main Windows computer that can reach the existing ZKBio Time server.
- Node.js 24.19 or newer.
- API account for ZKBio Time (read-only permissions are preferred).
- Separate Supabase staging project, after its migration and Edge Function are reviewed and deployed.
- Employee `zkt_user_id` values aligned with ZKBio `emp_code`, and device serials linked to the correct branch in the staging database. Unmatched users remain stored with a null employee link for review.

## Configure and inspect (no Supabase writes)

1. Copy this folder to the central computer and copy `.env.example` to `.env`.
2. Fill ZKBio API account values and set `SYNC_INITIAL_FROM` to the desired initial import boundary, for example `2026-10-31T00:00:00+02:00`.
3. Keep `SYNC_MODE=dry-run` and run:

   ```powershell
   npm run live:validate
   npm run live:once
   ```

   Review the returned record field names. If the installed API uses different fields, edit the corresponding `ZKBIO_*_FIELD` settings in `.env` before proceeding. The verified API route names and `emp_code` came from the user-provided ZKBio test report; the remaining default response field names must be checked against this installation's live response.

## Stage before enabling delivery

1. Review and apply `supabase/migrations/20261031_zkbio_attendance_ingest.sql` **only to a staging project**.
2. Deploy `supabase/functions/zkbio-attendance-ingest/index.ts` to that staging project and set the function secrets `SYNC_INGEST_TOKEN` and `SUPABASE_SERVICE_ROLE_KEY` there.
3. Use a unique random `SYNC_INGEST_TOKEN` in the Windows `.env`; set `SUPABASE_INGEST_URL` to the staging function URL and change `SYNC_MODE=push` only after these steps.
4. Run `npm run live:validate`, then one manual `npm run live:once`. Confirm device/branch mapping and unmatched employee counts in staging. Do not point the service to production until the trial is accepted.

The service reads `/api-token-auth/`, `/iclock/api/terminals/`, and `/iclock/api/transactions/`; follows same-origin `next` pagination; rereads a configurable overlap window (30 minutes by default); and uses stable SHA-256 keys to make repeats idempotent. It stores its successful window locally in `state/live-state.json` and only advances after the final batch receives a successful response.

## Install 15-minute Windows background task

Run PowerShell as Administrator from this folder, after successful staging trial and after setting `SYNC_MODE=push`:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\install-background-task.ps1
```

The installer validates configuration, restricts `.env` to SYSTEM and Administrators, and registers a Task Scheduler task that starts at boot and repeats at the configured interval. It does not start a sync during installation. Check **Task Scheduler → Qararah HR → ZKBio attendance sync** and inspect `logs\sync.log` / `logs\sync-error.log`.

Remove it with:

```powershell
.\remove-background-task.ps1
```

## Limitations to resolve before production

- API documentation provided so far confirms the route and pagination shape, but actual transaction/device field names have not yet been sampled into this project. A dry run on the central server is needed to confirm them.
- ZKBio clock timestamps without an offset are interpreted using `Africa/Tripoli`; confirm the installation's configured device timezone.
- Device-to-branch relationships are maintained in `attendance_devices.branch_id` by an administrator in Supabase staging. Ingest preserves those branch mappings.
- Raw punch import does not infer entry/exit, lateness, early departure, overtime, or overnight shifts. Existing attendance calculations remain untouched until those rules are separately validated.
- No integration, migration, or scheduler has been run against a live ZKBio or Supabase system from this development workspace.
