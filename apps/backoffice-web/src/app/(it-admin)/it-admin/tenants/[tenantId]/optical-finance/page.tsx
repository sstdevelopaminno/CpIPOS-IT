import Link from "next/link";
import {OpticalFinanceApprovalCard} from "@/components/it-admin/optical-finance-approval-card";
import {requireItAdmin} from "@/lib/it-admin-guard";

/** Scoped feature activation page for IT Admin and IT Support.
 * Unlike /tenants/[id]/features, this does not expose platform-wide tenant administration.
 */
export default async function OpticalFinanceApprovalPage({
  params
}: {params:Promise<{tenantId:string}>}){
  const {tenantId}=await params;
  if(!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(tenantId)){
    return <main className="surface" role="alert"><h1>รหัสร้านค้าไม่ถูกต้อง</h1>
      <Link href="/it-admin/tenants">กลับไปหน้าร้านค้า</Link></main>;
  }
  try{
    // Rechecks authoritative platform role and active profile, not only stale JWT metadata.
    await requireItAdmin();
  }catch{
    return <main className="surface" role="alert">
      <h1>ไม่มีสิทธิ์เข้าถึง</h1>
      <p>ต้องเข้าสู่ระบบด้วยบัญชี IT Admin หรือ IT Support ที่ยังใช้งานอยู่</p>
      <Link href="/it-admin/tenants">กลับไปหน้าร้านค้า</Link>
    </main>;
  }
  return <main style={{maxWidth:1050,margin:"24px auto",padding:"0 16px",display:"grid",gap:16}}>
    <Link href="/it-admin/tenants" style={{color:"#0369a1"}}>← กลับไป Tenants / Stores</Link>
    <header>
      <h1 style={{fontSize:24,fontWeight:800}}>เปิดใช้ระบบใบสั่งงานและเงินมัดจำ Optical</h1>
      <p style={{color:"#475569",marginTop:8}}>อนุมัติสิทธิ์ฟีเจอร์ระดับร้านเพียงครั้งเดียว ไม่ใช่การอนุมัติการขายแต่ละบิล</p>
    </header>
    <OpticalFinanceApprovalCard tenantId={tenantId}/>
    <section className="surface" style={{padding:16,borderRadius:12}}>
      <h2 style={{fontSize:16,fontWeight:700}}>หลังเปิดใช้แล้ว ใครเป็นผู้ทำงาน?</h2>
      <p>เจ้าของร้าน ผู้จัดการ และพนักงานขายที่มีสิทธิ์ POS ทำรายการตามปกติได้ ไม่ต้องส่งบิลให้ IT อนุมัติ</p>
      <p>IT ดูแลการเปิด/ปิดสิทธิ์ฟีเจอร์รายร้านเท่านั้น สำหรับการโอนเงิน ร้านต้องตรวจสอบยอดเงินเข้าจริงก่อนยืนยันรับชำระ</p>
      <p style={{color:"#9a3412"}}>ระบบรับเงินจริงยังต้องผ่านการเปิดสวิตช์ Optical Finance ใน Vercel โดยผู้ดูแล Deployment และการทดสอบธุรกรรมก่อนเริ่มใช้งาน</p>
    </section>
  </main>;
}
