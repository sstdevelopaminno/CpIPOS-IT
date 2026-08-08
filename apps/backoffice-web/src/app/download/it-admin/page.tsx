import { DownloadPageShell } from "@/components/download/download-page-shell";
import { ItAdminIllustration } from "@/components/download/download-illustrations";

const downloadUrl = "/download/it-admin/latest";

export const metadata = {
  title: "ดาวน์โหลด CpIPOS IT Admin",
  description: "ดาวน์โหลดตัวติดตั้ง CpIPOS IT Admin สำหรับทีม IT จัดการร้านค้าและอุปกรณ์ทั้งหมดบน Windows."
};

export default function ItAdminDownloadPage() {
  return (
    <DownloadPageShell
      eyebrow="CpIPOS IT Admin"
      title="จัดการระบบ CpIPOS ทั้งหมดด้วย CpIPOS IT Admin บน Windows"
      subtitle="ตัวติดตั้ง CpIPOS IT Admin สำหรับทีม IT เปิดคอนโซลจัดการร้านค้า แพ็กเกจ และอุปกรณ์ด้วย WebView2 แบบเต็มจอ ไม่มี address bar"
      illustration={<ItAdminIllustration />}
      features={["เต็มจอ ไม่มี Address Bar", "จัดการ tenants และ branches", "ดูแลแพ็กเกจและการเปิดใช้งาน", "ตรวจสอบ audit log ระดับแพลตฟอร์ม"]}
      downloadUrl={downloadUrl}
      downloadLabel="ดาวน์โหลดตัวติดตั้ง IT Admin"
      fileHint="ไฟล์หลักคือ CpIPOS-ITAdminRuntime-Setup.exe สำหรับติดตั้งลงเครื่อง Windows และสร้าง shortcut ให้อัตโนมัติ"
      separateNoticeTitle="แยกจาก CpIPOS Windows (POS)"
      separateNoticeBody={[
        "โปรแกรมนี้ใช้สำหรับทีม IT เท่านั้น แยกต่างหากจาก CpIPOS Windows Runtime ที่ใช้บนเครื่อง POS แคชเชียร์ ติดตั้งพร้อมกันบนเครื่องเดียวกันได้",
        "เข้าสู่ระบบด้วยบัญชีอีเมล/รหัสผ่านที่ได้รับสิทธิ์ it_admin แยกจาก store code ของ POS"
      ]}
      stepsTitle="วิธีติดตั้งบนเครื่อง Windows ของทีม IT"
      steps={[
        "กดปุ่ม “ดาวน์โหลดตัวติดตั้ง IT Admin”",
        "เปิดไฟล์ CpIPOS-ITAdminRuntime-Setup.exe",
        "กดติดตั้งตามขั้นตอน ระบบจะสร้าง shortcut ที่ Desktop/Start Menu",
        "เปิดโปรแกรม CpIPOS IT Admin จาก shortcut แล้วเข้าสู่ระบบด้วยบัญชี IT Admin",
        "ปิดโปรแกรมได้จากปุ่ม “ปิดโปรแกรม” ด้านบนขวา หรือกด Esc / Alt+F4"
      ]}
      statusTitle="สถานะฟีเจอร์"
      statusBody="เวอร์ชันนี้ห่อหน้าเว็บ IT Admin ของ CpIPOS เป็นโปรแกรม Windows เท่านั้น ยังไม่มีฟีเจอร์ MDM (สั่งงานอุปกรณ์ลูกค้าทางไกล) ซึ่งอยู่ระหว่างออกแบบเป็นเฟสถัดไป"
    />
  );
}
