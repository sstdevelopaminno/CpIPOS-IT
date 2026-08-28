# CpIPOS IT Admin — Current Handoff Context

Last updated: 2026-08-28 (Thailand time)

## Rule for every new ChatGPT/Codex session

Before answering or changing code, read this file first and treat it as the current handoff for the IT Admin + MDM work. Then verify any time-sensitive deployment/database state with the connected GitHub, Vercel, and Supabase sources before claiming completion.

Do not reconstruct state from old chat memory when it conflicts with this file or live connected sources.

## Repositories

- IT Admin source of truth: `sstdevelopaminno/CpIPOS-IT`
- Customer POS source of truth: `sstdevelopaminno/CpIPOS`

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

Do not move orders/payments/products/stock into IT operational tables.

---

# CURRENT PRIORITY — DO THESE IN ORDER

There are two separate lanes. Keep them separated.

## Lane 1 — POS Production stabilization / release gate

Repository: `sstdevelopaminno/CpIPOS`

Current live GitHub state verified 2026-08-28:
- PR #154 is OPEN and DRAFT.
- Title: `fix(pos): stabilize current production runtime without IT cutover`
- Head branch: `release/pos-stable-20260828`
- Head SHA: `200975b22e0c30a121e15bd1eb6d0e1abdd005a4`
- Base branch: `release/pos-prod-base-20260828`
- Base SHA / exact customer-serving baseline: `4599a339ebfc7ecd4b7d6e31bf8f006ca284a270`
- PR is mergeable but MUST NOT be merged until release acceptance is complete.

PR #154 safety boundary:
- no DB/schema/RLS/data mutation
- no order/payment/stock transaction change
- no printer profile/IP/assignment/routing mutation
- no Table QR/Kitchen business-flow change
- no IT data-plane cutover

Latest verified deployment state for PR #154 head:
- Vercel `cp-ipos-backoffice-web`: SUCCESS / deployment completed
- Vercel `cp-ipos-web`: SUCCESS / deployment completed
- Vercel Preview Comments: SUCCESS
- GitHub Actions workflow run for this exact head was not present at last verification; do not treat Vercel-only success as full CI acceptance.

### POS immediate next action

1. Run/verify the repository CI for exact head `200975b2...` / branch `release/pos-stable-20260828`.
2. Require typecheck + lint + tests + build to pass for the exact release candidate.
3. Test Vercel Preview critical POS flow without changing FF0001 business data unnecessarily:
   - login/session
   - device policy / registered device
   - open/join existing shift behavior
   - load products/cart
   - current shift order/payment history
   - printer wake path / Android Print Agent behavior
4. Verify no version drift between POS web and backoffice previews.
5. Use FF0001 as acceptance/telemetry target only. DO NOT reset FF0001 and DO NOT destroy customer orders, payments, shifts, or printer configuration.
6. Merge PR #154 only after CI + Vercel + manual critical-flow acceptance are green.

---

## Lane 2 — IT Backoffice + MDM control plane

Repository: `sstdevelopaminno/CpIPOS-IT`

### IT Admin repository status

- Source branch: `main`
- PR #2 `fix(it): harden POS control-plane API integration` is MERGED.
- Merge commit: `7370fd1fa9e4b2615f72605e863f9e86ab66e0a7`
- IT login page exists at `/it-admin/login` and uses Supabase email/password authentication.

### Existing Vercel IT project — DO NOT CREATE A NEW PROJECT

Existing project:
- Project name: `cp-ipos-it-backoffice-web`
- Production domain: `https://cp-ipos-it-backoffice-web.vercel.app`
- Git repo: `sstdevelopaminno/CpIPOS-IT`
- Root directory: `apps/backoffice-web`

Last confirmed handoff state:
- old Production deployment is READY on commit `f79ed0f735de8e2d1bb276c094533e8c94025b5c`
- latest split-plane deployment was ERROR
- do not delete old READY deployment until latest build is READY and smoke-tested

### Required Vercel environment contract for IT project

Verify all 5 variables for BOTH Production and Preview:

1. `NEXT_PUBLIC_SUPABASE_URL` — CpiPOS-001
2. `NEXT_PUBLIC_SUPABASE_ANON_KEY` — CpiPOS-001
3. `SUPABASE_SERVICE_ROLE_KEY` — CpiPOS-001 secret
4. `IT_SUPABASE_URL` — CpiPOS-002 (`https://kawenyvpentwgugtzqec.supabase.co`)
5. `IT_SUPABASE_SERVICE_ROLE_KEY` — CpiPOS-002 secret

Never paste service-role keys into chat, docs, commits, screenshots, or source code.

### IT deployment immediate next action

1. Verify the 5 env variables in existing `cp-ipos-it-backoffice-web` for Production + Preview.
2. Redeploy latest `CpIPOS-IT/main`.
3. Require deployment READY.
4. Smoke test:
   - `/it-admin/login` loads
   - unauthenticated protected APIs return expected auth rejection, not 500
   - valid IT-admin login opens `/it-admin`
   - IT health/device/monitor APIs use CpiPOS-002 for operational IT data
5. Keep the old READY Production deployment until the new one is proven READY.

---

# MDM — REQUIRED FOR IT CUSTOMER SUPPORT

Goal: IT staff must be able to open a customer device and understand the actual machine/app/printing condition without touching POS business transactions.

## Existing control-plane foundation

CpiPOS-002 already contains operational tables including:
- `it_devices`
- `it_device_health_latest`
- `it_device_health_snapshots`
- `it_device_incidents`
- `it_device_commands`

