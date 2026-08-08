export const POS_BUFFET_TABLE_QUICK_MODE = "buffet_table" as const;

export type PosBuffetTableQuickMode = typeof POS_BUFFET_TABLE_QUICK_MODE;

export type PosBuffetTableModeCopy = {
  title: string;
  subtitle: string;
  badge: string;
};

export function getBuffetTableModeCopy(lang: "th" | "en"): PosBuffetTableModeCopy {
  if (lang === "en") {
    return {
      title: "Buffet table",
      subtitle: "Open a table and select buffet price first",
      badge: "Buffet"
    };
  }
  return {
    title: "โต๊ะบุฟเฟ่",
    subtitle: "เปิดโต๊ะแล้วเลือกชุดราคาบุฟเฟ่ก่อนขาย",
    badge: "บุฟเฟ่"
  };
}

export function isBuffetTableQuickMode(mode: string): mode is PosBuffetTableQuickMode {
  return mode === POS_BUFFET_TABLE_QUICK_MODE;
}
