# CpIPOS Gmail / Apps Script mail bridge

This bridge is used only for transactional customer emails from **CpIPOS-IT**:

- store activation / Store Code ready;
- verified subscription payment + package activation/renewal confirmation.

## One-time setup

1. Create a Google Apps Script project while signed in to the Gmail account that should send CpIPOS customer mail.
2. Copy `Code.gs` from this folder into the Apps Script project.
3. In **Project Settings → Script Properties**, create `CPIPOS_MAIL_BRIDGE_SECRET` with a long random value.
4. Deploy as **Web app**, execute as **Me**.
5. Put the Web App URL in the CpIPOS-IT deployment secret `CPIPOS_MAIL_BRIDGE_URL`.
6. Put the same secret in `CPIPOS_MAIL_BRIDGE_SECRET`.
7. In IT Admin → Subscription Payments → email settings, choose whether activation and payment confirmations should send automatically.

The application never stores Gmail credentials in Supabase. The bridge can only send messages when the Vercel secret matches the Apps Script property.

## Duplicate protection

The database has one unique `event_key` per activation or receipt. Automatic and manual buttons use the same key, so the same event cannot be successfully sent twice. Failed/blocked attempts have a 5-minute retry cooldown. The Apps Script also caches the same key for six hours to suppress immediate network retries.

## Safety

PINs are never included in emails. Known typo domains such as `amil.com` are blocked and surfaced to IT for correction instead of silently changing the customer's address.
