import type { CustomerEmailEventType, CustomerEmailMessage } from "@/lib/services/it-admin/customer-email-service";
import type { TenantNotificationLanguage } from "@/lib/server/tenant-notification-language";

/** Translation of customer-facing system notices.
 * Preserve dynamic values (codes, money, numbers, URLs) and do not translate store names.
 * If no tenant language is set, the legacy Thai template is used unchanged.
 */
const eventCopy: Record<"en"|"lo", Record<CustomerEmailEventType, {subject:string;summary:string}>> = {
 en: {
  store_activation:{subject:"Your CpIPOS store is activated",summary:"Your CpIPOS store is ready. Keep your Store Code and Owner credentials secure."},
  payment_confirmation:{subject:"CpIPOS payment confirmed",summary:"Your payment has been verified and the package is activated or renewed. Please check the receipt details below."},
  subscription_due_reminder:{subject:"CpIPOS subscription renewal reminder",summary:"Your subscription is nearing its due date. Renew before expiry to avoid interruption. This is not a payment receipt."},
  trial_expiry_reminder:{subject:"CpIPOS free trial ending soon",summary:"Your trial will expire soon. Choose a package and complete payment to continue using the service."},
  tenant_deletion_warning:{subject:"Important: CpIPOS data retention notice",summary:"Your store data is subject to the retention policy. Permanent deletion requires IT verification and must not occur automatically."},
  sales_retention_export:{subject:"CpIPOS sales archive is ready",summary:"Your older sales records have been exported. Download the archive before its links expire."},
  daily_sales_summary:{subject:"CpIPOS daily sales summary",summary:"This report summarizes your store sales for the previous business day."},
  daily_sales_summary_test:{subject:"TEST: CpIPOS daily sales summary",summary:"This test message is intended for IT, not customers."}
 },
 lo: {
  store_activation:{subject:"ເປີດໃຊ້ງານຮ້ານ CpIPOS ສຳເລັດ",summary:"ຮ້ານຂອງທ່ານພ້ອມໃຊ້ງານ CpIPOS ແລ້ວ. ກະລຸນາເກັບລະຫັດຮ້ານ ແລະຂໍ້ມູນ Owner ໃຫ້ປອດໄພ."},
  payment_confirmation:{subject:"ຢືນຢັນການຊຳລະເງິນ CpIPOS",summary:"ກວດສອບການຊຳລະເງິນແລ້ວ ແລະແພັກເກດໄດ້ເປີດໃຊ້ ຫຼືຕໍ່ອາຍຸ. ກະລຸນາກວດລາຍລະອຽດໃບຮັບເງິນ."},
  subscription_due_reminder:{subject:"ແຈ້ງເຕືອນຕໍ່ອາຍຸແພັກເກດ CpIPOS",summary:"ແພັກເກດໃກ້ຄົບກຳນົດ. ກະລຸນາຕໍ່ອາຍຸກ່ອນສິ້ນສຸດ. ນີ້ບໍ່ແມ່ນໃບຮັບເງິນ."},
  trial_expiry_reminder:{subject:"ໃກ້ສິ້ນສຸດການທົດລອງ CpIPOS",summary:"ການທົດລອງໃກ້ໝົດອາຍຸ. ກະລຸນາເລືອກແພັກເກດ ແລະຊຳລະເງິນເພື່ອໃຊ້ຕໍ່."},
  tenant_deletion_warning:{subject:"ແຈ້ງເຕືອນການເກັບຮັກສາຂໍ້ມູນ CpIPOS",summary:"ຂໍ້ມູນຮ້ານຢູ່ພາຍໃຕ້ນະໂຍບາຍເກັບຮັກສາ. ການລຶບຖາວອນຕ້ອງຜ່ານການກວດສອບຈາກ IT."},
  sales_retention_export:{subject:"ໄຟລ໌ປະຫວັດການຂາຍ CpIPOS ພ້ອມແລ້ວ",summary:"ລະບົບໄດ້ສົ່ງອອກປະຫວັດການຂາຍ. ກະລຸນາດາວໂຫຼດກ່ອນລິ້ງໝົດອາຍຸ."},
  daily_sales_summary:{subject:"ສະຫຼຸບຍອດຂາຍລາຍວັນ CpIPOS",summary:"ສະຫຼຸບຍອດຂາຍຂອງຮ້ານສຳລັບມື້ກ່ອນ."},
  daily_sales_summary_test:{subject:"ທົດສອບ: ສະຫຼຸບຍອດຂາຍ CpIPOS",summary:"ຂໍ້ຄວາມທົດສອບສຳລັບ IT ເທົ່ານັ້ນ."}
 }
};