The health schema already has fields for:
- device identity / hostname / machine id
- app version / runtime version
- connectivity
- `system_health`
- `runtime_health`
- `peripheral_health`
- `offline_sale_health`
- security signals
- last error
- captured/last-seen timestamps

## Current live MDM gap — verified 2026-08-28

Devices:
- `FF0001-POS-01`
- `FF0001-POS-02`

Both exist in `CpiPOS-002.public.it_devices` with active registry status.

However, at last live query BOTH had no matching usable health payload in `it_device_health_latest`:
- health status: null
- health last seen: null
- app version: null
- runtime version: null
- system health: null
- runtime health: null
- peripheral health: null
- offline sale health: null
- last error: null

Therefore MDM is NOT yet operationally complete. The IT UI/schema may exist, but CPU/RAM/storage/runtime/printer health cannot yet be trusted until real telemetry is produced and stored.

## MDM acceptance target

For each customer POS device, IT must be able to see at minimum:

- online/offline state
- last heartbeat / last seen
- tenant / branch / device code
- hardware model / device identity
- OS / Android version where available
- POS app version
- runtime/agent version
- CPU utilization or CPU health summary
- RAM usage / pressure
- storage usage / free space
- network/connectivity health
- Android app/agent rollout/update status
- Print Agent version + heartbeat
- printer online/offline/error state
- print queue / last print / last print error where available
- last application/runtime error
- offline-sale sync health
- active warning/critical incidents
- device locked/unlocked state
- remote-command lifecycle: pending → delivered → ACK/result
- audit trail for IT actions

## MDM architecture boundary

- Customer device/agent MUST NOT hold the CpiPOS-002 service-role key.
- Customer device/agent MUST NOT directly choose/write privileged Supabase operational tables.
- Device telemetry must call an authenticated server/API endpoint.
- Server validates tenant/device/session/scope and writes operational telemetry into CpiPOS-002.
- POS auth/session/business transactions remain authoritative in CpiPOS-001.
- IT operational health/incident/remote-command state lives in CpiPOS-002.

## MDM immediate next action

After/alongside the IT deployment smoke gate, trace the telemetry path end-to-end with targeted file inspection only:

1. Android/POS runtime heartbeat producer
2. Print Agent heartbeat / printer status producer
3. authenticated heartbeat API endpoint
4. server-side validation / device identity mapping
5. write into CpiPOS-002 `it_device_health_latest`
6. periodic/history write into `it_device_health_snapshots`
7. warning/critical promotion into `it_device_incidents`
8. IT UI reads and renders live device health
9. remote command delivery + ACK updates `it_device_commands`

First success criterion:
- run a real heartbeat from a test/customer device without faking data
- confirm `it_device_health_latest` receives non-null current health
- confirm IT Backoffice displays the same values
- confirm Print Agent/printer health appears separately from generic device online status

Do not insert fake FF0001 health data merely to make the dashboard look green.

---

# Important historical POS/IT cutover note

CpIPOS PR #151 `fix(it-plane): cut POS device operations over to CpiPOS-002` is MERGED, but it was merged into base branch `agent/fg-ff-platform-normalization`, not into the POS production release branch used by PR #154.

PR #151 scope included:
- heartbeat writes → CpiPOS-002 health/latest/snapshots/incidents
- pending remote commands → CpiPOS-002 `it_device_commands`
- ACK results → CpiPOS-002 `it_device_commands`
- POS session/auth/business transactions remain on CpiPOS-001

Do NOT assume that PR #151 is active in current customer Production simply because the PR itself is merged.

---

# Do not repeat these mistakes

- Do NOT create a new Vercel IT project.
- Do NOT delete old READY IT Production before the replacement is READY.
- Do NOT guess env values or secrets.
- Do NOT ask the user to paste service-role secrets into chat.
- Do NOT merge POS PR #154 solely because Vercel previews are green; exact-head CI + critical-flow acceptance are required.
- Do NOT mix MDM/IT-plane changes into the POS stabilization release.
- Do NOT reset FF0001 or destroy customer transactions to test MDM.
- Do NOT fake health rows for FF0001.
- Do NOT move POS orders/payments/products/stock into CpiPOS-002 operational tables.

---

# NEXT SESSION — START HERE

Do these steps before writing code:

1. Read this `context.md` from `CpIPOS-IT/main`.
2. Verify live GitHub status of:
   - CpIPOS PR #154
   - exact head SHA / checks / Vercel statuses
   - CpIPOS-IT main
3. Verify CpiPOS-002 health for FF0001 devices.
4. Continue the first unfinished item from:
   - POS immediate next action
   - IT deployment immediate next action
   - MDM immediate next action
5. Keep POS release stabilization and IT/MDM work isolated.

## New-chat startup prompt

Paste this in a new chat:

`ทำงานต่อ CpIPOS POS + IT Admin/MDM ก่อนตอบหรือแก้โค้ดให้อ่าน sstdevelopaminno/CpIPOS-IT context.md จาก main ก่อนทุกครั้ง แล้วตรวจสถานะสดจาก GitHub/Vercel/Supabase จากนั้นทำต่อจาก CURRENT PRIORITY และ Immediate next action ในไฟล์ ห้ามสร้าง Vercel project ใหม่ ห้ามเดา env/secret ห้าม reset FF0001 ห้ามใส่ health ปลอม และต้องแยก POS release lane ออกจาก IT/MDM lane`