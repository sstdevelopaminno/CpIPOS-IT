export const FEATURE_UNLOCK_ENV = "NEXT_PUBLIC_POS_DEV_UNLOCK_ALL_FEATURES";

export function isFeatureUnlockEnabled() {
  // Development unlocks must never bypass subscription enforcement in production.
  if (process.env.NODE_ENV === "production") return false;

  const value = String(
    process.env.NEXT_PUBLIC_POS_DEV_UNLOCK_ALL_FEATURES ?? process.env.POS_DEV_UNLOCK_ALL_FEATURES ?? ""
  )
    .trim()
    .toLowerCase();

  return value === "true" || value === "1" || value === "yes" || value === "on";
}
