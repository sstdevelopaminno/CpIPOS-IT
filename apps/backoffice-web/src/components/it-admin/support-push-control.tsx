"use client";

import { useEffect, useState } from "react";

function base64UrlToUint8Array(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  return Uint8Array.from([...raw].map((char) => char.charCodeAt(0)));
}

type State = "unsupported" | "default" | "denied" | "ready" | "busy";

export function ItSupportPushControl() {
  const [state,setState]=useState<State>("default");

  async function subscribe(requestPermission:boolean) {
    if(!("serviceWorker" in navigator)||!("PushManager" in window)||!("Notification" in window)){
      setState("unsupported"); return;
    }
    let permission=Notification.permission;
    if(requestPermission&&permission==="default") permission=await Notification.requestPermission();
    if(permission==="denied"){setState("denied");return;}
    if(permission!=="granted"){setState("default");return;}
    setState("busy");
    try{
      const registration=await navigator.serviceWorker.ready;
      const keyResponse=await fetch("/api/it-admin/v1/support-chat/push-subscription",{cache:"no-store"});
      const keyBody=await keyResponse.json() as {data?:{public_key?:string}};
      const publicKey=String(keyBody?.data?.public_key||"");
      if(!keyResponse.ok||!publicKey) throw new Error("push_key_unavailable");
      let subscription=await registration.pushManager.getSubscription();
      if(!subscription){
        subscription=await registration.pushManager.subscribe({
          userVisibleOnly:true,
          applicationServerKey:base64UrlToUint8Array(publicKey)
        });
      }
      const save=await fetch("/api/it-admin/v1/support-chat/push-subscription",{
        method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(subscription.toJSON())
      });
      if(!save.ok) throw new Error("push_subscription_failed");
      setState("ready");
    }catch{setState("default");}
  }

  useEffect(()=>{
    if("Notification" in window&&Notification.permission==="granted") void subscribe(false);
    const onMessage=(event:MessageEvent)=>{
      if(event.data?.type!=="CPIPOS_PUSH_NOTIFICATION") return;
      window.dispatchEvent(new CustomEvent("cpipos-it-push-notification",{detail:event.data.payload}));
    };
    navigator.serviceWorker?.addEventListener("message",onMessage);
    return()=>navigator.serviceWorker?.removeEventListener("message",onMessage);
  },[]);

  if(state==="unsupported") return null;
  const label=state==="ready"?"แจ้งเตือนเปิดแล้ว":state==="denied"?"แจ้งเตือนถูกบล็อก":state==="busy"?"กำลังเปิด...":"เปิดแจ้งเตือน";
  return <button type="button" onClick={()=>void subscribe(true)} disabled={state==="busy"||state==="ready"}
    className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-black text-slate-700 disabled:opacity-60"
    title={label}>🔔 <span className="hidden lg:inline">{label}</span></button>;
}
