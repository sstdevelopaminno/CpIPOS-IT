import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { getPrimarySupabaseServiceClient } from "@/lib/supabase-admin";

type Acceptance={id:string;tenant_id:string;actor_user_id:string;accepted_at:string;acceptance_channel:string;version:string;signature_png_base64:string;snapshot:Record<string,unknown>};
type Activation={settlement_id:string;starts_at:string;ends_at:string};
const text=(v:unknown)=>typeof v==="string"||typeof v==="number"?String(v):"";
const esc=(v:unknown)=>text(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]||c));
const date=(v:string)=>new Intl.DateTimeFormat("th-TH",{dateStyle:"long",timeStyle:"short",timeZone:"Asia/Bangkok"}).format(new Date(v));
export async function renderActiveCustomAgreement(tenantId:string,agreementId:string):Promise<Response>{
  const db=getPrimarySupabaseServiceClient();
  const [evidence,activation]=await Promise.all([
    db.from("tenant_custom_agreement_acceptances").select("id,tenant_id,actor_user_id,accepted_at,acceptance_channel,version,signature_png_base64,snapshot").eq("tenant_id",tenantId).eq("id",agreementId).maybeSingle<Acceptance>(),
    db.from("tenant_custom_agreement_activations").select("settlement_id,starts_at,ends_at").eq("tenant_id",tenantId).eq("acceptance_id",agreementId).maybeSingle<Activation>()
  ]);
  if(evidence.error||activation.error)return new Response("Agreement unavailable",{status:503,headers:{"cache-control":"private, no-store"}});
  if(!evidence.data||!activation.data)return new Response("Agreement not found or not yet active",{status:404,headers:{"cache-control":"private, no-store"}});
  const a=evidence.data,s=a.snapshot,active=activation.data;
  const signature=a.signature_png_base64;
  if(!signature||signature.length>60000||!/^[A-Za-z0-9+/]+={0,2}$/.test(signature))return new Response("Signature unavailable",{status:409});
  const bytes=Buffer.from(signature,"base64");
  if(!bytes.subarray(0,8).equals(Buffer.from("89504e470d0a1a0a","hex"))||createHash("sha256").update(bytes).digest("hex")!==s.signature_sha256)
    return new Response("Signature integrity check failed",{status:409});
  const receipt=await db.from("tenant_subscription_receipts").select("id,receipt_number")
    .eq("tenant_id",tenantId).eq("settlement_id",active.settlement_id).maybeSingle<{id:string;receipt_number:string}>();
  if(receipt.error||!receipt.data)return new Response("Confirmed receipt unavailable",{status:503});
  const note=await db.from("tenant_subscription_receipt_annotations").select("voided_at,correction_note")
    .eq("tenant_id",tenantId).eq("receipt_id",receipt.data.id).maybeSingle<{voided_at:string|null;correction_note:string|null}>();
  if(note.error)return new Response("Receipt annotation unavailable",{status:503});
  const clauses=Array.isArray(s.clauses)?s.clauses.map(x=>"<li>"+esc(x)+"</li>").join(""):"";
  if(!clauses||!s.issuer_name||!s.issuer_registration||!s.issuer_address||!s.director_name)return new Response("Agreement snapshot incomplete",{status:409});
  const terms=s.commercial_terms&&typeof s.commercial_terms==="object"?s.commercial_terms as Record<string,unknown>:{};
  const limits=[["จำนวนสาขา","max_branches"],["จำนวนเครื่อง","max_devices"],["จำนวนผู้ใช้","max_users"],["จำนวนสินค้า","max_products"],["จำนวนบิลต่อเดือน","monthly_bill_limit"],["พื้นที่จัดเก็บ (GB)","storage_limit_gb"]].filter(([,k])=>terms[k]!=null).map(([label,k])=>"<div>"+esc(label)+": "+esc(terms[k])+"</div>").join("");
  const amount=new Intl.NumberFormat("th-TH",{style:"currency",currency:text(s.currency)||"THB"}).format(Number(s.amount_per_cycle));
  const nonce=randomBytes(18).toString("base64");
  const receiptWarning=note.data?.voided_at||note.data?.correction_note?"<aside>หมายเหตุเอกสารรับเงิน: "+(note.data?.voided_at?"ใบเสร็จอ้างอิงถูกยกเลิก — ติดต่อ IT เพื่อตรวจสอบสถานะสัญญา ":"")+esc(note.data?.correction_note)+"</aside>":"";
  const html='<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>สัญญา CpiPOS CUSTOM</title><style>@page{size:A4;margin:17mm}*{box-sizing:border-box}body{font:13px/1.65 Tahoma,"Noto Sans Thai",sans-serif;color:#14233d;max-width:180mm;margin:20px auto;padding:12px}header{border-bottom:2px solid #155c9f;padding-bottom:12px}header img{width:128px;height:auto}h1{font-size:21px;margin:8px 0}h2{font-size:15px;margin:16px 0 6px}ol{padding-left:24px}li{margin:0 0 7px;break-inside:avoid}p{margin:5px 0;overflow-wrap:anywhere}.info{border:1px solid #cbd5e1;padding:12px;border-radius:8px}footer{margin-top:20px;break-inside:avoid}.signature{width:165px;height:70px;object-fit:contain;object-position:left center}button{padding:10px 15px;border:0;background:#175b9b;color:white;border-radius:6px;cursor:pointer}aside{border:1px solid #d97706;padding:10px;background:#fffbeb}@media print{body{margin:0;padding:0;max-width:none}button{display:none}}</style></head><body><button id="print">พิมพ์ / บันทึก PDF</button><header><img src="/brand/cpipos-logo.png" alt="CpiPOS"><h1>สัญญาให้สิทธิใช้บริการซอฟต์แวร์ CpiPOS CUSTOM</h1><p>เลขอ้างอิง: '+esc(a.id)+' · รุ่น '+esc(a.version)+'</p></header>'+receiptWarning+
  '<h2>คู่สัญญา</h2><p><strong>ผู้ให้บริการ:</strong> '+esc(s.issuer_name)+' เลขทะเบียน '+esc(s.issuer_registration)+'</p><p>'+esc(s.issuer_address)+'</p><p><strong>ผู้รับบริการ:</strong> '+esc(s.store_name)+'</p><p>'+esc(s.company_address)+'</p>'+
  '<h2>อัตราค่าบริการและระยะเวลา</h2><div class="info"><p>แพ็กเกจ CUSTOM · '+esc(amount)+' / '+(s.billing_interval==="yearly"?"ปี":"เดือน")+'</p><p>เริ่มสัญญา '+esc(date(active.starts_at))+' · สิ้นสุด '+esc(date(active.ends_at))+'</p><p>ใบเสร็จอ้างอิง '+esc(receipt.data.receipt_number)+' · Settlement '+esc(active.settlement_id)+'</p>'+limits+'</div><h2>ข้อกำหนดและเงื่อนไข</h2><ol>'+clauses+'</ol>'+
  '<h2>หลักฐานการยอมรับทางอิเล็กทรอนิกส์</h2><p>ยอมรับเมื่อ '+esc(date(a.accepted_at))+' ผ่าน '+esc(a.acceptance_channel.toUpperCase())+'</p><p>รหัสผู้ยอมรับ '+esc(a.actor_user_id)+'</p><footer><p>ลงนามผู้ให้บริการ</p><img class="signature" src="data:image/png;base64,'+signature+'" alt="ลายมือชื่อกรรมการผู้มีอำนาจ"><p>'+esc(s.director_name)+'</p><p>กรรมการผู้มีอำนาจลงนาม</p><p>เอกสารนี้สร้างจากหลักฐานสัญญาและรายการรับเงินจริงที่บันทึกไว้ ไม่ต้องมีลายเซ็นลูกค้าบนกระดาษ</p></footer><script nonce="'+nonce+'">document.getElementById("print").addEventListener("click",function(){window.print()})</script></body></html>';
  return new Response(html,{headers:{"content-type":"text/html; charset=utf-8","cache-control":"private, no-store","x-content-type-options":"nosniff","content-security-policy":"default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'nonce-"+nonce+"'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'","content-disposition":'inline; filename="CUSTOM-'+agreementId+'.html"'}});
}
