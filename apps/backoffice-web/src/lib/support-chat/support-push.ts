import "server-only";

type SupportPushInput={
  audience:"it"|"store";tenant_id?:string|null;kind:"chat"|"request"|"general";
  title:string;body:string;url:string;tag?:string;
};

export async function dispatchSupportPush(input:SupportPushInput){
  const baseUrl=String(process.env.NEXT_PUBLIC_SUPABASE_URL??"").trim().replace(/\/$/,"");
  const serviceRole=String(process.env.SUPABASE_SERVICE_ROLE_KEY??"").trim();
  if(!baseUrl||!serviceRole)return;
  const response=await fetch(`${baseUrl}/functions/v1/support-push-dispatch`,{
    method:"POST",
    headers:{authorization:`Bearer ${serviceRole}`,apikey:serviceRole,"content-type":"application/json"},
    body:JSON.stringify(input),cache:"no-store"
  });
  if(!response.ok)console.warn("[support-push] dispatch failed",response.status);
}