const labelNames: Record<string,[string,string]> = {
 "ร้านค้า":["Store","ຮ້ານຄ້າ"], "Store Code":["Store Code","ລະຫັດຮ້ານ"],
 "รหัสผู้ใช้งาน Owner":["Owner login code","ລະຫັດເຂົ້າລະບົບ Owner"],
 "สิ้นสุดช่วงทดลองใช้":["Trial end date","ມື້ສິ້ນສຸດທົດລອງ"],
 "แพ็กเกจ":["Package","ແພັກເກດ"], "เลขที่ใบเสร็จ":["Receipt number","ເລກໃບຮັບເງິນ"],
 "หมายเลขใบเสร็จ":["Receipt number","ເລກໃບຮັບເງິນ"],
 "ยอดรับชำระ":["Payment received","ຈຳນວນເງິນທີ່ຮັບ"],
 "ชำระเงิน":["Payment","ການຊຳລະເງິນ"], "ชำระเงินสด":["Cash payments","ຊຳລະເງິນສົດ"],
 "ชำระเงินโอน":["Bank transfers","ໂອນເງິນ"],
 "รอบบริการ":["Billing period","ຮອບບໍລິການ"],
 "เริ่มต้นรอบบริการ":["Period start","ມື້ເລີ່ມຕົ້ນ"],
 "สิ้นสุดรอบบริการ":["Period end","ມື້ສິ້ນສຸດ"],
 "ครบกำหนด":["Due date","ມື້ຄົບກຳນົດ"], "คงเหลือ":["Remaining","ຍັງເຫຼືອ"],
 "ค่าบริการรอบถัดไป":["Next charge","ຄ່າບໍລິການຮອບຕໍ່ໄປ"],
 "ยอดก่อนส่วนลด":["Gross sales","ຍອດກ່ອນຫຼຸດ"],
 "จำนวนบิลขายสำเร็จ":["Completed bills","ຈຳນວນບິນທີ່ສຳເລັດ"],
 "ยอดขายสุทธิ":["Net sales","ຍອດຂາຍສຸດທິ"],
 "บิลยกเลิก":["Cancelled bills","ບິນຍົກເລີກ"],
 "ช่วงข้อมูล":["Data period","ຊ່ວງຂໍ້ມູນ"],
 "จำนวนบิล":["Bills","ຈຳນວນໃບບິນ"],
 "จำนวนกะที่หมดระยะเก็บ":["Expired shifts","ຈຳນວນກະທີ່ໝົດອາຍຸ"],
 "ประวัติ Stock Movement":["Stock movements","ປະຫວັດ Stock Movement"],
 "ยอดขายรวม":["Gross sales","ຍອດຂາຍລວມ"],
 "ยอดรับชำระรวม":["Total received","ລວມຍອດຮັບເງິນ"],
 "ไฟล์สรุปบิล":["Orders CSV","ໄຟລ໌ສະຫຼຸບບິນ"],
 "ไฟล์รายการสินค้าในบิล":["Order items CSV","ໄຟລ໌ລາຍການສິນຄ້າ"],
 "ไฟล์การชำระเงิน":["Payments CSV","ໄຟລ໌ການຊຳລະ"],
 "ไฟล์ประวัติกะ":["Shifts CSV","ໄຟລ໌ປະຫວັດກະ"],
 "ไฟล์ประวัติ Stock Movement":["Stock movement CSV","ໄຟລ໌ Stock Movement"]
};
const fieldNames = new Map(Object.entries(labelNames).map(([key,v])=>[key,v]));
const safe = (value:string) => value.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#39;");

export function localizeCustomerSystemEmail(
 message:CustomerEmailMessage,eventType:CustomerEmailEventType, language:TenantNotificationLanguage,
 support:{email:string;website:string;company:string}
):CustomerEmailMessage {
 if(language==="th") return message;
 const lang=language as "en"|"lo";
 const translated=eventCopy[lang][eventType];
 const fieldIndex=lang==="en"?0:1;
 const details:string[]=[];
 const original=message.textBody.split(/\r?\n/);
 for(const raw of original){
  const line=raw.trim();
  if(!line)continue;
  // Preserve reference numbers, URLs, financial totals and customer-entered names.
  const pos=line.indexOf(":");
  if(pos>0 && pos<52){
    const originalKey=line.slice(0,pos).trim();
    const value=line.slice(pos+1).trim();
    const name=fieldNames.get(originalKey);
    if(name){details.push(`${name[fieldIndex]}: ${value}`);continue;}
    if(!/[\u0E00-\u0E7F]/u.test(originalKey)){details.push(line);continue;}
  }
  if(/^อันดับ\s+\d+\s*:/.test(line)){
    details.push(line.replace(/^อันดับ\s+(\d+)/,lang==="en"?"Rank $1":"ອັນດັບ $1").replace(/\s+ชิ้น\s+/g,lang==="en"?" pcs ":" ຊິ້ນ "));
  }
 }
 const heading=lang==="en"?"Details":"ລາຍລະອຽດ";
 const help=lang==="en"?"For questions, contact":"ຖ້າມີຄຳຖາມ ຕິດຕໍ່";
 const websiteLabel=lang==="en"?"Website":"ເວັບໄຊ";
 const textBody=[translated.summary,"",heading,...details.map(line=>"• "+line),"",`${help}: ${support.email}`,`${websiteLabel}: ${support.website}`,support.company].join("\n");
 const htmlBody=`<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0;background:#f3f6fb;font-family:Arial,'Noto Sans Lao','Noto Sans Thai',sans-serif"><main style="max-width:620px;margin:25px auto;background:#fff;border-radius:14px;padding:28px;color:#152941"><h1 style="color:#176fe8">CpIPOS</h1><h2>${safe(translated.subject)}</h2><p style="line-height:1.7">${safe(translated.summary)}</p><h3>${heading}</h3><ul>${details.map(line=>`<li style="margin:7px 0">${safe(line)}</li>`).join("")}</ul><hr><p>${help}: <a href="mailto:${safe(support.email)}">${safe(support.email)}</a></p><p>${websiteLabel}: <a href="${safe(support.website)}">${safe(support.website)}</a></p><small>${safe(support.company)}</small></main></body></html>`;
 return {subject:translated.subject, textBody, htmlBody};
}
