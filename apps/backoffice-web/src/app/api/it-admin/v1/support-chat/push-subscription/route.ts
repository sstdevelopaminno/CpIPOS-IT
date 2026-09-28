import { fail, ok } from "@/lib/http";
import { guardItAdminError, requireItAdmin } from "@/lib/it-admin-guard";

export const dynamic="force-dynamic";

type SubscriptionInput={endpoint?:string;keys?:{p256dh?:string;auth?:string}};

export async function GET(){
  try{
    const {supabase}=await requireItAdmin();
    const config=await supabase.from("support_push_config").select("vapid_public_key").eq("id","default").single<{vapid_public_key:string}>();
    if(config.error||!config.data?.vapid_public_key)return fail("push_config_missing","Push notification is not configured.",503);
    return ok({public_key:config.data.vapid_public_key});
  }catch(error){return guardItAdminError(error);}
}

export async function POST(request:Request){
  try{
    const {auth,supabase,requestMeta}=await requireItAdmin();
    const body=await request.json().catch(()=>null) as SubscriptionInput|null;
    const endpoint=String(body?.endpoint??"").trim();
    const p256dh=String(body?.keys?.p256dh??"").trim();
    const authKey=String(body?.keys?.auth??"").trim();
    if(!endpoint.startsWith("https://")||!p256dh||!authKey)return fail("push_subscription_invalid","Invalid push subscription.",422);
    const result=await supabase.from("support_push_subscriptions").upsert({
      audience_type:"it",tenant_id:null,user_id:auth.userId,endpoint,p256dh,auth:authKey,
      user_agent:requestMeta.userAgent,enabled:true,updated_at:new Date().toISOString(),last_seen_at:new Date().toISOString()
    },{onConflict:"endpoint"});
    if(result.error)throw result.error;
    return ok({subscribed:true});
  }catch(error){return guardItAdminError(error);}
}
