# Support Chat Phase 1 — Architecture

## Goal

Create two-way support chat between the POS subscription/payment screen and CpIPOS IT Control Plane.

The chat system is split from the primary POS database to control growth and isolate high-volume communication data.

## Database split

### CpiPOS-001 (existing primary project)

Authoritative data remains here:

- tenants / store identity
- tenant logo_url
- POS users and IT users
- subscriptions, payments, devices, MDM, orders
- audit logs
- compact support notification heads only

New compact mirror table:

- support_chat_heads
  - conversation_id
  - tenant_id
  - store_code
  - subject
  - status
  - assigned_role
  - assigned_user_id
  - latest_message_at
  - latest_message_preview
  - unread_it_count
  - unread_store_count
  - updated_at

This table is intentionally small and can be used with the existing authenticated Realtime connection.

### CpiPOS Communications (new Supabase project)

Canonical communication data:

- support_conversations
- support_messages
- support_participants
- support_message_receipts
- support_attachments (Phase 2)
- integration_events / webhook outbox (future)

The POS and IT web apps access this project server-side only. Service credentials must never be exposed to the browser.

## POS flow

Payment / Subscription page
→ Contact / Report Issue popup
→ new button: “คุยแชท”
→ first-contact form:
  - subject
  - store code (server-derived, read-only)
  - contact name
→ create conversation
→ open chat room

Store avatar:

- tenants.logo_url when present
- otherwise generated initials avatar

## IT flow

New main menu: Support Chat

Inbox groups:

- New
- Unassigned
- My chats
- In progress
- Closed

When IT Admin / IT Support accepts a conversation:

- assigned_user_id is recorded
- POS sees support employee full_name + role
- avatar_url is displayed when configured
- fallback is initials avatar

## IT profiles

Extend users_profiles in CpiPOS-001:

- avatar_url text null

Avatar upload/storage can be added after Phase 1. Phase 1 accepts URL/fallback initials.

## Notifications

Do not poll every few seconds.

Use CpiPOS-001 support_chat_heads as the small authenticated Realtime notification surface.

On every new message:

1. write canonical message to Communications project
2. update support_chat_heads in CpiPOS-001
3. existing Supabase Realtime notifies IT/POS clients
4. browser sound/toast is shown only for a new event

The full message history is loaded on demand from Communications project through server APIs.

## Security

- POS APIs derive tenant_id from the authenticated POS session; never trust tenant_id/store_code supplied by the browser.
- IT APIs require IT Admin or IT Support.
- IT assignment/reply/close actions are audited.
- Communications Supabase service role stays server-only.
- message body limit Phase 1: 4,000 UTF-8 characters.
- rate limits:
  - create conversation: 5 / 10 min / tenant
  - send message: 30 / 5 min / conversation
- no arbitrary HTML in chat messages.

## Phase 1 files

### CpIPOS

Add:

- src/app/api/pos/support-chat/conversations/route.ts
- src/app/api/pos/support-chat/conversations/[conversationId]/messages/route.ts
- src/lib/services/support-chat/communications-client.ts
- src/lib/services/support-chat/pos-support-chat-service.ts
- src/components/pos-preview/pos-support-chat.tsx

Modify:

- src/components/pos-preview/pos-subscription-center.tsx
- src/lib/services/pos-subscription-center-service.ts

### CpIPOS-IT

Add:

- src/app/(it-admin)/it-admin/support-chat/page.tsx
- src/app/api/it-admin/v1/support-chat/conversations/route.ts
- src/app/api/it-admin/v1/support-chat/conversations/[conversationId]/route.ts
- src/app/api/it-admin/v1/support-chat/conversations/[conversationId]/messages/route.ts
- src/components/it-admin/support-chat-console.tsx
- src/lib/support-chat/communications-client.ts
- src/lib/support-chat/support-chat-service.ts

Modify:

- src/app/(it-admin)/layout.tsx
- src/components/it-admin/it-system-users-console.tsx
- src/app/api/it-admin/v1/it-users/route.ts

### Database migrations

Existing CpiPOS-001:

- support_chat_heads
- users_profiles.avatar_url
- RLS policies for compact notification heads

New Communications project:

- support_conversations
- support_messages
- support_participants
- indexes / retention-ready timestamps

## Retention

Phase 1:

- conversations/messages are retained
- no automatic deletion

Phase 2:

- attachments move to Communications Storage
- closed chat message retention policy can be introduced separately
- archival exports can be written to object storage before deletion if required

## Important quota note

Splitting communications into a second Supabase project reduces growth pressure on the primary database because database size is per project.

It does not multiply organization-wide usage quotas such as Realtime messages or egress. Those are still billed/limited at the organization level.

The current primary database must still receive its own retention strategy because audit_logs and device health snapshots remain its largest growth sources.
