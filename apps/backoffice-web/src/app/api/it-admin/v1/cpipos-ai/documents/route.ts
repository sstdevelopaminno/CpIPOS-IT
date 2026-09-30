import { ok } from "@/lib/http";
import { guardItAdminError, requireItAdmin } from "@/lib/it-admin-guard";

export const dynamic="force-dynamic";

export async function GET(){
  try{
    const context=await requireItAdmin();
    const db=context.supabase;
    const [documents,tenants]=await Promise.all([
      db.from("pos_ai_documents")
        .select("id,tenant_id,branch_id,user_id,source_room_id,title,document_type,file_name,mime_type,storage_path,size_bytes,created_at,expires_at")
        .order("created_at",{ascending:false}).limit(1000),
      db.from("tenants").select("id,code,name,display_name")
    ]);
    if(documents.error) throw new Error(documents.error.message);
    if(tenants.error) throw new Error(tenants.error.message);
    const tenantMap=new Map((tenants.data??[]).map((row)=>[row.id,row]));
    const rows=(documents.data??[]).map((row)=>{
      const tenant=tenantMap.get(row.tenant_id);
      return {...row,store_code:tenant?.code??"—",store_name:tenant?.display_name||tenant?.name||"—"};
    });
    const totalBytes=rows.reduce((sum,row)=>sum+Number(row.size_bytes??0),0);
    const byTenant=Array.from(rows.reduce((map,row)=>{
      const current=map.get(row.tenant_id)??{tenant_id:row.tenant_id,store_code:row.store_code,store_name:row.store_name,files:0,size_bytes:0};
      current.files+=1; current.size_bytes+=Number(row.size_bytes??0); map.set(row.tenant_id,current); return map;
    },new Map<string,{tenant_id:string;store_code:string;store_name:string;files:number;size_bytes:number}>()).values());
    const response=ok({rows,summary:{files:rows.length,total_bytes:totalBytes,stores:byTenant.length},by_tenant:byTenant});
    response.headers.set("cache-control","private, no-store");
    return response;
  }catch(error){return guardItAdminError(error);}
}
