# CpIPOS IT Admin — Current Handoff Context

Last updated: 2026-08-28 (Thailand time)

## Rule for every new ChatGPT/Codex session

Before answering or changing code, read this file first and treat it as the current handoff for the IT Admin work. Then verify any time-sensitive deployment/database state with the connected GitHub, Vercel, and Supabase sources before claiming completion.

Do not reconstruct state from old chat memory when it conflicts with this file or live connected sources.

## Repositories

- IT Admin source of truth: `sstdevelopaminno/CpIPOS-IT`
- Customer POS source of truth: `sstdevelopaminno/CpIPOS`

## IT Admin repository status

- Branch: `main`
- PR #2 `fix(it): harden POS control-plane API integration` is MERGED.
- Merge commit: `7370fd1fa9e4b2615f72605e863f9e86ab66e0a7`
- The IT login page exists at `/it-admin/login` and uses Supabase email/password authentication.

## Current Vercel IT project — DO NOT CREATE A NEW PROJECT

Existing Vercel project:
- Project name: `cp-ipos-it-backoffice-web`
- Production domain: `https://cp-ipos-it-backoffice-web.vercel.app`
- Git repo: `sstdevelopaminno/CpIPOS-IT`
- Root directory: `apps/backoffice-web`

Current observed Vercel state from the user's dashboard on 2026-08-28:
- Existing Production deployment is READY on old commit `f79ed0f735de8e2d1bb276c094533e8c94025b5c` (`chore: finalize IT Admin repository separation contract`).
- New deployment from the merged CpiPOS-002 split-plane work is ERROR.
- Therefore IT Production is NOT yet running the latest merged code.
- Do not delete the old READY Production deployment; keep it until the new build is READY.

## Database architecture

### CpiPOS-001
Project ref: `deejlitaivfnsbwqdugy`
Purpose:
- Supabase Auth
- tenant/business/POS authoritative data
- customer POS business transactions

### CpiPOS-002
Project ref: `kawenyvpentwgugtzqec`
Purpose:
- IT operational control plane
- IT device registry
- device health/latest/snapshots
- incidents
- remote device commands
- IT audit/operational state

Do not move orders/payments/products/stock into the IT operational tables.

## Required Vercel environment contract for `cp-ipos-it-backoffice-web`

The latest `apps/backoffice-web/.env.example` requires the IT deployment to have both Primary/Auth and IT-plane credentials.

Required for the current cutover:

1. `NEXT_PUBLIC_SUPABASE_URL`
   - CpiPOS-001
   - Config/public runtime value
2. `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - CpiPOS-001
   - Config/public runtime value
3. `SUPABASE_SERVICE_ROLE_KEY`
   - CpiPOS-001
   - Secret
4. `IT_SUPABASE_URL`
   - CpiPOS-002
   - Config
   - known URL: `https://kawenyvpentwgugtzqec.supabase.co`
5. `IT_SUPABASE_SERVICE_ROLE_KEY`
   - CpiPOS-002
   - Secret

Apply the required variables to BOTH Production and Preview.

Never paste service-role keys into chat, docs, commits, screenshots, or source code.

## Immediate next action

1. Open Vercel project `cp-ipos-it-backoffice-web`.
2. Open `Environment Variables`.
3. Verify all 5 required variables above exist for both Production and Preview.
4. Save.
5. Open `Deployments`.
6. Redeploy the latest ERROR deployment from `main` / merged PR #2.
7. Wait for status READY.
8. Then test:
   - `/it-admin/login` must load.
   - unauthenticated protected IT APIs must return the expected auth rejection rather than 500.
   - after a valid IT-admin login, `/it-admin` must load.
   - IT health/monitor/device APIs must use CpiPOS-002 for operational IT data.
9. Only after the new deployment is READY and smoke tests pass should it replace the old Production deployment.

## Important: do not repeat these previous mistakes

- Do NOT say the Vercel IT project is missing. The project exists; the dashboard shows it.
- Do NOT create another `cp-ipos-it-backoffice-web` project.
- Do NOT delete the old READY Production deployment before the new deployment is proven READY.
- Do NOT claim latest IT Production is live while Vercel still serves commit `f79ed0f...`.
- Do NOT assume 3 Supabase env variables are sufficient; current split-plane contract requires 5 core variables.
- Do NOT ask the user to paste service-role secrets into chat.

## Development continuation

The IT codebase can be developed further from `CpIPOS-IT/main` now. However, Production acceptance is still blocked by the failed latest Vercel deployment. Finish the environment/redeploy/login smoke gate first so future IT feature work has a reliable Preview/Production target.

## New-chat startup prompt

Paste this in a new chat:

`ทำงานต่อระบบ IT Admin ของ sstdevelopaminno/CpIPOS-IT ก่อนตอบหรือแก้โค้ดให้อ่าน context.md จาก main ก่อนทุกครั้ง แล้วตรวจสถานะสดจาก GitHub/Vercel/Supabase จากนั้นทำต่อจาก Immediate next action ใน context.md ห้ามสร้าง Vercel project ใหม่ ห้ามเดา env หรือ secret และห้ามย้อนกลับไปใช้สถานะจากแชทเก่าถ้าขัดกับ context.md`
