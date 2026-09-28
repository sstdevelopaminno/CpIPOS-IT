-- Keep IT identity rows required by audit/history foreign keys while
-- allowing operators to remove the account from the live IT control plane.
alter table public.users_profiles
  add column if not exists archived_at timestamptz;

comment on column public.users_profiles.archived_at is
  'Soft-delete marker. IT user removal revokes login and preserves the profile for immutable audit/history references.';
