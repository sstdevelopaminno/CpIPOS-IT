import { redirect } from "next/navigation";

// Existing installed IT PWAs can retain the previous manifest start_url.
// Keep this legacy entrypoint valid while the browser refreshes its manifest.
export default function LegacyInstalledAppEntry() {
  redirect("/it-admin");
}
