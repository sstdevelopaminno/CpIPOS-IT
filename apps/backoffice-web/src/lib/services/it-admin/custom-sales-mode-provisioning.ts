import "server-only";

import { ItAdminGuardError, type ItAdminContext } from "@/lib/it-admin-guard";
import type { PosSalesModeMap } from "@/lib/pos-sales-modes";

type ServiceDb = ItAdminContext["supabase"];

export type CustomSalesModeProvisioned = {
  menus: string[];
  features: string[];
};

/**
 * CUSTOM mode licences are reusable for ANY tenant. An explicit IT-selected
 * recycling/ordinary retail mode inherits the common POS UI and necessary
 * navigation, not a store-code-specific workaround.
 *
 * This is called only by IT-authenticated contract actions, before the grant
 * becomes effective. Do NOT overwrite explicit menu/feature denials; those
 * must be reviewed by IT. It never touches products, transactions or billing.
 */
export async function ensureCustomSalesModePrerequisites(
  db: ServiceDb, tenantId: string, modes: PosSalesModeMap
): Promise<CustomSalesModeProvisioned> {
  const needsCashier = modes.general_sale || modes.optical_retail || modes.recycling;
  if (!needsCashier) return { menus: [], features: [] };

  const desiredMenus = modes.recycling
    ? ["main.sales", "main.more", "more.stock"]
    : ["main.sales"];
  const desiredFeatures = modes.recycling
    ? ["core_pos_sales", "stock_management"]
    : ["core_pos_sales"];

  const [menus, features, catalogue] = await Promise.all([
    db.from("tenant_pos_menu_policies").select("menu_key,is_enabled")
      .eq("tenant_id", tenantId).in("menu_key", desiredMenus),
    db.from("tenant_feature_subscriptions")
      .select("branch_id,feature_code,is_enabled")
      .eq("tenant_id", tenantId).in("feature_code", desiredFeatures),
    db.from("package_feature_catalog").select("code,is_active").in("code", desiredFeatures)
  ]);
  if (menus.error || features.error || catalogue.error) {
    throw new ItAdminGuardError("custom_mode_dependency_lookup_failed",
      "ตรวจสอบสิทธิ์เมนูและฟีเจอร์ CUSTOM ไม่สำเร็จ กรุณาลองใหม่โดยไม่เปลี่ยนสิทธิ์ร้าน", 503);
  }
  if (catalogue.data?.some(item=>item.is_active !== true) ||
      desiredFeatures.some(key => !catalogue.data?.some(item=>item.code === key))) {
    throw new ItAdminGuardError("custom_mode_feature_catalog_missing",
      "ฟีเจอร์พื้นฐานหน้าขายหรือสต๊อกไม่มีในรายการกลาง ฝ่าย IT ต้องตรวจสอบก่อนเปิดโหมด", 409);
  }
  // A deliberate denial always wins. Never overwrite an IT restriction.
  if ((menus.data??[]).some(item=>item.is_enabled === false) ||
      (features.data??[]).some(item=>item.is_enabled === false)) {
    throw new ItAdminGuardError("custom_mode_dependency_explicitly_disabled",
      "ร้านนี้มีเมนูหน้าขายหรือฟีเจอร์ที่ IT ปิดไว้โดยตั้งใจ กรุณาปรับสิทธิ์ดังกล่าวก่อนเปิดโหมด CUSTOM", 409);
  }
  const missingMenus = desiredMenus.filter(key =>
    !(menus.data??[]).some(item=>item.menu_key === key));
  const missingFeatures = desiredFeatures.filter(key =>
    !(features.data??[]).some(item=>item.feature_code === key && item.branch_id === null));

  if (missingMenus.length) {
    const {error} = await db.from("tenant_pos_menu_policies")
      .upsert(missingMenus.map(menu_key=>({tenant_id:tenantId,menu_key,is_enabled:true})),
        {onConflict:"tenant_id,menu_key",ignoreDuplicates:true});
    if (error) throw new ItAdminGuardError("custom_mode_menu_provision_failed",
      "กำหนดสิทธิ์เมนูหน้าขาย CUSTOM ไม่สำเร็จ กรุณาตรวจสอบก่อนเปิดโหมด", 503);
  }
  for (const feature_code of missingFeatures) {
    // A null branch_id applies tenant-wide. Query before insertion because
    // PostgreSQL UNIQUE permits multiple NULL branch ids on legacy tables.
    const {data: current,error:lookupError} = await db.from("tenant_feature_subscriptions")
      .select("id,is_enabled").eq("tenant_id",tenantId)
      .eq("feature_code",feature_code).is("branch_id",null).limit(1).maybeSingle();
    if (lookupError) throw new ItAdminGuardError("custom_mode_feature_lookup_failed",
      "ตรวจสอบสิทธิ์ฟีเจอร์หน้าขายไม่สำเร็จ",503);
    if (current?.is_enabled === false) throw new ItAdminGuardError(
      "custom_mode_dependency_explicitly_disabled",
      "ฟีเจอร์หน้าขาย CUSTOM ถูกปิดโดย IT จึงเปิดโหมดไม่ได้",409);
    if (current) continue;
    const {error} = await db.from("tenant_feature_subscriptions").insert({
      tenant_id:tenantId,branch_id:null,feature_code,is_enabled:true,source:"override"
    });
    if (error) throw new ItAdminGuardError("custom_mode_feature_provision_failed",
      "กำหนดฟีเจอร์พื้นฐาน CUSTOM ไม่สำเร็จ กรุณาตรวจสอบสิทธิ์ร้าน",503);
  }

  return {menus:missingMenus,features:missingFeatures};
}
