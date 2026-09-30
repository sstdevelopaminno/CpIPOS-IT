import { fail, ok } from "@/lib/http";
import { appendAuditLog } from "@/lib/audit-log";
import { guardItAdminError, requireItAdmin } from "@/lib/it-admin-guard";

export const dynamic="force-dynamic";
const BUCKET="cpipos-ai-documents";

export async function DELETE(_request:Request,context:{params:Promise<{documentId:string}>}){
  try{
    const admin=await requireItAdmin();
    const {documentId}=await context.params;
    const row=await admin.supabase.from("pos_ai_documents")
      .select("id,tenant_id,title,storage_path")
      .eq("id",documentId).maybeSingle<{id:string;tenant_id:string;title:string;storage_path:string}>();
    if(row.error) throw new Error(row.error.message);
    if(!row.data) return fail("ai_document_not_found","ไม่พบเอกสาร",404);
    const removed=await admin.supabase.storage.from(BUCKET).remove([row.data.storage_path]);
    if(removed.error) throw new Error(removed.error.message);
    const deleted=await admin.supabase.from("pos_ai_documents").delete().eq("id",documentId);
    if(deleted.error) throw new Error(deleted.error.message);
    await appendAuditLog({
      tenantId:row.data.tenant_id,
      actorUserId:admin.auth.userId,
      actorRole:admin.auth.platformRole,
      action:"it_ai_document_deleted",
      targetTable:"pos_ai_documents",
      targetId:documentId,
      beforeData:{title:row.data.title,storage_path:row.data.storage_path} as never,
      ipAddress:admin.requestMeta.ipAddress??undefined,
      userAgent:admin.requestMeta.userAgent??undefined
    });
    return ok({deleted:true});
  }catch(error){return guardItAdminError(error);}
}
