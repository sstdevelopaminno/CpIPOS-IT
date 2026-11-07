import { randomUUID } from "node:crypto";
import { guardItAdminError, ItAdminGuardError, requireItAdmin } from "@/lib/it-admin-guard";
import { ok } from "@/lib/http";

export const runtime = "nodejs";
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

function safeExtension(type: string, bytes: Uint8Array) {
  if (type === "image/png" && bytes.length >= 8 &&
      bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
      bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return "png";
  if (type === "image/jpeg" && bytes.length >= 4 &&
      bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  if (type === "image/webp" && bytes.length >= 12 &&
      String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
      String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "webp";
  throw new ItAdminGuardError("invalid_news_image", "Only valid PNG, JPG or WEBP images may be uploaded.", 422);
}

export async function POST(request: Request) {
  try {
    const { supabase } = await requireItAdmin();
    const form = await request.formData();
    const file = form.get("image");
    if (!(file instanceof File) || file.size < 8 || file.size > MAX_IMAGE_BYTES) {
      throw new ItAdminGuardError("invalid_image_size", "News images must be smaller than 2 MB.", 422);
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const ext = safeExtension(file.type, bytes);
    const path = "news/" + randomUUID() + "." + ext;
    const result = await supabase.storage.from("platform-news").upload(path, bytes, {
      contentType: file.type, upsert: false, cacheControl: "3600"
    });
    if (result.error) throw new Error("news_image_upload_failed");
    const url = supabase.storage.from("platform-news").getPublicUrl(path).data.publicUrl;
    return ok({ image_url: url });
  } catch (error) { return guardItAdminError(error); }
}
