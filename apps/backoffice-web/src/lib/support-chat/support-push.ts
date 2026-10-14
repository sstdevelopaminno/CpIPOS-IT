import "server-only";
import { getPrimarySupabaseServiceClient } from "@/lib/supabase-admin";
import { getTenantNotificationLanguage } from "@/lib/server/tenant-notification-language";

type SupportPushInput={
  audience:"it"|"store";tenant_id?:string|null;kind:"chat"|"request"|"general";
  title:string;body:string;url:string;tag?:string;
};

const storeSystemPushCopy: Record<"en"|"lo", Record<string,{title:string;body?:string}>> = {
  en: {
    "ข้อความใหม่จาก IT Support":{title:"New message from IT Support",body:"You have a new message from IT Support"},
    "จบการสนทนาแล้ว":{title:"Support conversation ended",body:"IT Support has closed this chat. Open a new chat if you need further help."}
  },
  lo: {
    "ข้อความใหม่จาก IT Support":{title:"ຂໍ້ຄວາມໃໝ່ຈາກ IT Support",body:"ທ່ານມີຂໍ້ຄວາມໃໝ່ຈາກ IT Support"},
    "จบการสนทนาแล้ว":{title:"ການສົນທະນາສິ້ນສຸດແລ້ວ",body:"ທີມ IT ໄດ້ປິດການສົນທະນາແລ້ວ. ທ່ານສາມາດເລີ່ມແຊັດໃໝ່ໄດ້."}
  }
};

/** System-generated push headers follow the store language. User-authored message
 * preview content is preserved verbatim; translation must never alter customer input. */
export async function dispatchSupportPush(input:SupportPushInput){
  let payload = input;
  if(input.audience==="store" && input.tenant_id) {
    try {
      const locale = await getTenantNotificationLanguage(getPrimarySupabaseServiceClient(), input.tenant_id);
      if(locale!=="th") {
        const text = storeSystemPushCopy[locale][input.title];
        if(text)payload={...input,title:text.title,
          body:input.body==="มีข้อความใหม่จาก IT Support"||input.title==="จบการสนทนาแล้ว"?(text.body??input.body):input.body};
      }
    } catch(error) {
      console.warn("[support-push] notification locale unavailable; using original text", error instanceof Error ? error.message : "unknown");
    }
  }
  const baseUrl=String(process.env.NEXT_PUBLIC_SUPABASE_URL??"").trim().replace(/\/$/,"");
  const serviceRole=String(process.env.SUPABASE_SERVICE_ROLE_KEY??"").trim();
  if(!baseUrl||!serviceRole)return;
  const response=await fetch(`${baseUrl}/functions/v1/support-push-dispatch`,{
    method:"POST",
    headers:{authorization:`Bearer ${serviceRole}`,apikey:serviceRole,"content-type":"application/json"},
    body:JSON.stringify(payload),cache:"no-store"
  });
  if(!response.ok)console.warn("[support-push] dispatch failed",response.status);
}
