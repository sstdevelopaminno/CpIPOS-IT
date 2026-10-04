# LINE OA → CpIPOS Support Gateway

Date: 2026-10-04
Branch: `feat/line-support-gateway-20261004`

## Goal

Allow a customer to tap **ติดต่อ Support** from the LINE Official Account, open a LIFF page, verify the store, and chat directly with the existing CpIPOS IT Support Chat without routing the conversation through LINE Messaging API.

## Existing architecture reused

- IT UI: `/it-admin/support-chat`
- Canonical chat data: CpiPOS-Communications
- IT realtime notification mirror: CpiPOS-001 `support_chat_heads`
- Cross-project HMAC bridge: `issue_support_chat_bridge_token` → Communications `verify_support_chat_bridge_token`
- Existing Support Chat actions: create, list, get messages, send, claim, status, close

No second chat system is introduced.

## Customer flow

1. Customer taps the LINE OA rich-menu item.
2. LINE opens LIFF endpoint `/support/line`.
3. Browser receives a LINE ID token through LIFF.
4. CpIPOS server verifies that ID token with LINE Login using `LINE_LOGIN_CHANNEL_ID`.
5. Customer enters the immutable six-digit CpIPOS store code.
6. First use only:
   - server resolves the store from CpiPOS-001;
   - OTP is sent to the primary Owner email;
   - successful OTP verification creates `line_support_bindings`.
7. Later visits:
   - verified LINE user + store binding is enough;
   - a short-lived HttpOnly support session is issued.
8. The customer page opens/reuses the canonical Support Chat conversation.
9. Messages are persisted in CpiPOS-Communications and mirrored to `support_chat_heads`, so the existing IT inbox receives them.
10. **จบการสนทนา** closes the canonical conversation and clears the external support session.

## Security decisions

- Store code is an identifier, never an authentication secret.
- Browser never receives a Supabase service-role key.
- LINE ID token is verified server-side before any binding/session action.
- First binding requires Owner-email OTP.
- OTP plaintext is never stored; only an HMAC-SHA256 digest is stored.
- OTP is single-use, ten-minute expiry, maximum five attempts.
- Binding and OTP tables have RLS enabled and no `anon`/`authenticated` access.
- Support cookie is HttpOnly, signed, 30-minute TTL, and the binding is re-checked on each API request.
- Public auth/chat endpoints use the existing distributed-capable rate limiter.
- Tenant ID and store identity are always derived server-side.
- Page exit performs best-effort logout; the cookie TTL remains the fail-safe if the mobile WebView is killed before the beacon is delivered.

## Required configuration

IT web deployment:

- `NEXT_PUBLIC_LINE_LIFF_ID` — public LIFF ID
- `LINE_LOGIN_CHANNEL_ID` — LINE Login channel ID used to verify ID tokens
- `LINE_SUPPORT_SESSION_SECRET` — random server-only secret, minimum 32 characters
- existing Support Mail bridge secret/config must remain available for first-use OTP delivery
- production rate limiter should keep the existing Upstash-backed configuration

LINE Developers:

- Create/use a LINE Login channel linked to the Official Account.
- Add a LIFF app whose endpoint URL is:
  `https://<IT-WEB-DOMAIN>/support/line`
- Enable at least `openid` and `profile` scopes.
- Rich-menu **ติดต่อ Support** URI:
  `https://liff.line.me/<LIFF_ID>`

## Database

Source migration:

`supabase/migrations/20261004133000_line_support_gateway_identity.sql`

Adds:

- `line_support_bindings`
- `line_support_verification_challenges`

The migration is intentionally additive and must be applied to **CpiPOS-001 only** after PR validation. It does not modify tenant, store-code, POS-session, sales, payment, MDM, or chat-message schemas.

## Current delivery boundary

This branch adds the secure external entry surface and text chat. Existing IT chat image support remains unchanged. Customer-side image upload can be added after the text flow is production-verified.

The LIFF customer page refreshes the active conversation every 10 seconds while visible and immediately on focus. Canonical chat and IT-side notifications remain Realtime-backed. A later external-client Realtime authorization phase can replace this bounded customer polling without exposing database credentials.
