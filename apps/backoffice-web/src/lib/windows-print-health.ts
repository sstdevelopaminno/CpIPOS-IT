export type WindowsPrintReadiness = "ready" | "agent_stale" | "device_health_stale" | "printer_unverified" | "inactive";
export function observedAgeMs(value:string|null|undefined,now:number):number|null {
  if(!value)return null;
  const stamp=Date.parse(value);
  return Number.isFinite(stamp)&&stamp<=now?now-stamp:null;
}
export function windowsPrintReadiness(input:{
  status:string; agentSeenAt:string|null; deviceSeenAt:string|null;
  printerValid:unknown; now:number;
}):{state:WindowsPrintReadiness;agent_age_ms:number|null;device_age_ms:number|null}{
  const agent_age_ms=observedAgeMs(input.agentSeenAt,input.now);
  const device_age_ms=observedAgeMs(input.deviceSeenAt,input.now);
  const state:WindowsPrintReadiness=input.status!=="active"?"inactive":
    agent_age_ms===null||agent_age_ms>45_000?"agent_stale":
    device_age_ms===null||device_age_ms>180_000?"device_health_stale":
    input.printerValid!==true?"printer_unverified":"ready";
  return {state,agent_age_ms,device_age_ms};
}
