"use client";

import { useEffect, useState } from "react";

async function loadCount(){
  const response=await fetch("/api/it-admin/v1/requests/open-count",{cache:"no-store"});
  const json=await response.json().catch(()=>null) as {data?:{total?:number}}|null;
  return response.ok?Number(json?.data?.total??0):0;
}

function announce(total:number){
  window.dispatchEvent(new CustomEvent("cpipos-support-request-unread",{detail:{total}}));
}

export function SupportRequestNotifier(){
  const [toast,setToast]=useState<{title:string;message:string}|null>(null);
  useEffect(()=>{
    let alive=true;
    const refresh=()=>void loadCount().then(total=>{if(alive)announce(total);}).catch(()=>null);
    refresh();
    const onPush=(event:Event)=>{
      const payload=(event as CustomEvent<{title?:string;body?:string;kind?:string}>).detail;
      if(payload?.kind!=="request") return;
      setToast({title:payload.title||"มีคำขอใหม่",message:payload.body||""});
      window.setTimeout(()=>setToast(null),5000);
      refresh();
    };
    window.addEventListener("cpipos-it-push-notification",onPush);
    window.addEventListener("focus",refresh);
    return()=>{alive=false;window.removeEventListener("cpipos-it-push-notification",onPush);window.removeEventListener("focus",refresh);};
  },[]);
  if(!toast)return null;
  return <button type="button" onClick={()=>window.location.assign("/it-admin/subscription-payments")}
    className="fixed right-5 top-20 z-[210] w-[min(360px,calc(100vw-2rem))] rounded-2xl border border-amber-200 bg-white p-4 text-left shadow-2xl">
    <div className="text-sm font-black text-slate-950">{toast.title}</div>
    <div className="mt-1 line-clamp-2 text-xs leading-5 text-slate-600">{toast.message}</div>
    <div className="mt-2 text-[10px] font-black text-amber-600">เปิดตารางชำระแพ็กเกจ</div>
  </button>;
}
