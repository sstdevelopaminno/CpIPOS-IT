export const POS_SALES_MODE_KEYS = ["takeaway", "dine_in", "buffet_table", "delivery", "general_sale", "optical_retail", "recycling", "retail_wholesale"] as const;

export type PosSalesModeKey = (typeof POS_SALES_MODE_KEYS)[number];
export type PosSalesModeMap = Record<PosSalesModeKey, boolean>;

export type PosSalesModeView = {
  key: PosSalesModeKey;
  label: string;
  short_label: string;
  description: string;
  enabled: boolean;
};

export const DEFAULT_POS_SALES_MODES: PosSalesModeMap = {
  takeaway: true,
  dine_in: true,
  buffet_table: true,
  delivery: true,
  general_sale: true,
  optical_retail: false,
  recycling: false,
  retail_wholesale: false
};

export const POS_SALES_MODE_DEFINITIONS: Array<Omit<PosSalesModeView, "enabled">> = [
  {
    key: "takeaway",
    label: "หน้าร้าน / กลับบ้าน",
    short_label: "หน้าร้าน",
    description: "ขายด่วนและออเดอร์รับกลับบ้านบนหน้า POS"
  },
  {
    key: "dine_in",
    label: "นั่งโต๊ะ",
    short_label: "โต๊ะ",
    description: "เปิดโต๊ะ ผูกบิลกับโต๊ะ และจัดการบิลหน้าร้าน"
  },
  {
    key: "buffet_table",
    label: "โต๊ะบุฟเฟ่ต์",
    short_label: "บุฟเฟ่ต์",
    description: "โหมดโต๊ะแบบบุฟเฟ่ต์หรือรอบบริการเฉพาะร้าน"
  },
  {
    key: "delivery",
    label: "เดลิเวอรี่",
    short_label: "เดลิเวอรี่",
    description: "รับรายการขายจากช่องทางเดลิเวอรี่และบิลรอจัดส่ง"
  },
  {
    key: "general_sale",
    label: "ขายทั่วไป (SD)",
    short_label: "ขายทั่วไป",
    description: "หน้าขาย CpiPOS มาตรฐานสำหรับร้านค้าทั่วไปและแพ็กเกจ CUSTOM: สแกน SKU/บาร์โค้ดและตะกร้าตารางเดียวกัน"
  },
  {
    key: "optical_retail",
    label: "ร้านแว่นตา · IMDC OPTICAL",
    short_label: "ร้านแว่นตา",
    description: "โหมดขายกรอบและเลนส์ด้วย SKU/บาร์โค้ด ใช้ระบบขายปลีกเดิมเป็นฐาน (งานสั่งทำและค่าสายตากำลังพัฒนา)"
  },
  {
    key: "retail_wholesale",
    label: "ค้าปลีก–ค้าส่ง (RW) · CUSTOM",
    short_label: "ค้าปลีก–ค้าส่ง",
    description: "โหมดเฉพาะทาง CUSTOM สำหรับค้าปลีกและค้าส่ง ใช้ระบบคิดเงินเดิมภายใน เลือก RW เพียงโหมดเดียวได้โดยไม่ต้องเปิด SD"
  },
  {
    key: "recycling",
    label: "ร้านค้าของเก่า · Recycling",
    short_label: "รีไซเคิล",
    description: "ใช้หน้าขาย CpiPOS มาตรฐานเหมือนร้านของชำ แต่เปลี่ยนเป็นรับซื้อ/ขายออก ชั่งน้ำหนัก เลือกหน่วย และตัดสต๊อกตามธุรกรรม (เปิดให้ลูกค้าทุกแห่งที่ซื้อ CUSTOM + สิทธิ์ Recycling)"
  }
];

function asBoolean(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function normalizePosSalesModes(value: unknown): PosSalesModeMap {
  const record = asRecord(value);
  return {
    takeaway: asBoolean(record.takeaway, DEFAULT_POS_SALES_MODES.takeaway),
    dine_in: asBoolean(record.dine_in, DEFAULT_POS_SALES_MODES.dine_in),
    buffet_table: asBoolean(record.buffet_table, DEFAULT_POS_SALES_MODES.buffet_table),
    delivery: asBoolean(record.delivery, DEFAULT_POS_SALES_MODES.delivery),
    general_sale: asBoolean(record.general_sale, DEFAULT_POS_SALES_MODES.general_sale),
    optical_retail: asBoolean(record.optical_retail, DEFAULT_POS_SALES_MODES.optical_retail),
    recycling: asBoolean(record.recycling, DEFAULT_POS_SALES_MODES.recycling),
    retail_wholesale: record.retail_wholesale === true
  };
}

export function toPosSalesModeViews(value: unknown): PosSalesModeView[] {
  const modes = normalizePosSalesModes(value);
  if (modes.retail_wholesale) modes.general_sale = false;
  return POS_SALES_MODE_DEFINITIONS.map((definition) => ({
    ...definition,
    enabled: modes[definition.key]
  }));
}
