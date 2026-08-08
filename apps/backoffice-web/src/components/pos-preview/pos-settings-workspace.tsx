"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { PrintersModule } from "@/components/backoffice/printers-module";
import { PosManagerApprovalModal } from "@/components/pos-ui/pos-manager-approval-modal";
import { PosUsersModule } from "@/components/pos/pos-users-module";
import { InetNopsSettingsPanel } from "@/components/pos-preview/inet-nops-settings-panel";
import { PackageLockDialog } from "@/components/pos-preview/package-lock-dialog";
import { POS_SETTINGS_FEATURES } from "@/lib/pos-feature-map";
import type {
  BranchSettings,
  PaymentAccountSettings,
  PosDeviceSettings,
  PosNotificationSettings,
  PosSettingsSnapshot,
  StoreSettings,
  TaxSettings,
  TaxLineMode
} from "@/lib/services/pos-settings-service";
import type { ActivityAuditItem, ActivityAuditPeriod } from "@/lib/services/activity-audit-service";
import type { Language } from "@/lib/i18n";

type SettingsView = "menu" | "store" | "branches" | "devices" | "printers" | "activity" | "payments" | "inet_nops" | "taxes" | "notifications" | "users";
type MenuIconName = "store" | "branch" | "payment" | "tax" | "users" | "display" | "terminal" | "activity" | "bell" | "tables" | "language" | "stock" | "summary" | "receipt" | "members" | "back" | "edit" | "trash" | "plus";
type MainMenuPlacement = "left" | "top" | "bottom";
const POS_TAX_SETTINGS_UPDATED_EVENT = "pos:tax-settings-updated";
const POS_TAX_SETTINGS_UPDATED_KEY = "pos_tax_settings_updated_at_v001";
const POS_PAYMENT_SETTINGS_UPDATED_EVENT = "pos:payment-settings-updated";
const POS_PAYMENT_SETTINGS_UPDATED_KEY = "pos_payment_settings_updated_at_v001";
const POS_MAIN_MENU_PLACEMENT_KEY = "pos_main_menu_bar_position_v2";
const POS_MAIN_MENU_PLACEMENT_EVENT = "pos-main-menu-placement-updated";

function persistPosLanguage(nextLang: Language) {
  document.cookie = `pos_lang=${nextLang}; path=/; max-age=31536000; SameSite=Lax`;
  window.localStorage.setItem("pos_lang", nextLang);
}

function normalizeMainMenuPlacement(value: string | null | undefined): MainMenuPlacement {
  if (value === "top" || value === "bottom") return value;
  return "left";
}

function persistMainMenuPlacement(placement: MainMenuPlacement) {
  window.localStorage.setItem(POS_MAIN_MENU_PLACEMENT_KEY, placement);
  window.dispatchEvent(new CustomEvent(POS_MAIN_MENU_PLACEMENT_EVENT, { detail: { placement } }));
}

type StoreForm = {
  display_name: string;
  logo_url: string;
  company_address: string;
  contact_phone: string;
};

type BranchForm = {
  id: string;
  code: string;
  name: string;
  address: string;
  is_active: boolean;
};

type PaymentForm = {
  id: string;
  branch_id: string;
  bank_name: string;
  account_name: string;
  account_number: string;
  promptpay_phone: string;
  qr_image_url: string;
  qr_mode: "promptpay_link" | "qr_image";
  applies_to_all_branches: boolean;
  is_active: boolean;
};

type DeviceForm = {
  id: string;
  branch_id: string;
  device_code: string;
  device_name: string;
  device_type: "pos_terminal" | "mobile_scanner" | "kiosk";
  status: "active" | "inactive" | "maintenance";
  is_locked: boolean;
  counter_name: string;
  location: string;
};

type ActivityAuditResponse = {
  items: ActivityAuditItem[];
  pagination: {
    page: number;
    page_size: number;
    total: number;
    total_pages: number;
  };
  approved_by: string;
  approver_role: string;
};

const emptyBranchForm: BranchForm = {
  id: "",
  code: "",
  name: "",
  address: "",
  is_active: true
};

const emptyPaymentForm: PaymentForm = {
  id: "",
  branch_id: "",
  bank_name: "",
  account_name: "",
  account_number: "",
  promptpay_phone: "",
  qr_image_url: "",
  qr_mode: "promptpay_link",
  applies_to_all_branches: false,
  is_active: true
};

const emptyDeviceForm: DeviceForm = {
  id: "",
  branch_id: "",
  device_code: "",
  device_name: "",
  device_type: "pos_terminal",
  status: "active",
  is_locked: true,
  counter_name: "",
  location: ""
};

const TEXT = {
  th: {
    title: "ตั้งค่า",
    subtitle: "",
    back: "ย้อนกลับ",
    store: "ข้อมูลร้านค้า/บริษัท",
    storeDesc: "รหัสร้าน ชื่อที่แสดง โลโก้ ที่อยู่ และเบอร์ติดต่อ",
    branches: "เพิ่มสาขา",
    branchesDesc: "รายการสาขาที่เปิดใช้งาน เพิ่ม แก้ไข และลบสาขา",
    devices: "เพิ่มเครื่องแคชเชียร์",
    devicesDesc: "ผูกเครื่อง POS กับสาขา นโยบายล็อกอิน สิทธิ์ผู้ใช้ และกะขาย",
    payments: "ตั้งค่าชำระเงิน",
    paymentsDesc: "บัญชีธนาคาร พร้อมเพย์ QR และสถานะใช้งาน",
    taxes: "ตั้งค่าภาษี",
    taxesDesc: "กำหนด VAT และภาษีหัก ณ ที่จ่ายสำหรับสรุปยอดชำระ",
    users: "ผู้ใช้งาน",
    usersDesc: "จัดการพนักงาน สิทธิ์ และ PIN",
    stockMenu: "จัดการสินค้า",
    stockMenuDesc: "สินค้า สต็อก วัตถุดิบ ราคา และหมวดหมู่",
    membersMenu: "สมาชิก",
    membersMenuDesc: "ค้นหาและจัดการข้อมูลสมาชิกหน้าร้าน",
    receiptsMenu: "ใบเสร็จย้อนหลัง",
    receiptsMenuDesc: "ค้นหาใบเสร็จและสั่งพิมพ์ย้อนหลัง 58mm",
    salesSummaryMenu: "สรุปยอดขาย",
    salesSummaryMenuDesc: "ดูยอดขาย ภาษี เงินสด/โอน และรายงานประจำกะ",
    display: "จอลูกค้า",
    displayDesc: "ตั้งค่าหน้าจอลูกค้าและการแสดงผล",
    language: "เปลี่ยนภาษา",
    languageDesc: "สลับภาษาไทยหรืออังกฤษสำหรับหน้าขายและเมนูพนักงาน",
    languageTitle: "เปลี่ยนภาษา",
    languageCurrent: "ภาษาปัจจุบัน",
    languageChoose: "เลือกภาษาที่ต้องการใช้งาน",
    thai: "ไทย",
    english: "English",
    mainMenuPlacement: "สลับแถบเมนูหลัก",
    mainMenuPlacementDesc: "ย้ายแถบเมนูหลักไปซ้ายแบบเดิม ด้านบน หรือด้านล่างของหน้าจอ",
    mainMenuPlacementTitle: "สลับตำแหน่งแถบเมนูหลัก",
    mainMenuPlacementChoose: "เลือกตำแหน่งที่เหมาะกับการใช้งานหน้าร้าน",
    mainMenuLeft: "ซ้ายแบบเดิม",
    mainMenuLeftDesc: "ใช้แถบเมนูแนวตั้งด้านซ้ายเหมือนเดิม พร้อมโลโก้และปุ่มออกจากระบบด้านล่าง",
    mainMenuTop: "ย้ายไปด้านบน",
    mainMenuTopDesc: "แถบเมนูหลักเป็นแนวนอนด้านบน เหมาะกับจอกว้างหรือเคาน์เตอร์ที่ต้องการพื้นที่ซ้ายขวา",
    mainMenuBottom: "ย้ายไปด้านล่าง",
    mainMenuBottomDesc: "แถบเมนูหลักเป็นแนวนอนด้านล่าง เหมาะกับแท็บเล็ตหรือหน้าจอที่ต้องแตะจากขอบล่าง",
    activityAudit: "ตรวจสอบพฤติกรรมการใช้งาน",
    activityAuditDesc: "บันทึกว่าใครทำอะไร เมนูไหน เวลาใด พร้อม PIN และการอนุมัติ",
    pinConfirmTitle: "ยืนยัน PIN ก่อนเปิดดู",
    pinConfirmDesc: "เจ้าของร้านหรือผู้จัดการต้องยืนยัน PIN ทุกครั้ง ระบบจะบันทึกการเข้าดูและส่งให้หลังบ้าน IT",
    pinCode: "รหัส PIN",
    confirm: "ยืนยัน",
    search: "ค้นหา",
    filter: "คัดกรอง",
    period: "ช่วงเวลา",
    daily: "รายวัน",
    monthly: "รายเดือน",
    yearly: "รายปี",
    date: "วันที่",
    month: "เดือน",
    year: "ปี",
    module: "เมนู",
    allMenus: "ทุกเมนู",
    action: "พฤติกรรม",
    actor: "ผู้ใช้งาน",
    employeeCode: "รหัสพนักงาน",
    approver: "ผู้อนุมัติ",
    target: "ข้อมูลที่เกี่ยวข้อง",
    viewedAt: "วันที่ เวลา",
    previous: "ก่อนหน้า",
    next: "ถัดไป",
    totalRecords: "รายการทั้งหมด",
    deleteRecords: "การลบ/ยกเลิก",
    pinRecords: "PIN/อนุมัติ",
    viewRecords: "การเข้าดู",
    noRecords: "ไม่พบรายการ",
    checkingSystem: "กำลังตรวจสอบระบบ",
    edit: "แก้ไข",
    save: "บันทึก",
    saving: "กำลังบันทึก...",
    cancel: "ยกเลิก",
    add: "เพิ่ม",
    addBranch: "เพิ่มสาขา",
    savingBranch: "กำลังเพิ่มสาขา...",
    branchSaved: "เพิ่มสาขาสำเร็จ",
    delete: "ลบ",
    active: "ใช้งาน",
    inactive: "ปิดใช้งาน",
    storeCode: "รหัสร้าน",
    displayName: "การแสดงชื่อร้าน",
    logoUrl: "โลโก้ร้าน",
    uploadLogo: "อัปโหลดโลโก้",
    removeLogo: "ลบโลโก้",
    logoUploadHint: "ระบบจะย่อขนาดรูปก่อนบันทึก และนำไปใช้บนใบเสร็จ POS อัตโนมัติ",
    address: "ที่อยู่",
    phone: "เบอร์ติดต่อ",
    branchCode: "รหัสสาขา",
    branchName: "ชื่อสาขา",
    deviceCode: "รหัสเครื่อง",
    deviceName: "ชื่อเครื่องแคชเชียร์",
    deviceType: "ประเภทเครื่อง",
    deviceStatus: "สถานะเครื่อง",
    lockDevice: "ผูกเครื่องกับสาขา",
    sharedDevice: "ใช้ร่วมกัน",
    counterName: "ชื่อเคาน์เตอร์",
    location: "ตำแหน่งติดตั้ง",
    lastSeen: "เชื่อมต่อล่าสุด",
    posTerminal: "เครื่อง POS",
    mobileScanner: "มือถือสแกน",
    kiosk: "Kiosk",
    maintenance: "บำรุงรักษา",
    bankName: "ชื่อธนาคาร",
    accountName: "ชื่อบัญชี",
    accountNo: "เลขบัญชี",
    promptpay: "เบอร์พร้อมเพย์",
    qrImage: "ภาพ QR",
    qrMode: "รูปแบบ QR",
    qrModePromptPay: "QR ล็อกยอดจากพร้อมเพย์",
    qrModeImage: "ใช้ภาพ QR ที่อัปโหลด",
    qrModePromptPayHint: "หน้าขายจะใช้ลิงก์ promptpay.io แล้วเปลี่ยนยอดตามบิลอัตโนมัติ",
    qrModeImageHint: "หน้าขายจะดึงภาพ QR นี้ไปแสดงแทนการสร้างลิงก์",
    promptpayLinkPreview: "ลิงก์ที่จะใช้บนหน้าขาย",
    uploadQr: "อัปโหลด QR",
    removeQr: "ลบ QR",
    addPaymentAccount: "เพิ่มบัญชี",
    confirmDeletePayment: "ยืนยัน PIN ก่อนลบบัญชีชำระเงิน",
    branch: "สาขา",
    allBranches: "ทุกสาขา",
    qrPayload: "PromptPay payload",
    taxEnabled: "เปิดใช้งานภาษี",
    taxDisabled: "ยังไม่เปิดใช้งาน",
    taxBranch: "สาขาที่ตั้งค่าภาษี",
    taxBranchHint: "ภาษีและสถานะเปิดใช้งานจะแยกจากกันในแต่ละสาขา",
    taxBranchLoading: "กำลังโหลดข้อมูลภาษีของสาขา...",
    taxBranchDisabled: "ปิดภาษีสำหรับสาขานี้",
    taxLine: "รายการภาษี",
    taxRate: "อัตรา (%)",
    taxMode: "รูปแบบคำนวณ",
    taxAdd: "บวกในบิล",
    taxDeduct: "หักจากบิล",
    taxPreview: "ตัวอย่างจากยอด 1,000",
    taxGrandTotal: "ยอดชำระหลังภาษี",
    taxNetBase: "คำนวณจากยอดหลังส่วนลด",
    schemaMissing: "ยังไม่ได้รัน migration สำหรับบัญชีชำระเงิน",
    saved: "บันทึกเรียบร้อย",
    failed: "ทำรายการไม่สำเร็จ",
    requestTimeout: "บันทึกนานเกินไป กรุณาลองใหม่อีกครั้ง"
  },
  en: {
    title: "Settings",
    subtitle: "",
    back: "Back",
    store: "Store / Company",
    storeDesc: "Store code, display name, logo, address, and contact phone",
    branches: "Branches",
    branchesDesc: "Open branches, add, edit, and delete",
    devices: "Add Cashier Machine",
    devicesDesc: "Bind POS devices to branches, login policy, user scope, and shifts",
    payments: "Payment Settings",
    paymentsDesc: "Bank accounts, PromptPay, QR, and active status",
    taxes: "Tax Settings",
    taxesDesc: "Configure VAT and withholding lines for payment summaries",
    users: "Users",
    usersDesc: "Manage staff, permissions, and PIN",
    stockMenu: "Product Management",
    stockMenuDesc: "Products, stock, ingredients, prices, and categories",
    membersMenu: "Members",
    membersMenuDesc: "Search and manage store member records",
    receiptsMenu: "Receipt History",
    receiptsMenuDesc: "Search receipts and reprint 58mm receipts",
    salesSummaryMenu: "Sales Summary",
    salesSummaryMenuDesc: "Review sales, tax, cash/transfer, and shift reports",
    display: "Customer Display",
    displayDesc: "Configure customer-facing display",
    language: "Change Language",
    languageDesc: "Switch Thai or English for sales screens and staff menu",
    languageTitle: "Change Language",
    languageCurrent: "Current language",
    languageChoose: "Choose the interface language",
    thai: "Thai",
    english: "English",
    mainMenuPlacement: "Main Menu Position",
    mainMenuPlacementDesc: "Move the main menu bar to the original left side, the top, or the bottom of the screen",
    mainMenuPlacementTitle: "Change Main Menu Position",
    mainMenuPlacementChoose: "Choose the position that best fits the counter screen",
    mainMenuLeft: "Original left bar",
    mainMenuLeftDesc: "Use the original vertical sidebar with logo and logout at the bottom",
    mainMenuTop: "Move to top",
    mainMenuTopDesc: "Use a horizontal main menu bar at the top for wide counter screens",
    mainMenuBottom: "Move to bottom",
    mainMenuBottomDesc: "Use a horizontal main menu bar at the bottom for tablets and lower-edge touch access",
    activityAudit: "Usage Behavior Audit",
    activityAuditDesc: "Track who did what, which menu, time, PIN, and approvals",
    pinConfirmTitle: "Confirm PIN before viewing",
    pinConfirmDesc: "Owner or manager PIN is required. Each view is logged for IT back office review.",
    pinCode: "PIN",
    confirm: "Confirm",
    search: "Search",
    filter: "Filter",
    period: "Period",
    daily: "Daily",
    monthly: "Monthly",
    yearly: "Yearly",
    date: "Date",
    month: "Month",
    year: "Year",
    module: "Menu",
    allMenus: "All menus",
    action: "Action",
    actor: "User",
    employeeCode: "Employee code",
    approver: "Approver",
    target: "Target",
    viewedAt: "Date time",
    previous: "Previous",
    next: "Next",
    totalRecords: "Total records",
    deleteRecords: "Delete/cancel",
    pinRecords: "PIN/approval",
    viewRecords: "Views",
    noRecords: "No records",
    checkingSystem: "Checking system",
    edit: "Edit",
    save: "Save",
    saving: "Saving...",
    cancel: "Cancel",
    add: "Add",
    addBranch: "Add branch",
    savingBranch: "Adding branch...",
    branchSaved: "Branch added successfully",
    delete: "Delete",
    active: "Active",
    inactive: "Inactive",
    storeCode: "Store code",
    displayName: "Display name",
    logoUrl: "Logo",
    uploadLogo: "Upload logo",
    removeLogo: "Remove logo",
    logoUploadHint: "The image is resized before saving and used on POS receipts automatically",
    address: "Address",
    phone: "Contact phone",
    branchCode: "Branch code",
    branchName: "Branch name",
    deviceCode: "Device code",
    deviceName: "Cashier machine name",
    deviceType: "Device type",
    deviceStatus: "Device status",
    lockDevice: "Bind device to branch",
    sharedDevice: "Shared device",
    counterName: "Counter name",
    location: "Install location",
    lastSeen: "Last connected",
    posTerminal: "POS terminal",
    mobileScanner: "Mobile scanner",
    kiosk: "Kiosk",
    maintenance: "Maintenance",
    bankName: "Bank name",
    accountName: "Account name",
    accountNo: "Account number",
    promptpay: "PromptPay phone",
    qrImage: "QR image",
    qrMode: "QR mode",
    qrModePromptPay: "Amount-locked PromptPay QR",
    qrModeImage: "Uploaded QR image",
    qrModePromptPayHint: "The sales screen uses promptpay.io and changes only the bill amount.",
    qrModeImageHint: "The sales screen shows this uploaded QR image instead of generating a link.",
    promptpayLinkPreview: "Sales screen link",
    uploadQr: "Upload QR",
    removeQr: "Remove QR",
    addPaymentAccount: "Add account",
    confirmDeletePayment: "Confirm PIN before deleting payment account",
    branch: "Branch",
    allBranches: "All branches",
    qrPayload: "PromptPay payload",
    taxEnabled: "Enable tax",
    taxDisabled: "Tax is disabled",
    taxBranch: "Tax settings branch",
    taxBranchHint: "Tax lines and enabled status are stored separately for each branch.",
    taxBranchLoading: "Loading branch tax settings...",
    taxBranchDisabled: "Tax is disabled for this branch",
    taxLine: "Tax line",
    taxRate: "Rate (%)",
    taxMode: "Calculation",
    taxAdd: "Add to bill",
    taxDeduct: "Deduct from bill",
    taxPreview: "Preview from 1,000",
    taxGrandTotal: "Total after tax",
    taxNetBase: "Calculate from net after discount",
    schemaMissing: "Payment account migration has not been applied yet",
    saved: "Saved",
    failed: "Request failed",
    requestTimeout: "Saving took too long. Please try again."
  }
} as const;

type Labels = Record<keyof typeof TEXT.th, string>;
type StatusReporter = (message: string, options?: { popup?: boolean }) => void;

function Icon({ name }: { name: MenuIconName }) {
  const common = {
    width: 18,
    height: 18,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const
  };
  if (name === "back") {
    return (
      <svg {...common}>
        <path d="M19 12H5" />
        <path d="M12 19l-7-7 7-7" />
      </svg>
    );
  }
  if (name === "branch") {
    return (
      <svg {...common}>
        <path d="M6 21V9" />
        <path d="M18 21V9" />
        <path d="M3 21h18" />
        <path d="M4 9l8-6 8 6" />
        <path d="M9 21v-6h6v6" />
      </svg>
    );
  }
  if (name === "payment") {
    return (
      <svg {...common}>
        <rect x="3" y="6" width="18" height="12" rx="2" />
        <path d="M3 10h18" />
        <path d="M7 15h3" />
      </svg>
    );
  }
  if (name === "tax") {
    return (
      <svg {...common}>
        <path d="M19 5 5 19" />
        <circle cx="7.5" cy="7.5" r="2.5" />
        <circle cx="16.5" cy="16.5" r="2.5" />
      </svg>
    );
  }
  if (name === "users") {
    return (
      <svg {...common}>
        <circle cx="9" cy="8" r="3" />
        <path d="M3 20c0-3.5 2.7-6 6-6" />
        <circle cx="17" cy="10" r="2.5" />
        <path d="M13 20c.5-2.8 2.6-4.5 5-4.5" />
      </svg>
    );
  }
  if (name === "display") {
    return (
      <svg {...common}>
        <rect x="3" y="5" width="18" height="12" rx="2" />
        <path d="M8 21h8" />
        <path d="M12 17v4" />
      </svg>
    );
  }
  if (name === "terminal") {
    return (
      <svg {...common}>
        <rect x="4" y="4" width="16" height="14" rx="2" />
        <path d="M8 8h8" />
        <path d="M8 12h3" />
        <path d="M14 12h2" />
        <path d="M7 22h10" />
        <path d="M12 18v4" />
      </svg>
    );
  }
  if (name === "activity") {
    return (
      <svg {...common}>
        <path d="M9 3h6l1 2h3v16H5V5h3Z" />
        <path d="M9 9h6" />
        <path d="M9 13h3" />
        <path d="M15 13l1.5 1.5L19 12" />
        <path d="M9 17h6" />
      </svg>
    );
  }
  if (name === "bell") {
    return (
      <svg {...common}>
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
        <path d="M10 21h4" />
      </svg>
    );
  }
  if (name === "tables") {
    return (
      <svg {...common}>
        <rect x="4" y="6" width="16" height="4" rx="1" />
        <path d="M6 10v8" />
        <path d="M18 10v8" />
        <path d="M4 18h16" />
      </svg>
    );
  }
  if (name === "stock") {
    return (
      <svg {...common}>
        <rect x="4" y="6" width="16" height="12" rx="2" />
        <path d="M8 10h8" />
        <path d="M8 14h8" />
      </svg>
    );
  }
  if (name === "summary") {
    return (
      <svg {...common}>
        <path d="M4 20h16" />
        <rect x="6" y="11" width="3" height="7" />
        <rect x="11" y="8" width="3" height="10" />
        <rect x="16" y="5" width="3" height="13" />
      </svg>
    );
  }
  if (name === "receipt") {
    return (
      <svg {...common}>
        <path d="M7 3h10v18l-2-1-2 1-2-1-2 1-2-1-2 1V3z" />
        <path d="M9 8h6" />
        <path d="M9 12h6" />
      </svg>
    );
  }
  if (name === "members") {
    return (
      <svg {...common}>
        <circle cx="9" cy="8" r="3" />
        <path d="M3.5 20c.7-3.2 2.9-5 5.5-5s4.8 1.8 5.5 5" />
        <circle cx="17" cy="10" r="2.2" />
        <path d="M14.5 17.5c.7-1.4 1.9-2.2 3.5-2.2 1.3 0 2.4.5 3.1 1.5" />
      </svg>
    );
  }
  if (name === "language") {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18" />
        <path d="M12 3c2.2 2.4 3.3 5.4 3.3 9S14.2 18.6 12 21" />
        <path d="M12 3c-2.2 2.4-3.3 5.4-3.3 9s1.1 6.6 3.3 9" />
      </svg>
    );
  }
  if (name === "edit") {
    return (
      <svg {...common}>
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
      </svg>
    );
  }
  if (name === "trash") {
    return (
      <svg {...common}>
        <path d="M3 6h18" />
        <path d="M8 6V4h8v2" />
        <path d="M6 6l1 16h10l1-16" />
      </svg>
    );
  }
  if (name === "plus") {
    return (
      <svg {...common}>
        <path d="M12 5v14" />
        <path d="M5 12h14" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M4 10.5 12 4l8 6.5" />
      <path d="M6 10v10h12V10" />
      <path d="M10 20v-6h4v6" />
    </svg>
  );
}

function storeToForm(store: StoreSettings | null): StoreForm {
  return {
    display_name: store?.display_name ?? store?.name ?? "",
    logo_url: store?.logo_url ?? "",
    company_address: store?.company_address ?? "",
    contact_phone: store?.contact_phone ?? ""
  };
}

function branchToForm(branch: BranchSettings): BranchForm {
  return {
    id: branch.id,
    code: branch.code,
    name: branch.name,
    address: branch.address,
    is_active: branch.is_active
  };
}

function paymentToForm(account: PaymentAccountSettings): PaymentForm {
  return {
    id: account.id,
    branch_id: account.branch_id,
    bank_name: account.bank_name,
    account_name: account.account_name,
    account_number: account.account_number,
    promptpay_phone: account.promptpay_phone,
    qr_image_url: account.qr_image_url,
    qr_mode: account.qr_mode,
    applies_to_all_branches: account.applies_to_all_branches,
    is_active: account.is_active
  };
}

function deviceToForm(device: PosDeviceSettings): DeviceForm {
  return {
    id: device.id,
    branch_id: device.branch_id,
    device_code: device.device_code,
    device_name: device.device_name,
    device_type: device.device_type,
    status: device.status,
    is_locked: device.is_locked,
    counter_name: device.counter_name,
    location: device.location
  };
}

function buildPromptPayPayload(phone: string) {
  const digits = phone.replace(/[^\d]/g, "");
  return digits ? `https://promptpay.io/${digits}/{amount}` : "";
}

function readPreviewPaymentAccounts(storageKey: string) {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PaymentAccountSettings[]) : [];
  } catch {
    return [];
  }
}

function writePreviewPaymentAccounts(storageKey: string, accounts: PaymentAccountSettings[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(accounts));
  } catch {
    // Preview fallback only. Ignore storage quota/private-mode failures.
  }
}

function isRecoverablePaymentAccountError(message: string) {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("__request_timeout__") ||
    normalized.includes("migration") ||
    normalized.includes("table is missing") ||
    normalized.includes("tenant_payment_accounts") ||
    normalized.includes("payment_accounts_schema_missing")
  );
}

function makePreviewPaymentAccount(form: PaymentForm, fallbackBranchId: string): PaymentAccountSettings {
  const id =
    form.id ||
    (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `preview-payment-${Date.now()}`);
  return {
    id,
    branch_id: form.branch_id || fallbackBranchId,
    bank_name: form.bank_name.trim(),
    account_name: form.account_name.trim(),
    account_number: form.account_number.trim(),
    promptpay_phone: form.promptpay_phone.trim(),
    promptpay_payload: buildPromptPayPayload(form.promptpay_phone),
    qr_image_url: form.qr_image_url,
    qr_mode: form.qr_mode,
    applies_to_all_branches: form.applies_to_all_branches,
    is_active: form.is_active
  };
}

function isPaymentAccountScopeConflict(left: PaymentAccountSettings, right: PaymentAccountSettings): boolean {
  if (left.id === right.id) return false;
  if (left.applies_to_all_branches || right.applies_to_all_branches) return true;
  return left.branch_id === right.branch_id;
}

function mergePaymentAccountUpdate(accounts: PaymentAccountSettings[], savedAccount: PaymentAccountSettings): PaymentAccountSettings[] {
  const nextAccounts = accounts.some((account) => account.id === savedAccount.id)
    ? accounts.map((account) => (account.id === savedAccount.id ? savedAccount : account))
    : [...accounts, savedAccount];
  if (!savedAccount.is_active) return nextAccounts;
  return nextAccounts.map((account) =>
    isPaymentAccountScopeConflict(savedAccount, account) ? { ...account, is_active: false } : account
  );
}

function signalPaymentSettingsUpdated() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(POS_PAYMENT_SETTINGS_UPDATED_KEY, new Date().toISOString());
  } catch {
    // The database/local save already succeeded; storage only wakes other POS tabs.
  }
  window.dispatchEvent(new CustomEvent(POS_PAYMENT_SETTINGS_UPDATED_EVENT));
}

function todayInputValue() {
  const now = new Date();
  const offsetMs = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offsetMs).toISOString().slice(0, 10);
}

function periodInputType(period: ActivityAuditPeriod) {
  if (period === "year") return "number";
  if (period === "month") return "month";
  return "date";
}

function normalizeDateValue(period: ActivityAuditPeriod, value: string) {
  const today = todayInputValue();
  if (period === "year") return value || today.slice(0, 4);
  if (period === "month") return value || today.slice(0, 7);
  return value || today;
}

function resizeLogoFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) {
      reject(new Error("Please choose an image file."));
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const image = new window.Image();
      image.onload = () => {
        const maxWidth = 360;
        const maxHeight = 180;
        const ratio = Math.min(maxWidth / image.width, maxHeight / image.height, 1);
        const width = Math.max(1, Math.round(image.width * ratio));
        const height = Math.max(1, Math.round(image.height * ratio));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d");
        if (!context) {
          reject(new Error("Unable to resize logo."));
          return;
        }
        context.clearRect(0, 0, width, height);
        context.drawImage(image, 0, 0, width, height);
        resolve(canvas.toDataURL("image/webp", 0.78));
      };
      image.onerror = () => reject(new Error("Unable to read logo image."));
      image.src = String(reader.result ?? "");
    };
    reader.onerror = () => reject(new Error("Unable to read logo image."));
    reader.readAsDataURL(file);
  });
}

function resizeQrFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) {
      reject(new Error("Please choose an image file."));
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const image = new window.Image();
      image.onload = () => {
        const maxSize = 520;
        const ratio = Math.min(maxSize / image.width, maxSize / image.height, 1);
        const width = Math.max(1, Math.round(image.width * ratio));
        const height = Math.max(1, Math.round(image.height * ratio));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d");
        if (!context) {
          reject(new Error("Unable to resize QR image."));
          return;
        }
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, width, height);
        context.drawImage(image, 0, 0, width, height);
        resolve(canvas.toDataURL("image/webp", 0.86));
      };
      image.onerror = () => reject(new Error("Unable to read QR image."));
      image.src = String(reader.result ?? "");
    };
    reader.onerror = () => reject(new Error("Unable to read QR image."));
    reader.readAsDataURL(file);
  });
}

function formatAuditDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Bangkok"
  }).format(date);
}

function auditMenuLabel(item: ActivityAuditItem, lang: Language) {
  const key = `${item.module || ""} ${item.target_table || ""} ${item.menu || ""}`.toLowerCase();
  const labels =
    lang === "en"
      ? {
          sales: "Sales screen",
          stock: "Product management",
          shift: "Shift open/close",
          users: "System users",
          settings: "Settings",
          activity: "Usage behavior audit",
          performance: "System performance",
          sessions: "POS login sessions",
          it: "IT back office",
          general: "System activity"
        }
      : {
          sales: "หน้าขาย",
          stock: "จัดการสินค้า",
          shift: "เปิด/ปิดกะ",
          users: "ผู้ใช้งานระบบ",
          settings: "ตั้งค่า",
          activity: "ตรวจสอบพฤติกรรมการใช้งาน",
          performance: "ตรวจสอบประสิทธิภาพระบบ",
          sessions: "การเข้าใช้งาน POS",
          it: "ระบบหลังบ้าน IT",
          general: "การทำงานของระบบ"
        };

  if (key.includes("settings_activity_audit")) return labels.activity;
  if (key.includes("pos_performance") || key.includes("pos_route")) return labels.performance;
  if (key.includes("pos_session")) return labels.sessions;
  if (key.includes("pos_sales") || key.includes("orders") || key.includes("payments")) return labels.sales;
  if (key.includes("stock") || key.includes("ingredient") || key.includes("product")) return labels.stock;
  if (key.includes("shift")) return labels.shift;
  if (key.includes("staff") || key.includes("user")) return labels.users;
  if (key.includes("setting")) return labels.settings;
  if (key.includes("it_admin")) return labels.it;
  return labels.general;
}

function auditActionLabel(item: ActivityAuditItem, lang: Language) {
  const action = item.action.toLowerCase();
  const table = item.target_table.toLowerCase();
  const labels =
    lang === "en"
      ? {
          viewedAudit: "Viewed usage behavior history",
          pinFailed: "Entered an incorrect PIN",
          pinGranted: "Approved with PIN",
          performance: "Checked system performance",
          login: "Logged in to POS",
          logout: "Logged out",
          userUpdated: "Updated a system user",
          userCreated: "Added a system user",
          userDeleted: "Deleted a system user",
          created: "Added new information",
          updated: "Edited information",
          deleted: "Deleted information",
          cancelled: "Cancelled a transaction",
          viewed: "Viewed information",
          printed: "Printed a document",
          paid: "Recorded a payment",
          opened: "Opened a shift",
          closed: "Closed a shift",
          general: "Used the system"
        }
      : {
          viewedAudit: "เปิดดูประวัติพฤติกรรมการใช้งาน",
          pinFailed: "กรอก PIN ไม่ถูกต้อง",
          pinGranted: "อนุมัติรายการด้วย PIN",
          performance: "ตรวจสอบความเร็วและสถานะของระบบ",
          login: "เข้าสู่ระบบ POS",
          logout: "ออกจากระบบ",
          userUpdated: "แก้ไขข้อมูลผู้ใช้งานระบบ",
          userCreated: "เพิ่มผู้ใช้งานระบบ",
          userDeleted: "ลบผู้ใช้งานระบบ",
          created: "เพิ่มข้อมูลใหม่",
          updated: "แก้ไขข้อมูล",
          deleted: "ลบข้อมูล",
          cancelled: "ยกเลิกรายการ",
          viewed: "เปิดดูข้อมูล",
          printed: "พิมพ์เอกสาร",
          paid: "บันทึกการชำระเงิน",
          opened: "เปิดกะขาย",
          closed: "ปิดกะขาย",
          general: "ใช้งานระบบ"
        };

  if (action === "settings_activity_audit_viewed") return labels.viewedAudit;
  if (action === "settings_activity_audit_pin_failed" || action === "pin_approval_failed") return labels.pinFailed;
  if (action === "pin_approval_granted") return labels.pinGranted;
  if (action === "pos_route_perf" || table === "pos_routes") return labels.performance;
  if (action === "session_created" || action.includes("login_success")) return labels.login;
  if (action.includes("logout") || action.includes("session_revoked")) return labels.logout;
  if (action.includes("user") && (action.includes("updated") || action.includes("edit"))) return labels.userUpdated;
  if (action.includes("user") && (action.includes("created") || action.includes("added"))) return labels.userCreated;
  if (action.includes("user") && (action.includes("deleted") || action.includes("delete"))) return labels.userDeleted;
  if (action.includes("cancel")) return labels.cancelled;
  if (action.includes("delete") || action.includes("deleted") || action.includes("revoked")) return labels.deleted;
  if (action.includes("update") || action.includes("updated") || action.includes("edit")) return labels.updated;
  if (action.includes("create") || action.includes("created") || action.includes("add")) return labels.created;
  if (action.includes("view") || action.includes("read") || action.includes("opened")) return labels.viewed;
  if (action.includes("print")) return labels.printed;
  if (action.includes("pay") || action.includes("payment")) return labels.paid;
  if (action.includes("shift_open")) return labels.opened;
  if (action.includes("shift_close")) return labels.closed;
  return labels.general;
}

async function readApiData<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as { data?: T; error?: { message?: string } | null };
  if (!response.ok || payload.error) {
    throw new Error(payload.error?.message ?? "Request failed.");
  }
  return payload.data as T;
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = 10_000) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("__request_timeout__");
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function wait(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

async function keepPopupVisible(startedAt: number, minimumMs = 550) {
  const remainingMs = minimumMs - (Date.now() - startedAt);
  if (remainingMs > 0) await wait(remainingMs);
}

function Field({
  label,
  value,
  onChange,
  disabled,
  type = "text"
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  type?: string;
}) {
  return (
    <label className="grid gap-1.5 text-[13px] font-semibold text-slate-700">
      <span>{label}</span>
      <input
        type={type}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-950 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-50 disabled:text-slate-500"
      />
    </label>
  );
}

function TextArea({
  label,
  value,
  onChange,
  disabled
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <label className="grid gap-1.5 text-[13px] font-semibold text-slate-700">
      <span>{label}</span>
      <textarea
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        rows={3}
        className="min-h-24 resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-50 disabled:text-slate-500"
      />
    </label>
  );
}

function ActionButton({
  children,
  onClick,
  disabled,
  variant = "primary",
  type = "button"
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "plain" | "danger";
  type?: "button" | "submit";
}) {
  const className =
    variant === "danger"
      ? "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 text-sm font-bold text-red-700 transition hover:bg-red-100 disabled:opacity-60"
      : variant === "plain"
        ? "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-800 transition hover:bg-slate-50 disabled:opacity-60"
        : "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-60";
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={className}>
      {children}
    </button>
  );
}

function StatusPill({ active, labels }: { active: boolean; labels: Labels }) {
  return (
    <span
      className={`inline-flex min-h-7 items-center rounded-full px-2.5 text-xs font-bold ${
        active ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200" : "bg-slate-100 text-slate-600 ring-1 ring-slate-200"
      }`}
    >
      {active ? labels.active : labels.inactive}
    </span>
  );
}

function SaveSuccessPopup({ labels, message, onClose }: { labels: Labels; message: string; onClose: () => void }) {
  useEffect(() => {
    const timeoutId = window.setTimeout(onClose, 2600);
    return () => window.clearTimeout(timeoutId);
  }, [onClose]);

  return (
    <div className="pointer-events-none fixed right-4 top-4 z-[70] flex w-[min(420px,calc(100vw-32px))] justify-end" role="status" aria-live="polite">
      <div className="pointer-events-auto flex w-full items-start gap-3 rounded-lg border border-emerald-100 bg-white p-4 text-left shadow-xl">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 ring-1 ring-emerald-100">
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        </div>
        <p className="min-w-0 flex-1 text-sm font-black text-slate-950">{message}</p>
        <button type="button" onClick={onClose} className="shrink-0 rounded-md px-2 py-1 text-xs font-bold text-slate-500 hover:bg-slate-50" aria-label={labels.cancel}>
          x
        </button>
      </div>
    </div>
  );
}

function MenuButton({
  icon,
  title,
  desc,
  onClick,
  locked = false,
  compact = false
}: {
  icon: MenuIconName;
  title: string;
  desc: string;
  onClick: () => void;
  locked?: boolean;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-disabled={locked}
      className={`group grid ${compact ? "min-h-[64px] grid-cols-[36px_1fr_24px] p-3" : "min-h-[92px] grid-cols-[42px_1fr_28px] p-4"} items-center gap-3 rounded-lg border text-left transition ${
        locked ? "border-slate-200 bg-slate-50 text-slate-500 hover:border-blue-200" : "border-slate-200 bg-white hover:border-blue-200 hover:bg-blue-50/50"
      }`}
    >
      <span className={`inline-flex ${compact ? "h-9 w-9" : "h-10 w-10"} items-center justify-center rounded-lg ${locked ? "bg-slate-100 text-slate-400" : "bg-slate-100 text-slate-700 group-hover:bg-blue-100 group-hover:text-blue-700"}`}>
        <Icon name={icon} />
      </span>
      <span className="min-w-0">
        <span className={`${compact ? "text-sm" : "text-base"} block font-black text-slate-950`}>{title}</span>
        {compact ? null : <span className="mt-1 block text-sm font-medium leading-5 text-slate-500">{desc}</span>}
      </span>
      <span className="text-slate-400">›</span>
    </button>
  );
}

function MenuLink({ icon, title, desc, href, locked = false, onLocked }: { icon: MenuIconName; title: string; desc: string; href: string; locked?: boolean; onLocked?: () => void }) {
  return (
    <Link
      href={href}
      prefetch={false}
      onClick={(event) => {
        if (!locked) return;
        event.preventDefault();
        onLocked?.();
      }}
      aria-disabled={locked}
      className={`group grid min-h-[92px] grid-cols-[42px_1fr_24px] items-center gap-3 rounded-lg border p-4 text-left transition ${
        locked ? "border-slate-200 bg-slate-50 text-slate-500 hover:border-blue-200" : "border-slate-200 bg-white hover:border-blue-200 hover:bg-blue-50/50"
      }`}
    >
      <span className={`inline-flex h-10 w-10 items-center justify-center rounded-lg ${locked ? "bg-slate-100 text-slate-400" : "bg-slate-100 text-slate-700 group-hover:bg-blue-100 group-hover:text-blue-700"}`}>
        <Icon name={icon} />
      </span>
      <span className="min-w-0">
        <span className="block text-base font-black text-slate-950">{title}</span>
        <span className="mt-1 block text-sm font-medium leading-5 text-slate-500">{desc}</span>
      </span>
      <span className="text-slate-400">›</span>
    </Link>
  );
}

function PanelHeader({
  title,
  onBack,
  labels,
  action
}: {
  title: string;
  onBack: () => void;
  labels: Labels;
  action?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 transition hover:bg-slate-50"
          title={labels.back}
          aria-label={labels.back}
        >
          <Icon name="back" />
        </button>
        <h2 className="text-xl font-black text-slate-950">{title}</h2>
      </div>
      {action}
    </div>
  );
}

function StorePanel({
  labels,
  store,
  setStore,
  onBack,
  canManage,
  reportStatus
}: {
  labels: Labels;
  store: StoreSettings | null;
  setStore: (store: StoreSettings | null) => void;
  onBack: () => void;
  canManage: boolean;
  reportStatus: StatusReporter;
}) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<StoreForm>(() => storeToForm(store));
  const [isSaving, setIsSaving] = useState(false);
  const [isLogoBusy, setIsLogoBusy] = useState(false);
  const displayForm = storeToForm(store);

  function openEditor() {
    setForm(storeToForm(store));
    setEditing(true);
  }

  function closeEditor() {
    if (isSaving) return;
    setEditing(false);
    setForm(storeToForm(store));
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSaving) return;
    setIsSaving(true);
    void (async () => {
      try {
        const data = await readApiData<{ store: StoreSettings | null }>(
          await fetch("/api/pos/settings/store", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(form)
          })
        );
        setStore(data.store);
        setForm(storeToForm(data.store));
        setEditing(false);
        reportStatus(labels.saved, { popup: true });
      } catch (error) {
        reportStatus(error instanceof Error ? error.message : labels.failed);
      } finally {
        setIsSaving(false);
      }
    })();
  }

  function uploadLogo(file: File | undefined) {
    if (!file) return;
    setIsLogoBusy(true);
    void (async () => {
      try {
        const logoUrl = await resizeLogoFile(file);
        setForm((current) => ({ ...current, logo_url: logoUrl }));
      } catch (error) {
        reportStatus(error instanceof Error ? error.message : labels.failed);
      } finally {
        setIsLogoBusy(false);
      }
    })();
  }

  return (
    <section>
      <PanelHeader
        title={labels.store}
        onBack={onBack}
        labels={labels}
        action={
          canManage ? (
            <ActionButton onClick={openEditor} disabled={isSaving}>
              <Icon name="edit" />
              {labels.edit}
            </ActionButton>
          ) : null
        }
      />
      <div className="grid gap-5">
        <div>
          <div>
            <p className="text-sm font-semibold text-slate-500">{store?.name || displayForm.display_name || "-"}</p>
            <p className="mt-1 text-sm font-medium text-slate-400">{store?.code || "-"}</p>
          </div>
        </div>
        <div className="grid gap-4 lg:grid-cols-[180px_1fr]">
          <div className="flex min-h-40 items-center justify-center rounded-lg border border-slate-200 bg-slate-50">
            {displayForm.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={displayForm.logo_url} alt={labels.logoUrl} className="max-h-32 max-w-[150px] object-contain" />
            ) : (
              <span className="text-sm font-bold text-slate-400">LOGO</span>
            )}
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label={labels.storeCode} value={store?.code ?? ""} disabled onChange={() => undefined} />
            <Field
              label={labels.displayName}
              value={displayForm.display_name}
              disabled
              onChange={() => undefined}
            />
            <Field
              label={labels.phone}
              value={displayForm.contact_phone}
              disabled
              onChange={() => undefined}
            />
            <div className="md:col-span-2">
              <TextArea
                label={labels.address}
                value={displayForm.company_address}
                disabled
                onChange={() => undefined}
              />
            </div>
          </div>
        </div>
      </div>

      {editing ? (
        <div className="store-settings-drawer-overlay" role="presentation" onClick={closeEditor}>
          <form className="store-settings-drawer" role="dialog" aria-modal="true" aria-label={labels.store} onClick={(event) => event.stopPropagation()} onSubmit={save}>
            <div className="store-settings-drawer__header">
              <div>
                <p className="text-xs font-bold uppercase text-blue-600">{labels.edit}</p>
                <h3 className="text-lg font-black text-slate-950">{labels.store}</h3>
              </div>
              <button type="button" onClick={closeEditor} disabled={isSaving} className="store-settings-drawer__close" aria-label={labels.cancel}>
                x
              </button>
            </div>

            <div className="store-settings-drawer__body">
              <div className="flex min-h-36 items-center justify-center rounded-lg border border-slate-200 bg-slate-50">
                {form.logo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={form.logo_url} alt={labels.logoUrl} className="max-h-28 max-w-[150px] object-contain" />
                ) : (
                  <span className="text-sm font-bold text-slate-400">LOGO</span>
                )}
              </div>
              <Field label={labels.storeCode} value={store?.code ?? ""} disabled onChange={() => undefined} />
              <Field label={labels.displayName} value={form.display_name} disabled={isSaving} onChange={(value) => setForm((current) => ({ ...current, display_name: value }))} />
              <Field label={labels.phone} value={form.contact_phone} disabled={isSaving} onChange={(value) => setForm((current) => ({ ...current, contact_phone: value }))} />
              <TextArea label={labels.address} value={form.company_address} disabled={isSaving} onChange={(value) => setForm((current) => ({ ...current, company_address: value }))} />
              <div className="grid gap-1.5 text-[13px] font-semibold text-slate-700">
                <span>{labels.logoUrl}</span>
                <div className="flex flex-wrap gap-2">
                  <label className={`inline-flex min-h-10 cursor-pointer items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-800 transition hover:bg-slate-50 ${isSaving || isLogoBusy ? "pointer-events-none opacity-60" : ""}`}>
                    <Icon name="plus" />
                    {isLogoBusy ? "..." : labels.uploadLogo}
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/svg+xml"
                      disabled={isSaving || isLogoBusy}
                      className="sr-only"
                      onChange={(event) => {
                        uploadLogo(event.target.files?.[0]);
                        event.target.value = "";
                      }}
                    />
                  </label>
                  <ActionButton variant="plain" disabled={isSaving || !form.logo_url || isLogoBusy} onClick={() => setForm((current) => ({ ...current, logo_url: "" }))}>
                    {labels.removeLogo}
                  </ActionButton>
                </div>
                <p className="text-xs font-medium text-slate-500">{labels.logoUploadHint}</p>
              </div>
            </div>

            <div className="store-settings-drawer__footer">
              <ActionButton variant="plain" onClick={closeEditor} disabled={isSaving}>
                {labels.cancel}
              </ActionButton>
              <ActionButton type="submit" disabled={isSaving || isLogoBusy}>
                {isSaving ? labels.saving : labels.save}
              </ActionButton>
            </div>
          </form>
        </div>
      ) : null}
    </section>
  );
}

function BranchPanel({
  labels,
  branches,
  setBranches,
  onBack,
  canManage,
  activeBranchId,
  reportStatus
}: {
  labels: Labels;
  branches: BranchSettings[];
  setBranches: (branches: BranchSettings[]) => void;
  onBack: () => void;
  canManage: boolean;
  activeBranchId: string | null;
  reportStatus: StatusReporter;
}) {
  const [form, setForm] = useState<BranchForm>(emptyBranchForm);
  const [isBusy, setIsBusy] = useState(false);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const sortedBranches = useMemo(
    () => branches.filter((branch) => branch.is_active).sort((a, b) => a.name.localeCompare(b.name)),
    [branches]
  );

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isBusy) return;
    const isCreating = !form.id;
    const method = form.id ? "PATCH" : "POST";
    setIsBusy(true);
    void (async () => {
      try {
        const data = await readApiData<{ branch: BranchSettings }>(
          await fetch("/api/pos/settings/branches", {
            method,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(form)
          })
        );
        setBranches(
          branches.some((branch) => branch.id === data.branch.id)
            ? branches.map((branch) => (branch.id === data.branch.id ? data.branch : branch))
            : [...branches, data.branch]
        );
        setForm(emptyBranchForm);
        setIsFormOpen(false);
        reportStatus(isCreating ? labels.branchSaved : labels.saved, { popup: true });
      } catch (error) {
        reportStatus(error instanceof Error ? error.message : labels.failed, { popup: true });
      } finally {
        setIsBusy(false);
      }
    })();
  }

  function openCreateForm() {
    setForm(emptyBranchForm);
    setIsFormOpen(true);
  }

  function openEditForm(branch: BranchSettings) {
    setForm(branchToForm(branch));
    setIsFormOpen(true);
  }

  function closeForm() {
    if (isBusy) return;
    setForm(emptyBranchForm);
    setIsFormOpen(false);
  }

  function deleteBranch(branch: BranchSettings) {
    if (isBusy) return;
    setIsBusy(true);
    void (async () => {
      try {
        const data = await readApiData<{ branch: BranchSettings }>(
          await fetch(`/api/pos/settings/branches?branch_id=${encodeURIComponent(branch.id)}`, { method: "DELETE" })
        );
        setBranches(branches.map((item) => (item.id === data.branch.id ? data.branch : item)));
        reportStatus(labels.saved, { popup: true });
      } catch (error) {
        reportStatus(error instanceof Error ? error.message : labels.failed);
      } finally {
        setIsBusy(false);
      }
    })();
  }

  return (
    <section>
      <PanelHeader
        title={labels.branches}
        onBack={onBack}
        labels={labels}
        action={
          <ActionButton onClick={openCreateForm} disabled={!canManage || isBusy}>
            <Icon name="plus" />
            {labels.addBranch}
          </ActionButton>
        }
      />
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <div className="min-w-[680px]">
          <div className="grid grid-cols-[1fr_1fr_110px_120px] gap-3 border-b border-slate-100 bg-slate-50 px-4 py-3 text-xs font-black text-slate-500">
            <span>{labels.branchName}</span>
            <span>{labels.branchCode}</span>
            <span>{labels.active}</span>
            <span />
          </div>
          {sortedBranches.map((branch) => (
            <div key={branch.id} className="grid grid-cols-[1fr_1fr_110px_120px] items-center gap-3 border-b border-slate-100 px-4 py-3 last:border-b-0">
              <div className="min-w-0">
                <p className="truncate text-sm font-black text-slate-950">{branch.name}</p>
                <p className="truncate text-xs font-medium text-slate-500">{branch.address || "-"}</p>
              </div>
              <p className="truncate text-sm font-bold text-slate-700">{branch.code}</p>
              <StatusPill active={branch.is_active} labels={labels} />
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => openEditForm(branch)} className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50" title={labels.edit} aria-label={`${labels.edit} ${branch.name}`}>
                  <Icon name="edit" />
                </button>
                <button
                  type="button"
                  onClick={() => deleteBranch(branch)}
                  disabled={!canManage || isBusy || branch.id === activeBranchId}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-red-200 text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
                  title={labels.delete}
                >
                  <Icon name="trash" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
      {isFormOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-3 sm:p-4" role="dialog" aria-modal="true" aria-label={form.id ? labels.edit : labels.addBranch}>
          <form onSubmit={save} className="grid max-h-[calc(100vh-24px)] w-full max-w-lg gap-4 overflow-y-auto rounded-lg border border-slate-200 bg-white p-5 shadow-xl sm:max-h-[90vh]">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-base font-black text-slate-950">
                <Icon name={form.id ? "edit" : "plus"} />
                {form.id ? labels.edit : labels.addBranch}
              </div>
              <button
                type="button"
                onClick={closeForm}
                disabled={isBusy}
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
                aria-label={labels.cancel}
                title={labels.cancel}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
              </button>
            </div>
            <Field label={labels.branchCode} value={form.code} disabled={!canManage || isBusy} onChange={(value) => setForm((current) => ({ ...current, code: value }))} />
            <Field label={labels.branchName} value={form.name} disabled={!canManage || isBusy} onChange={(value) => setForm((current) => ({ ...current, name: value }))} />
            <TextArea label={labels.address} value={form.address} disabled={!canManage || isBusy} onChange={(value) => setForm((current) => ({ ...current, address: value }))} />
            <label className="inline-flex items-center gap-2 text-sm font-bold text-slate-700">
              <input type="checkbox" checked={form.is_active} disabled={!canManage || isBusy} onChange={(event) => setForm((current) => ({ ...current, is_active: event.target.checked }))} />
              {labels.active}
            </label>
            <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-4">
              <ActionButton variant="plain" onClick={closeForm} disabled={isBusy}>
                {labels.cancel}
              </ActionButton>
              <ActionButton type="submit" disabled={!canManage || isBusy}>
                {isBusy ? (form.id ? labels.saving : labels.savingBranch) : labels.save}
              </ActionButton>
            </div>
            {isBusy ? (
              <div className="store-v2-popup-overlay" role="dialog" aria-modal="true" aria-live="polite">
                <div className="store-v2-popup-card">
                  <div className="store-v2-popup-spinner" aria-hidden="true" />
                  <p className="store-v2-popup-title">{form.id ? labels.saving : labels.savingBranch}</p>
                </div>
              </div>
            ) : null}
          </form>
        </div>
      ) : null}
    </section>
  );
}

function DevicePanel({
  labels,
  devices,
  setDevices,
  devicesLoaded,
  setDevicesLoaded,
  branches,
  onBack,
  canManage,
  activeBranchId,
  reportStatus
}: {
  labels: Labels;
  devices: PosDeviceSettings[];
  setDevices: (devices: PosDeviceSettings[] | ((current: PosDeviceSettings[]) => PosDeviceSettings[])) => void;
  devicesLoaded: boolean;
  setDevicesLoaded: (loaded: boolean) => void;
  branches: BranchSettings[];
  onBack: () => void;
  canManage: boolean;
  activeBranchId: string | null;
  reportStatus: StatusReporter;
}) {
  const initialDeviceForm = { ...emptyDeviceForm, branch_id: activeBranchId ?? branches[0]?.id ?? "" };
  const [form, setForm] = useState<DeviceForm>(initialDeviceForm);
  const [branchFilter, setBranchFilter] = useState("all");
  const [isDeviceFormOpen, setIsDeviceFormOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<PosDeviceSettings | null>(null);
  const [isLoading, setIsLoading] = useState(!devicesLoaded);
  const [isMutating, setIsMutating] = useState(false);
  const [isScrollbarVisible, setIsScrollbarVisible] = useState(false);
  const scrollbarHideTimeoutRef = useRef<number | null>(null);
  const branchById = useMemo(() => new Map(branches.map((branch) => [branch.id, branch])), [branches]);
  const filteredDevices = useMemo(
    () => (branchFilter === "all" ? devices : devices.filter((device) => device.branch_id === branchFilter)),
    [branchFilter, devices]
  );
  const isBusy = isMutating;

  function revealScrollbarBriefly() {
    setIsScrollbarVisible(true);
    if (scrollbarHideTimeoutRef.current !== null) {
      window.clearTimeout(scrollbarHideTimeoutRef.current);
    }
    scrollbarHideTimeoutRef.current = window.setTimeout(() => {
      setIsScrollbarVisible(false);
      scrollbarHideTimeoutRef.current = null;
    }, 1400);
  }

  useEffect(() => {
    if (devicesLoaded) {
      setIsLoading(false);
      return;
    }

    const controller = new AbortController();
    setIsLoading(true);
    void (async () => {
      try {
        const data = await readApiData<{ devices: PosDeviceSettings[] }>(
          await fetch("/api/pos/settings/devices", { cache: "no-store", signal: controller.signal })
        );
        setDevices(data.devices);
        setDevicesLoaded(true);
      } catch (error) {
        if (!controller.signal.aborted) {
          reportStatus(error instanceof Error ? error.message : labels.failed, { popup: true });
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    })();
    return () => {
      controller.abort();
    };
  }, [devicesLoaded, labels.failed, reportStatus, setDevices, setDevicesLoaded]);

  useEffect(() => {
    return () => {
      if (scrollbarHideTimeoutRef.current !== null) {
        window.clearTimeout(scrollbarHideTimeoutRef.current);
      }
    };
  }, []);

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isBusy) return;
    const method = form.id ? "PATCH" : "POST";
    setIsMutating(true);
    void (async () => {
      try {
        const data = await readApiData<{ device: PosDeviceSettings }>(
          await fetchWithTimeout("/api/pos/settings/devices", {
            method,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(form)
          })
        );
        setDevices((current) => (current.some((device) => device.id === data.device.id) ? current.map((device) => (device.id === data.device.id ? data.device : device)) : [...current, data.device]));
        setForm(initialDeviceForm);
        setIsDeviceFormOpen(false);
        reportStatus(labels.saved, { popup: true });
      } catch (error) {
        reportStatus(error instanceof Error && error.message === "__request_timeout__" ? labels.requestTimeout : error instanceof Error ? error.message : labels.failed, { popup: true });
      } finally {
        setIsMutating(false);
      }
    })();
  }

  function deleteDevice(device: PosDeviceSettings) {
    if (isBusy) return;
    setIsMutating(true);
    void (async () => {
      try {
        const data = await readApiData<{ id: string; deleted: boolean }>(
          await fetch(`/api/pos/settings/devices?device_id=${encodeURIComponent(device.id)}`, { method: "DELETE" })
        );
        setDevices((current) => current.filter((item) => item.id !== data.id));
        setDeleteTarget(null);
        reportStatus(labels.saved, { popup: true });
      } catch (error) {
        reportStatus(error instanceof Error ? error.message : labels.failed, { popup: true });
      } finally {
        setIsMutating(false);
      }
    })();
  }

  function openCreateDevice() {
    setForm(initialDeviceForm);
    setIsDeviceFormOpen(true);
  }

  function openEditDevice(device: PosDeviceSettings) {
    setForm(deviceToForm(device));
    setIsDeviceFormOpen(true);
  }

  function closeDeviceForm() {
    if (isBusy) return;
    setForm(initialDeviceForm);
    setIsDeviceFormOpen(false);
  }

  return (
    <section>
      <PanelHeader title={labels.devices} onBack={onBack} labels={labels} />
      <div className="grid gap-5">
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <div className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-100 p-4">
            <label className="grid max-w-xs gap-1.5 text-[13px] font-semibold text-slate-700">
              <span>{labels.branch}</span>
              <select
                value={branchFilter}
                onChange={(event) => setBranchFilter(event.target.value)}
                className="min-h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-950 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
              >
                <option value="all">{labels.allBranches}</option>
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
              </select>
            </label>
            <ActionButton onClick={openCreateDevice} disabled={!canManage || isBusy}>
              <Icon name="terminal" />
              {labels.devices}
            </ActionButton>
          </div>
          <div className="grid grid-cols-[1fr_140px_130px_120px] gap-3 border-b border-slate-100 bg-slate-50 px-4 py-3 text-xs font-black text-slate-500">
            <span>{labels.deviceName}</span>
            <span>{labels.branch}</span>
            <span>{labels.deviceStatus}</span>
            <span />
          </div>
          {isLoading ? (
            Array.from({ length: 4 }).map((_, index) => (
              <div key={`device-loading-${index}`} className="grid grid-cols-[1fr_140px_130px_120px] items-center gap-3 border-b border-slate-100 px-4 py-4 last:border-b-0">
                <div className="grid gap-2">
                  <span className="h-4 w-44 animate-pulse rounded bg-slate-100" />
                  <span className="h-3 w-32 animate-pulse rounded bg-slate-100" />
                  <span className="h-3 w-20 animate-pulse rounded bg-slate-100" />
                </div>
                <span className="h-4 w-20 animate-pulse rounded bg-slate-100" />
                <span className="h-7 w-24 animate-pulse rounded-full bg-slate-100" />
                <span className="ml-auto h-9 w-20 animate-pulse rounded-lg bg-slate-100" />
              </div>
            ))
          ) : filteredDevices.map((device) => (
            <div key={device.id} className="grid grid-cols-[1fr_140px_130px_120px] items-center gap-3 border-b border-slate-100 px-4 py-3 last:border-b-0">
              <div className="min-w-0">
                <p className="truncate text-sm font-black text-slate-950">{device.device_name}</p>
                <p className="truncate text-xs font-bold text-slate-500">{device.device_code}</p>
                <p className="truncate text-xs font-medium text-slate-400">{device.counter_name || device.location || "-"}</p>
              </div>
              <p className="truncate text-sm font-bold text-slate-700">{branchById.get(device.branch_id)?.name ?? device.branch_id}</p>
              <div className="grid gap-1">
                <span
                  className={`inline-flex min-h-7 items-center rounded-full px-2.5 text-xs font-bold ${
                    device.status === "active"
                      ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
                      : device.status === "maintenance"
                        ? "bg-amber-50 text-amber-700 ring-1 ring-amber-200"
                        : "bg-slate-100 text-slate-600 ring-1 ring-slate-200"
                  }`}
                >
                  {device.status === "active" ? labels.active : device.status === "maintenance" ? labels.maintenance : labels.inactive}
                </span>
                <span className="text-xs font-semibold text-slate-500">{device.is_locked ? labels.lockDevice : labels.sharedDevice}</span>
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => openEditDevice(device)} className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50" title={labels.edit}>
                  <Icon name="edit" />
                </button>
                <button
                  type="button"
                  onClick={() => setDeleteTarget(device)}
                  disabled={!canManage || isBusy}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-red-200 text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
                  title={labels.delete}
                >
                  <Icon name="trash" />
                </button>
              </div>
            </div>
          ))}
          {!isLoading && filteredDevices.length === 0 ? <div className="p-8 text-center text-sm font-bold text-slate-500">-</div> : null}
        </div>
      </div>
      {isDeviceFormOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4" role="dialog" aria-modal="true" aria-label={form.id ? labels.edit : labels.devices}>
          <form
            onSubmit={save}
            onPointerDown={revealScrollbarBriefly}
            onScroll={revealScrollbarBriefly}
            className={`pos-settings-device-modal-scroll grid max-h-[92vh] w-full max-w-xl gap-4 overflow-y-auto rounded-lg border border-slate-200 bg-white p-5 shadow-xl ${isScrollbarVisible ? "is-scrollbar-visible" : ""}`}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-base font-black text-slate-950">
                <Icon name="terminal" />
                {form.id ? labels.edit : labels.devices}
              </div>
              <button
                type="button"
                onClick={closeDeviceForm}
                disabled={isBusy}
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 transition hover:bg-slate-50"
                aria-label={labels.cancel}
                title={labels.cancel}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
              </button>
            </div>
            <label className="grid gap-1.5 text-[13px] font-semibold text-slate-700">
              <span>{labels.branch}</span>
              <select
                value={form.branch_id}
                disabled={!canManage}
                onChange={(event) => setForm((current) => ({ ...current, branch_id: event.target.value }))}
                className="min-h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-950 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
              >
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
              </select>
            </label>
            <Field label={labels.deviceCode} value={form.device_code} disabled={!canManage} onChange={(value) => setForm((current) => ({ ...current, device_code: value.toUpperCase() }))} />
            <Field label={labels.deviceName} value={form.device_name} disabled={!canManage} onChange={(value) => setForm((current) => ({ ...current, device_name: value }))} />
            <Field label={labels.counterName} value={form.counter_name} disabled={!canManage} onChange={(value) => setForm((current) => ({ ...current, counter_name: value }))} />
            <Field label={labels.location} value={form.location} disabled={!canManage} onChange={(value) => setForm((current) => ({ ...current, location: value }))} />
            <label className="grid gap-1.5 text-[13px] font-semibold text-slate-700">
              <span>{labels.deviceType}</span>
              <select
                value={form.device_type}
                disabled={!canManage}
                onChange={(event) => setForm((current) => ({ ...current, device_type: event.target.value as DeviceForm["device_type"] }))}
                className="min-h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-950 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
              >
                <option value="pos_terminal">{labels.posTerminal}</option>
                <option value="mobile_scanner">{labels.mobileScanner}</option>
                <option value="kiosk">{labels.kiosk}</option>
              </select>
            </label>
            <label className="grid gap-1.5 text-[13px] font-semibold text-slate-700">
              <span>{labels.deviceStatus}</span>
              <select
                value={form.status}
                disabled={!canManage}
                onChange={(event) => setForm((current) => ({ ...current, status: event.target.value as DeviceForm["status"] }))}
                className="min-h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-950 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
              >
                <option value="active">{labels.active}</option>
                <option value="inactive">{labels.inactive}</option>
                <option value="maintenance">{labels.maintenance}</option>
              </select>
            </label>
            <label className="inline-flex items-center gap-2 text-sm font-bold text-slate-700">
              <input type="checkbox" checked={form.is_locked} disabled={!canManage} onChange={(event) => setForm((current) => ({ ...current, is_locked: event.target.checked }))} />
              {labels.lockDevice}
            </label>
            <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-4">
              <ActionButton variant="plain" onClick={closeDeviceForm} disabled={isBusy}>
                {labels.cancel}
              </ActionButton>
              <ActionButton type="submit" disabled={!canManage || isBusy}>
                {isMutating ? labels.saving : labels.save}
              </ActionButton>
            </div>
          </form>
          {isMutating ? (
            <div className="store-v2-popup-overlay" role="dialog" aria-modal="true" aria-live="polite">
              <div className="store-v2-popup-card">
                <div className="store-v2-popup-spinner" aria-hidden="true" />
                <p className="store-v2-popup-title">{labels.saving}</p>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
      {deleteTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4" role="alertdialog" aria-modal="true" aria-label={labels.delete}>
          <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-5 shadow-xl">
            <div className="flex items-center gap-2 text-base font-black text-slate-950">
              <Icon name="trash" />
              {labels.delete}
            </div>
            <p className="mt-3 text-sm font-semibold leading-6 text-slate-600">
              {labels.delete} {deleteTarget.device_name}?
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <ActionButton variant="plain" disabled={isBusy} onClick={() => setDeleteTarget(null)}>
                {labels.cancel}
              </ActionButton>
              <ActionButton variant="danger" disabled={isBusy} onClick={() => deleteDevice(deleteTarget)}>
                {labels.delete}
              </ActionButton>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function TaxPanel({
  labels,
  taxSettings,
  setTaxSettings,
  branches,
  activeBranchId,
  onBack,
  canManage,
  reportStatus
}: {
  labels: Labels;
  taxSettings: TaxSettings;
  setTaxSettings: (settings: TaxSettings) => void;
  branches: BranchSettings[];
  activeBranchId: string | null;
  onBack: () => void;
  canManage: boolean;
  reportStatus: StatusReporter;
}) {
  const availableBranches = canManage ? branches : branches.filter((branch) => branch.id === activeBranchId);
  const initialBranchId = availableBranches.find((branch) => branch.id === activeBranchId)?.id ?? availableBranches[0]?.id ?? "";
  const [selectedBranchId, setSelectedBranchId] = useState(initialBranchId);
  const [form, setForm] = useState<TaxSettings>(taxSettings);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingBranch, setIsLoadingBranch] = useState(false);
  const [editingTaxLineIndex, setEditingTaxLineIndex] = useState<number | null>(null);
  const previewBase = 1000;
  const selectedBranch = availableBranches.find((branch) => branch.id === selectedBranchId) ?? null;
  const editingTaxLine = editingTaxLineIndex === null ? null : form.lines[editingTaxLineIndex] ?? null;
  const activeLines = form.is_enabled ? form.lines.filter((line) => line.is_active && Number(line.rate_pct) > 0) : [];
  const previewTaxTotal = Number(
    activeLines
      .reduce((sum, line) => {
        const amount = Number((previewBase * (Number(line.rate_pct) / 100)).toFixed(2));
        return sum + (line.mode === "deduct_from_bill" ? -amount : amount);
      }, 0)
      .toFixed(2)
  );
  const previewGrandTotal = Number(Math.max(0, previewBase + previewTaxTotal).toFixed(2));

  function updateLine(index: number, patch: Partial<TaxSettings["lines"][number]>) {
    setForm((current) => ({
      ...current,
      is_enabled: patch.is_active === true ? true : current.is_enabled,
      lines: current.lines.map((line, lineIndex) => (lineIndex === index ? { ...line, ...patch } : line))
    }));
  }

  function taxModeLabel(mode: TaxLineMode) {
    return mode === "deduct_from_bill" ? labels.taxDeduct : labels.taxAdd;
  }

  useEffect(() => {
    if (!selectedBranchId) return;
    if (selectedBranchId === activeBranchId) {
      setForm(taxSettings);
      return;
    }

    const controller = new AbortController();
    setIsLoadingBranch(true);
    void (async () => {
      try {
        const data = await readApiData<{ branch_id: string; tax_settings: TaxSettings }>(
          await fetchWithTimeout(`/api/pos/settings/tax?branch_id=${encodeURIComponent(selectedBranchId)}`, {
            cache: "no-store",
            signal: controller.signal
          })
        );
        if (!controller.signal.aborted) setForm(data.tax_settings);
      } catch (error) {
        if (!controller.signal.aborted) {
          reportStatus(error instanceof Error && error.message === "__request_timeout__" ? labels.requestTimeout : error instanceof Error ? error.message : labels.failed, { popup: true });
        }
      } finally {
        if (!controller.signal.aborted) setIsLoadingBranch(false);
      }
    })();
    return () => controller.abort();
  }, [activeBranchId, labels.failed, labels.requestTimeout, reportStatus, selectedBranchId, taxSettings]);

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSaving || isLoadingBranch || !selectedBranchId) return;
    setIsSaving(true);
    void (async () => {
      try {
        const data = await readApiData<{ tax_settings: TaxSettings }>(
          await fetchWithTimeout("/api/pos/settings/tax", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...form, branch_id: selectedBranchId })
          })
        );
        if (selectedBranchId === activeBranchId) setTaxSettings(data.tax_settings);
        setForm(data.tax_settings);
        if (typeof window !== "undefined") {
          try {
            window.localStorage.setItem(POS_TAX_SETTINGS_UPDATED_KEY, new Date().toISOString());
          } catch {
            // The database save succeeded; storage is only a cross-tab refresh signal.
          }
          window.dispatchEvent(new CustomEvent(POS_TAX_SETTINGS_UPDATED_EVENT));
        }
        reportStatus(labels.saved, { popup: true });
      } catch (error) {
        reportStatus(error instanceof Error && error.message === "__request_timeout__" ? labels.requestTimeout : error instanceof Error ? error.message : labels.failed, { popup: true });
      } finally {
        setIsSaving(false);
      }
    })();
  }

  return (
    <section className="min-w-0">
      <PanelHeader title={labels.taxes} onBack={onBack} labels={labels} />
      <form onSubmit={save} className="grid min-w-0 gap-3 xl:gap-4">
        <div className="grid min-w-0 gap-3 rounded-lg border border-blue-100 bg-blue-50/60 p-4 min-[900px]:grid-cols-[minmax(0,1fr)_auto] min-[900px]:items-end">
          <label className="grid w-full min-w-0 max-w-xl gap-1.5 text-[13px] font-semibold text-slate-700">
            <span>{labels.taxBranch}</span>
            <select
              value={selectedBranchId}
              disabled={isSaving || isLoadingBranch || availableBranches.length <= 1}
              onChange={(event) => setSelectedBranchId(event.target.value)}
              className="min-h-11 rounded-lg border border-blue-200 bg-white px-3 text-sm font-bold text-slate-950 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100"
            >
              {availableBranches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name} {branch.code ? `(${branch.code})` : ""}{branch.is_active ? "" : ` - ${labels.inactive}`}
                </option>
              ))}
            </select>
            <span className="text-xs font-medium text-slate-500">{labels.taxBranchHint}</span>
          </label>
          <div className={`rounded-lg border px-3 py-2 text-sm font-bold ${form.is_enabled ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-white text-slate-600"}`}>
            {isLoadingBranch ? labels.taxBranchLoading : form.is_enabled ? labels.taxEnabled : labels.taxBranchDisabled}
          </div>
        </div>

        <div className="min-w-0 rounded-lg border border-slate-200 bg-white p-4 shadow-sm xl:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-4">
            <div>
              <div className="flex items-center gap-2 text-base font-black text-slate-950">
                <Icon name="tax" />
                {labels.taxes}
              </div>
              <p className="mt-1 text-sm font-semibold text-slate-500">{labels.taxNetBase}</p>
            </div>
            <label className="inline-flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold text-slate-800">
              <input
                type="checkbox"
                checked={form.is_enabled}
                disabled={!canManage || isSaving || isLoadingBranch}
                onChange={(event) => setForm((current) => ({ ...current, is_enabled: event.target.checked }))}
              />
              {form.is_enabled ? labels.taxEnabled : labels.taxDisabled}
            </label>
          </div>

          <div className="mt-4 grid min-w-0 gap-3 min-[720px]:grid-cols-2">
            {form.lines.map((line, index) => (
              <button
                key={line.id}
                type="button"
                disabled={!canManage || isSaving || isLoadingBranch}
                onClick={() => setEditingTaxLineIndex(index)}
                className="group grid min-h-28 min-w-0 gap-3 rounded-lg border border-slate-200 bg-slate-50/70 p-4 text-left transition hover:border-blue-300 hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:opacity-70"
              >
                <span className="flex min-w-0 items-start justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block truncate text-base font-black text-slate-950">{line.label || labels.taxLine}</span>
                    <span className="mt-1 block text-xs font-bold text-slate-500">{taxModeLabel(line.mode)}</span>
                  </span>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-black ${line.is_active ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200" : "bg-white text-slate-500 ring-1 ring-slate-200"}`}>
                    {line.is_active ? labels.active : labels.inactive}
                  </span>
                </span>
                <span className="flex items-end justify-between gap-3">
                  <span className="text-3xl font-black text-blue-700">{Number(line.rate_pct || 0).toLocaleString()}%</span>
                  <span className="rounded-lg bg-white px-3 py-2 text-sm font-black text-slate-700 ring-1 ring-slate-200 transition group-hover:text-blue-700">
                    {labels.edit}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="grid min-w-0 gap-3 min-[900px]:grid-cols-[minmax(0,1fr)_minmax(240px,320px)]">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm font-semibold leading-6 text-slate-600">
            <p className="font-black text-slate-900">{labels.taxPreview}</p>
            <p>{labels.taxNetBase}</p>
          </div>
          <div className="rounded-lg border border-blue-100 bg-blue-50 p-4">
            <div className="grid gap-2 text-sm font-bold text-slate-700">
              <p className="flex justify-between"><span>Base</span><strong>฿{previewBase.toFixed(2)}</strong></p>
              {activeLines.map((line) => {
                const amount = Number((previewBase * (Number(line.rate_pct) / 100)).toFixed(2));
                const signedAmount = line.mode === "deduct_from_bill" ? -amount : amount;
                return <p key={line.id} className="flex justify-between"><span>{line.label}</span><strong>{signedAmount < 0 ? "-" : "+"}฿{Math.abs(signedAmount).toFixed(2)}</strong></p>;
              })}
              <p className="mt-2 flex justify-between border-t border-blue-200 pt-2 text-base text-blue-900"><span>{labels.taxGrandTotal}</span><strong>฿{previewGrandTotal.toFixed(2)}</strong></p>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <ActionButton variant="plain" onClick={() => setForm(taxSettings)} disabled={isSaving}>
            {labels.cancel}
          </ActionButton>
          <ActionButton type="submit" disabled={!canManage || isSaving || isLoadingBranch || !selectedBranch}>
            {isSaving ? labels.saving : isLoadingBranch ? labels.taxBranchLoading : labels.save}
          </ActionButton>
        </div>
        {isSaving ? (
          <div className="store-v2-popup-overlay" role="dialog" aria-modal="true" aria-live="polite">
            <div className="store-v2-popup-card">
              <div className="store-v2-popup-spinner" aria-hidden="true" />
              <p className="store-v2-popup-title">{labels.saving}</p>
            </div>
          </div>
        ) : null}
        {editingTaxLine !== null && editingTaxLineIndex !== null ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-3 backdrop-blur-sm" role="dialog" aria-modal="true">
            <div className="grid max-h-[calc(100dvh-24px)] w-full max-w-xl overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl">
              <div className="flex items-start justify-between gap-3 border-b border-slate-100 p-4">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-base font-black text-slate-950">
                    <Icon name="tax" />
                    {editingTaxLine.label || labels.taxLine}
                  </p>
                  <p className="mt-1 text-sm font-semibold text-slate-500">{labels.taxNetBase}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setEditingTaxLineIndex(null)}
                  className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-xl font-black text-slate-600 hover:bg-slate-50"
                  aria-label={labels.cancel}
                >
                  ×
                </button>
              </div>
              <div className="grid gap-4 overflow-auto p-4">
                <Field label={labels.taxLine} value={editingTaxLine.label} disabled={!canManage || isSaving || isLoadingBranch} onChange={(value) => updateLine(editingTaxLineIndex, { label: value })} />
                <div className="grid gap-3 min-[560px]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                  <Field label={labels.taxRate} value={String(editingTaxLine.rate_pct)} type="number" disabled={!canManage || isSaving || isLoadingBranch} onChange={(value) => updateLine(editingTaxLineIndex, { rate_pct: Number(value) })} />
                  <label className="grid gap-1.5 text-[13px] font-semibold text-slate-700">
                    <span>{labels.taxMode}</span>
                    <select
                      value={editingTaxLine.mode}
                      disabled={!canManage || isSaving || isLoadingBranch}
                      onChange={(event) => updateLine(editingTaxLineIndex, { mode: event.target.value as TaxLineMode })}
                      className="min-h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-950 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                    >
                      <option value="add_to_bill">{labels.taxAdd}</option>
                      <option value="deduct_from_bill">{labels.taxDeduct}</option>
                    </select>
                  </label>
                </div>
                <label className="inline-flex min-h-11 items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm font-bold text-slate-700">
                  <input type="checkbox" checked={editingTaxLine.is_active} disabled={!canManage || isSaving || isLoadingBranch} onChange={(event) => updateLine(editingTaxLineIndex, { is_active: event.target.checked })} />
                  {editingTaxLine.is_active ? labels.active : labels.inactive}
                </label>
              </div>
              <div className="flex justify-end gap-2 border-t border-slate-100 bg-slate-50 p-3">
                <ActionButton variant="plain" onClick={() => setEditingTaxLineIndex(null)}>
                  {labels.cancel}
                </ActionButton>
                <ActionButton onClick={() => setEditingTaxLineIndex(null)} disabled={!canManage || isSaving || isLoadingBranch}>
                  {labels.confirm}
                </ActionButton>
              </div>
            </div>
          </div>
        ) : null}
      </form>
    </section>
  );
}

function NotificationPanel({
  labels,
  lang,
  settings,
  setSettings,
  branches,
  activeBranchId,
  onBack,
  canManage,
  reportStatus
}: {
  labels: Labels;
  lang: Language;
  settings: PosNotificationSettings;
  setSettings: (settings: PosNotificationSettings) => void;
  branches: BranchSettings[];
  activeBranchId: string | null;
  onBack: () => void;
  canManage: boolean;
  reportStatus: StatusReporter;
}) {
  const text =
    lang === "en"
      ? {
          title: "Notification Settings",
          desc: "Configure table QR customer call alerts on the POS sales screen.",
          branch: "Notification branch",
          branchHint: "Popup and sound settings are stored separately for each branch.",
          popup: "Show popup on sales screen",
          sound: "Play alert sound",
          volume: "Sound volume",
          saved: "Notification settings saved.",
          loading: "Loading notification settings..."
        }
      : {
          title: "ตั้งค่าการแจ้งเตือน",
          desc: "กำหนด POP UP และเสียงแจ้งเตือนเมื่อลูกค้ากดเรียกจาก QR โต๊ะ",
          branch: "สาขาที่ตั้งค่าการแจ้งเตือน",
          branchHint: "การแจ้งเตือนและเสียงจะแยกการตั้งค่าตามสาขา",
          popup: "แสดง POP UP บนหน้าขาย",
          sound: "เปิดเสียงแจ้งเตือน",
          volume: "ระดับเสียง",
          saved: "บันทึกการตั้งค่าการแจ้งเตือนแล้ว",
          loading: "กำลังโหลดการแจ้งเตือนของสาขา..."
        };
  const availableBranches = canManage ? branches : branches.filter((branch) => branch.id === activeBranchId);
  const initialBranchId = availableBranches.find((branch) => branch.id === activeBranchId)?.id ?? availableBranches[0]?.id ?? "";
  const [selectedBranchId, setSelectedBranchId] = useState(initialBranchId);
  const [form, setForm] = useState<PosNotificationSettings>(settings);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingBranch, setIsLoadingBranch] = useState(false);

  useEffect(() => {
    if (!selectedBranchId) return;
    if (selectedBranchId === activeBranchId) {
      setForm(settings);
      return;
    }

    const controller = new AbortController();
    setIsLoadingBranch(true);
    void (async () => {
      try {
        const data = await readApiData<{ branch_id: string; notification_settings: PosNotificationSettings }>(
          await fetchWithTimeout(`/api/pos/settings/notifications?branch_id=${encodeURIComponent(selectedBranchId)}`, {
            cache: "no-store",
            signal: controller.signal
          })
        );
        if (!controller.signal.aborted) setForm(data.notification_settings);
      } catch (error) {
        if (!controller.signal.aborted) {
          reportStatus(error instanceof Error && error.message === "__request_timeout__" ? labels.requestTimeout : error instanceof Error ? error.message : labels.failed, { popup: true });
        }
      } finally {
        if (!controller.signal.aborted) setIsLoadingBranch(false);
      }
    })();
    return () => controller.abort();
  }, [activeBranchId, labels.failed, labels.requestTimeout, reportStatus, selectedBranchId, settings]);

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSaving || isLoadingBranch || !selectedBranchId) return;
    setIsSaving(true);
    void (async () => {
      try {
        const data = await readApiData<{ notification_settings: PosNotificationSettings }>(
          await fetchWithTimeout("/api/pos/settings/notifications", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...form, branch_id: selectedBranchId })
          })
        );
        if (selectedBranchId === activeBranchId) setSettings(data.notification_settings);
        setForm(data.notification_settings);
        reportStatus(text.saved, { popup: true });
      } catch (error) {
        reportStatus(error instanceof Error && error.message === "__request_timeout__" ? labels.requestTimeout : error instanceof Error ? error.message : labels.failed, { popup: true });
      } finally {
        setIsSaving(false);
      }
    })();
  }

  return (
    <section>
      <PanelHeader title={text.title} onBack={onBack} labels={labels} />
      <form onSubmit={save} className="grid gap-4">
        <div className="flex flex-col gap-3 rounded-lg border border-blue-100 bg-blue-50/60 p-4 md:flex-row md:items-end md:justify-between">
          <label className="grid w-full max-w-md gap-1.5 text-[13px] font-semibold text-slate-700">
            <span>{text.branch}</span>
            <select
              value={selectedBranchId}
              disabled={isSaving || isLoadingBranch || availableBranches.length <= 1}
              onChange={(event) => setSelectedBranchId(event.target.value)}
              className="min-h-11 rounded-lg border border-blue-200 bg-white px-3 text-sm font-bold text-slate-950 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100"
            >
              {availableBranches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name} {branch.code ? `(${branch.code})` : ""}{branch.is_active ? "" : ` - ${labels.inactive}`}
                </option>
              ))}
            </select>
            <span className="text-xs font-medium text-slate-500">{text.branchHint}</span>
          </label>
          <div className="rounded-lg border border-orange-100 bg-orange-50 px-3 py-2 text-sm font-bold text-orange-700">
            {isLoadingBranch ? text.loading : text.desc}
          </div>
        </div>

        <div className="grid gap-3 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <label className="flex items-center justify-between gap-4 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm font-bold text-slate-800">
            <span>{text.popup}</span>
            <input
              type="checkbox"
              checked={form.table_qr_popup_enabled}
              disabled={!canManage || isSaving || isLoadingBranch}
              onChange={(event) => setForm((current) => ({ ...current, table_qr_popup_enabled: event.target.checked }))}
            />
          </label>
          <label className="flex items-center justify-between gap-4 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm font-bold text-slate-800">
            <span>{text.sound}</span>
            <input
              type="checkbox"
              checked={form.table_qr_sound_enabled}
              disabled={!canManage || isSaving || isLoadingBranch}
              onChange={(event) => setForm((current) => ({ ...current, table_qr_sound_enabled: event.target.checked }))}
            />
          </label>
          <label className="grid gap-2 rounded-lg border border-slate-200 bg-white p-4 text-sm font-bold text-slate-800">
            <span>{text.volume}: {Math.round(form.table_qr_sound_volume * 100)}%</span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={form.table_qr_sound_volume}
              disabled={!canManage || isSaving || isLoadingBranch || !form.table_qr_sound_enabled}
              onChange={(event) => setForm((current) => ({ ...current, table_qr_sound_volume: Number(event.target.value) }))}
            />
          </label>
        </div>

        <div className="flex justify-end gap-2">
          <ActionButton variant="plain" onClick={() => setForm(settings)} disabled={isSaving}>
            {labels.cancel}
          </ActionButton>
          <ActionButton type="submit" disabled={!canManage || isSaving || isLoadingBranch || !selectedBranchId}>
            {isSaving ? labels.saving : isLoadingBranch ? text.loading : labels.save}
          </ActionButton>
        </div>
      </form>
    </section>
  );
}

function ActivityAuditPanel({
  labels,
  lang,
  branches,
  onBack,
  reportStatus
}: {
  labels: Labels;
  lang: Language;
  branches: BranchSettings[];
  onBack: () => void;
  reportStatus: (message: string) => void;
}) {
  const today = todayInputValue();
  const [pin, setPin] = useState("");
  const [period, setPeriod] = useState<ActivityAuditPeriod>("day");
  const [dateValue, setDateValue] = useState(today);
  const [branchId, setBranchId] = useState("all");
  const [moduleFilter, setModuleFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ActivityAuditResponse | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [isCheckingSystem, setIsCheckingSystem] = useState(false);

  const items = data?.items ?? [];
  const deleteCount = items.filter((item) => item.is_delete_action).length;
  const pinCount = items.filter((item) => item.is_pin_action).length;
  const viewCount = items.filter((item) => item.action.includes("view")).length;
  const pageCount = data?.pagination.total_pages ?? 0;

  function loadAudit(nextPage = 1, closeFilter = false) {
    if (isBusy) return;
    setIsBusy(true);
    setIsCheckingSystem(true);
    void (async () => {
      try {
        const result = await readApiData<ActivityAuditResponse>(
          await fetch("/api/pos/settings/activity-audit", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              manager_pin: pin,
              period,
              date: normalizeDateValue(period, dateValue),
              branch_id: branchId,
              module: moduleFilter,
              search,
              page: nextPage,
              page_size: 7
            })
          })
        );
        setData(result);
        setPage(result.pagination.page);
        if (closeFilter) setIsFilterOpen(false);
        reportStatus(labels.saved);
      } catch (error) {
        reportStatus(error instanceof Error ? error.message : labels.failed);
      } finally {
        setIsBusy(false);
        setIsCheckingSystem(false);
      }
    })();
  }

  function submitFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    loadAudit(1, true);
  }

  function changePeriod(nextPeriod: ActivityAuditPeriod) {
    setPeriod(nextPeriod);
    setDateValue(normalizeDateValue(nextPeriod, ""));
    setPage(1);
  }

  return (
    <section>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 transition hover:bg-slate-50"
            title={labels.back}
            aria-label={labels.back}
          >
            <Icon name="back" />
          </button>
          <h2 className="text-xl font-black text-slate-950">{labels.activityAudit}</h2>
        </div>
        <ActionButton onClick={() => setIsFilterOpen(true)}>
          <Icon name="activity" />
          {labels.filter}
        </ActionButton>
      </div>

      {isFilterOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4" role="dialog" aria-modal="true" aria-label={labels.filter}>
          <div className="w-full max-w-5xl overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
              <div className="flex items-center gap-2 text-base font-black text-slate-950">
                <Icon name="activity" />
                {labels.filter}
              </div>
              <button
                type="button"
                onClick={() => setIsFilterOpen(false)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 transition hover:bg-slate-50"
                aria-label={labels.cancel}
                title={labels.cancel}
              >
                ×
              </button>
            </div>
            <form onSubmit={submitFilters} className="grid gap-3 p-4">
        <div className="grid gap-3 lg:grid-cols-[220px_170px_180px_1fr]">
          <label className="grid gap-1.5 text-[13px] font-semibold text-slate-700">
            <span>{labels.pinCode}</span>
            <input
              type="password"
              inputMode="numeric"
              value={pin}
              onChange={(event) => setPin(event.target.value)}
              placeholder={labels.pinConfirmTitle}
              className="min-h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-950 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            />
          </label>
          <label className="grid gap-1.5 text-[13px] font-semibold text-slate-700">
            <span>{labels.period}</span>
            <select
              value={period}
              onChange={(event) => changePeriod(event.target.value as ActivityAuditPeriod)}
              className="min-h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-950 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            >
              <option value="day">{labels.daily}</option>
              <option value="month">{labels.monthly}</option>
              <option value="year">{labels.yearly}</option>
            </select>
          </label>
          <label className="grid gap-1.5 text-[13px] font-semibold text-slate-700">
            <span>{period === "year" ? labels.year : period === "month" ? labels.month : labels.date}</span>
            <input
              type={periodInputType(period)}
              min={period === "year" ? "2024" : undefined}
              max={period === "year" ? "2099" : undefined}
              value={dateValue}
              onChange={(event) => setDateValue(event.target.value)}
              className="min-h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-950 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            />
          </label>
          <label className="grid gap-1.5 text-[13px] font-semibold text-slate-700">
            <span>{labels.search}</span>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="min-h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-950 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            />
          </label>
        </div>
        <div className="grid gap-3 lg:grid-cols-[1fr_1fr_140px]">
          <label className="grid gap-1.5 text-[13px] font-semibold text-slate-700">
            <span>{labels.branch}</span>
            <select
              value={branchId}
              onChange={(event) => setBranchId(event.target.value)}
              className="min-h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-950 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            >
              <option value="all">{labels.allBranches}</option>
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1.5 text-[13px] font-semibold text-slate-700">
            <span>{labels.module}</span>
            <select
              value={moduleFilter}
              onChange={(event) => setModuleFilter(event.target.value)}
              className="min-h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-950 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            >
              <option value="all">{labels.allMenus}</option>
              <option value="pos_sales">หน้าขาย</option>
              <option value="stock">จัดการสินค้า</option>
              <option value="shift">เปิด/ปิดกะ</option>
              <option value="staff">ผู้ใช้งาน</option>
              <option value="settings_activity_audit">{labels.activityAudit}</option>
              <option value="it_admin">ระบบหลังบ้าน IT</option>
            </select>
          </label>
          <ActionButton type="submit" disabled={isBusy || pin.length < 4}>
            <Icon name="activity" />
            {labels.confirm}
          </ActionButton>
        </div>
            </form>
          </div>
        </div>
      ) : null}

      {isCheckingSystem ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/45 p-4" role="alertdialog" aria-modal="true" aria-label={labels.checkingSystem}>
          <div className="flex min-h-36 w-full max-w-sm flex-col items-center justify-center gap-4 rounded-lg border border-slate-200 bg-white p-6 text-center shadow-xl">
            <span className="h-10 w-10 animate-spin rounded-full border-4 border-blue-100 border-t-blue-600" />
            <p className="text-lg font-black text-slate-950">{labels.checkingSystem}</p>
          </div>
        </div>
      ) : null}

      <div className="mb-4 grid gap-3 md:grid-cols-4">
        {[
          [labels.totalRecords, String(data?.pagination.total ?? 0)],
          [labels.deleteRecords, String(deleteCount)],
          [labels.pinRecords, String(pinCount)],
          [labels.viewRecords, String(viewCount)]
        ].map(([title, value]) => (
          <div key={title} className="rounded-lg border border-slate-200 bg-white p-4">
            <p className="text-xs font-bold text-slate-500">{title}</p>
            <p className="mt-2 text-2xl font-black text-slate-950">{value}</p>
          </div>
        ))}
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <div className="grid min-w-[1080px] grid-cols-[150px_140px_1.1fr_150px_1fr_1fr_120px] gap-3 border-b border-slate-100 bg-slate-50 px-4 py-3 text-xs font-black text-slate-500">
          <span>{labels.viewedAt}</span>
          <span>{labels.module}</span>
          <span>{labels.actor}</span>
          <span>{labels.deviceCode}</span>
          <span>{labels.action}</span>
          <span>{labels.approver}</span>
          <span>{labels.branch}</span>
        </div>
        {items.map((item) => (
          <div key={item.id} className="grid min-w-[1080px] grid-cols-[150px_140px_1.1fr_150px_1fr_1fr_120px] items-center gap-3 border-b border-slate-100 px-4 py-3 text-sm last:border-b-0">
            <span className="text-xs font-bold text-slate-600">{formatAuditDate(item.created_at)}</span>
            <span className="min-w-0 truncate font-black text-slate-800">{auditMenuLabel(item, lang)}</span>
            <span className="min-w-0">
              <span className="block truncate font-black text-slate-950">{item.actor_name}</span>
              <span className="block truncate text-xs font-semibold text-slate-500">
                {item.actor_employee_code || item.actor_role || "-"}
              </span>
            </span>
            <span className="min-w-0">
              <span className="block truncate font-bold text-slate-800">{item.device_name || item.device_code || "-"}</span>
              {item.device_name && item.device_code ? <span className="block truncate text-xs font-semibold text-slate-500">{item.device_code}</span> : null}
            </span>
            <span className="min-w-0">
              <span
                className={`inline-flex max-w-full items-center rounded-full px-2.5 py-1 text-xs font-bold ${
                  item.is_delete_action ? "bg-red-50 text-red-700 ring-1 ring-red-200" : item.is_pin_action ? "bg-amber-50 text-amber-700 ring-1 ring-amber-200" : "bg-slate-100 text-slate-700 ring-1 ring-slate-200"
                }`}
              >
                <span className="truncate">{auditActionLabel(item, lang)}</span>
              </span>
              <span className="mt-1 block truncate text-xs font-semibold text-slate-500">{auditMenuLabel(item, lang)}</span>
            </span>
            <span className="min-w-0">
              <span className="block truncate font-bold text-slate-800">{item.approver_name}</span>
              <span className="block truncate text-xs font-semibold text-slate-500">{item.approver_role || "-"}</span>
            </span>
            <span className="truncate text-xs font-bold text-slate-600">{item.branch_name}</span>
          </div>
        ))}
        {items.length === 0 ? <div className="p-8 text-center text-sm font-bold text-slate-500">{data ? labels.noRecords : labels.pinConfirmTitle}</div> : null}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-bold text-slate-500">
          {labels.totalRecords}: {data?.pagination.total ?? 0}
        </p>
        <div className="flex gap-2">
          <ActionButton variant="plain" disabled={isBusy || page <= 1} onClick={() => loadAudit(page - 1)}>
            {labels.previous}
          </ActionButton>
          <span className="inline-flex min-h-10 items-center rounded-lg border border-slate-200 bg-white px-3 text-sm font-black text-slate-700">
            {page}/{Math.max(1, pageCount || 1)}
          </span>
          <ActionButton variant="plain" disabled={isBusy || pageCount === 0 || page >= pageCount} onClick={() => loadAudit(page + 1)}>
            {labels.next}
          </ActionButton>
        </div>
      </div>
    </section>
  );
}

function PaymentPanel({
  labels,
  lang,
  accounts,
  setAccounts,
  branches,
  onBack,
  canManage,
  activeBranchId,
  reportStatus
}: {
  labels: Labels;
  lang: Language;
  accounts: PaymentAccountSettings[];
  setAccounts: (accounts: PaymentAccountSettings[] | ((current: PaymentAccountSettings[]) => PaymentAccountSettings[])) => void;
  branches: BranchSettings[];
  onBack: () => void;
  canManage: boolean;
  activeBranchId: string | null;
  reportStatus: StatusReporter;
}) {
  const initialPaymentForm = { ...emptyPaymentForm, branch_id: activeBranchId ?? branches[0]?.id ?? "" };
  const fallbackBranchId = activeBranchId ?? branches[0]?.id ?? "";
  const previewStorageKey = useMemo(() => `pos-preview-payment-accounts:${fallbackBranchId || "default"}`, [fallbackBranchId]);
  const [form, setForm] = useState<PaymentForm>(initialPaymentForm);
  const [isPaymentFormOpen, setIsPaymentFormOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<PaymentAccountSettings | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [isLoadingAccounts, setIsLoadingAccounts] = useState(false);
  const [isQrBusy, setIsQrBusy] = useState(false);
  const loadingAccountsRef = useRef(false);
  const branchById = useMemo(() => new Map(branches.map((branch) => [branch.id, branch])), [branches]);
  const sortedAccounts = useMemo(
    () =>
      [...accounts].sort((left, right) => {
        const leftBranch = branchById.get(left.branch_id)?.name ?? left.branch_id;
        const rightBranch = branchById.get(right.branch_id)?.name ?? right.branch_id;
        return `${leftBranch} ${left.bank_name}`.localeCompare(`${rightBranch} ${right.bank_name}`, "th");
      }),
    [accounts, branchById]
  );
  const promptpayPayload = buildPromptPayPayload(form.promptpay_phone);
  const promptpayPreviewUrl = promptpayPayload ? promptpayPayload.replace("{amount}", "100") : "";

  const updateAccounts = useCallback(
    (updater: (current: PaymentAccountSettings[]) => PaymentAccountSettings[]) => {
      setAccounts((current) => {
        const next = updater(current);
        writePreviewPaymentAccounts(previewStorageKey, next);
        return next;
      });
    },
    [previewStorageKey, setAccounts]
  );

  const loadAccounts = useCallback(
    (options?: { silent?: boolean }) => {
      if (loadingAccountsRef.current) return;
      loadingAccountsRef.current = true;
      setIsLoadingAccounts(true);
      void (async () => {
        try {
          const data = await readApiData<{
            payment_accounts: PaymentAccountSettings[];
            metadata: { payment_accounts_ready: boolean };
          }>(await fetchWithTimeout("/api/pos/settings/payment-accounts", { cache: "no-store" }, 8000));
          const nextAccounts = data.payment_accounts ?? [];
          if (data.metadata.payment_accounts_ready || nextAccounts.length > 0) {
            setAccounts(nextAccounts);
            writePreviewPaymentAccounts(previewStorageKey, nextAccounts);
          }
        } catch (error) {
          const message = error instanceof Error && error.message === "__request_timeout__" ? labels.requestTimeout : error instanceof Error ? error.message : labels.failed;
          if (!isRecoverablePaymentAccountError(message) && !options?.silent) {
            reportStatus(message, { popup: true });
          }
        } finally {
          loadingAccountsRef.current = false;
          setIsLoadingAccounts(false);
        }
      })();
    },
    [labels.failed, labels.requestTimeout, previewStorageKey, reportStatus, setAccounts]
  );

  useEffect(() => {
    const storedAccounts = readPreviewPaymentAccounts(previewStorageKey);
    if (storedAccounts.length > 0) setAccounts(storedAccounts);
  }, [previewStorageKey, setAccounts]);

  useEffect(() => {
    loadAccounts({ silent: true });
  }, [loadAccounts]);

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isBusy) return;
    const method = form.id ? "PATCH" : "POST";
    const startedAt = Date.now();
    setIsBusy(true);
    void (async () => {
      try {
        const data = await readApiData<{ account: PaymentAccountSettings }>(
          await fetchWithTimeout("/api/pos/settings/payment-accounts", {
            method,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(form)
          }, 8000)
        );
        updateAccounts((current) => mergePaymentAccountUpdate(current, data.account));
        signalPaymentSettingsUpdated();
        await keepPopupVisible(startedAt);
        setForm(initialPaymentForm);
        setIsPaymentFormOpen(false);
        reportStatus(labels.saved, { popup: true });
      } catch (error) {
        const isTimeout = error instanceof Error && error.message === "__request_timeout__";
        const message = isTimeout ? labels.requestTimeout : error instanceof Error ? error.message : labels.failed;
        if (isTimeout || isRecoverablePaymentAccountError(message)) {
          const fallbackAccount = makePreviewPaymentAccount(form, fallbackBranchId);
          updateAccounts((current) => mergePaymentAccountUpdate(current, fallbackAccount));
          signalPaymentSettingsUpdated();
          await keepPopupVisible(startedAt);
          setForm(initialPaymentForm);
          setIsPaymentFormOpen(false);
          reportStatus(labels.saved, { popup: true });
        } else {
          await keepPopupVisible(startedAt);
          reportStatus(message, { popup: true });
        }
      } finally {
        setIsBusy(false);
      }
    })();
  }

  async function deleteAccount(account: PaymentAccountSettings, managerPin: string) {
    if (isBusy) return;
    setIsBusy(true);
    try {
      await readApiData<{ id: string; deleted: boolean }>(
        await fetchWithTimeout(`/api/pos/settings/payment-accounts?account_id=${encodeURIComponent(account.id)}`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ manager_pin: managerPin })
        }, 8000)
      );
      updateAccounts((current) => current.filter((item) => item.id !== account.id));
      signalPaymentSettingsUpdated();
      setDeleteTarget(null);
      reportStatus(labels.saved, { popup: true });
    } catch (error) {
      const isTimeout = error instanceof Error && error.message === "__request_timeout__";
      const message = isTimeout ? labels.requestTimeout : error instanceof Error ? error.message : labels.failed;
      if (isTimeout || isRecoverablePaymentAccountError(message)) {
        updateAccounts((current) => current.filter((item) => item.id !== account.id));
        signalPaymentSettingsUpdated();
        setDeleteTarget(null);
        reportStatus(labels.saved, { popup: true });
      } else {
        reportStatus(message, { popup: true });
        throw error;
      }
    } finally {
      setIsBusy(false);
    }
  }

  function toggleAccount(account: PaymentAccountSettings) {
    if (isBusy) return;
    const next = { ...paymentToForm(account), is_active: !account.is_active };
    setIsBusy(true);
    void (async () => {
      try {
        const data = await readApiData<{ account: PaymentAccountSettings }>(
          await fetchWithTimeout("/api/pos/settings/payment-accounts", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(next)
          }, 8000)
        );
        updateAccounts((current) => mergePaymentAccountUpdate(current, data.account));
        signalPaymentSettingsUpdated();
      } catch (error) {
        const isTimeout = error instanceof Error && error.message === "__request_timeout__";
        const message = isTimeout ? labels.requestTimeout : error instanceof Error ? error.message : labels.failed;
        if (isTimeout || isRecoverablePaymentAccountError(message)) {
          updateAccounts((current) => mergePaymentAccountUpdate(current, makePreviewPaymentAccount(next, fallbackBranchId)));
          signalPaymentSettingsUpdated();
          reportStatus(labels.saved, { popup: true });
        } else {
          reportStatus(message, { popup: true });
        }
      } finally {
        setIsBusy(false);
      }
    })();
  }

  function uploadQr(file: File | undefined) {
    if (!file) return;
    setIsQrBusy(true);
    void (async () => {
      try {
        const qrImageUrl = await resizeQrFile(file);
        setForm((current) => ({ ...current, qr_image_url: qrImageUrl }));
      } catch (error) {
        reportStatus(error instanceof Error ? error.message : labels.failed, { popup: true });
      } finally {
        setIsQrBusy(false);
      }
    })();
  }

  function openCreatePayment() {
    setForm(initialPaymentForm);
    setIsPaymentFormOpen(true);
  }

  function openEditPayment(account: PaymentAccountSettings) {
    setForm(paymentToForm(account));
    setIsPaymentFormOpen(true);
  }

  function closePaymentForm() {
    if (isBusy || isQrBusy) return;
    setForm(initialPaymentForm);
    setIsPaymentFormOpen(false);
  }

  return (
    <section>
      <PanelHeader title={labels.payments} onBack={onBack} labels={labels} />
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4">
          <div>
            <p className="text-sm font-black text-slate-950">{labels.payments}</p>
            <p className="mt-1 text-xs font-semibold text-slate-500">{sortedAccounts.length} {labels.totalRecords}</p>
          </div>
          <ActionButton onClick={openCreatePayment} disabled={!canManage || isBusy}>
            <Icon name="plus" />
            {labels.addPaymentAccount}
          </ActionButton>
        </div>
        <div className="overflow-x-auto">
          <div className="min-w-[1260px]">
            <div className="grid grid-cols-[1.15fr_1fr_1fr_1fr_1fr_140px_120px] gap-3 border-b border-slate-100 bg-slate-50 px-4 py-3 text-xs font-black text-slate-500">
              <span>{labels.bankName}</span>
              <span>{labels.accountName}</span>
              <span>{labels.accountNo}</span>
              <span>{labels.promptpay}</span>
              <span>{labels.branch}</span>
              <span>{labels.active}</span>
              <span className="text-right">{labels.action}</span>
            </div>
          {sortedAccounts.map((account) => (
            <div key={account.id} className="grid grid-cols-[1.15fr_1fr_1fr_1fr_1fr_140px_120px] items-center gap-3 border-b border-slate-100 px-4 py-3 last:border-b-0">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-base font-black text-slate-950">{account.bank_name}</p>
                  <StatusPill active={account.is_active} labels={labels} />
                </div>
                <p className="hidden text-xs font-medium text-slate-500">
                  {account.account_number || "-"} · {branchById.get(account.branch_id)?.name ?? account.branch_id}
                </p>
                {account.promptpay_payload ? <p className="mt-2 hidden break-all text-xs font-semibold text-blue-700">{account.promptpay_payload}</p> : null}
              </div>
              <p className="min-w-0 truncate text-sm font-bold text-slate-700">{account.account_name || "-"}</p>
              <p className="min-w-0 truncate text-sm font-semibold text-slate-600">{account.account_number || "-"}</p>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-700">{account.promptpay_phone || "-"}</p>
                <p className="mt-1 truncate text-xs font-semibold text-blue-700">{account.qr_mode === "qr_image" ? labels.qrModeImage : labels.qrModePromptPay}</p>
              </div>
              <p className="min-w-0 truncate text-sm font-semibold text-slate-700">{account.applies_to_all_branches ? labels.allBranches : branchById.get(account.branch_id)?.name ?? account.branch_id}</p>
              <button
                type="button"
                onClick={() => toggleAccount(account)}
                disabled={!canManage || isBusy}
                className="inline-flex min-h-10 items-center justify-center rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-800 hover:bg-slate-50 disabled:opacity-50"
              >
                {account.is_active ? labels.inactive : labels.active}
              </button>
              <div className="flex gap-2 md:justify-end">
                <button type="button" onClick={() => openEditPayment(account)} className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50" title={labels.edit}>
                  <Icon name="edit" />
                </button>
                <button
                  type="button"
                  onClick={() => setDeleteTarget(account)}
                  disabled={!canManage || isBusy}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-40"
                  title={labels.delete}
                >
                  <Icon name="trash" />
                </button>
              </div>
            </div>
          ))}
          {sortedAccounts.length === 0 ? <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm font-bold text-slate-500">{isLoadingAccounts ? "..." : "-"}</div> : null}
          </div>
        </div>
        {isPaymentFormOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4" role="dialog" aria-modal="true" aria-label={form.id ? labels.edit : labels.addPaymentAccount}>
        <form onSubmit={save} className="grid max-h-[92vh] w-full max-w-xl gap-4 overflow-y-auto rounded-lg border border-slate-200 bg-white p-5 shadow-xl">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-base font-black text-slate-950">
              <Icon name="payment" />
              {form.id ? labels.edit : labels.addPaymentAccount}
            </div>
            <button
              type="button"
              onClick={closePaymentForm}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 transition hover:bg-slate-50"
              aria-label={labels.cancel}
              title={labels.cancel}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M18 6 6 18" />
                <path d="m6 6 12 12" />
              </svg>
            </button>
          </div>
          <label className="grid gap-1.5 text-[13px] font-semibold text-slate-700">
            <span>{labels.branch}</span>
            <select
              value={form.branch_id}
              disabled={!canManage || isBusy}
              onChange={(event) => setForm((current) => ({ ...current, branch_id: event.target.value }))}
              className="min-h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-950 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            >
              {branches.filter((branch) => branch.is_active).map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </select>
          </label>
          <label className="inline-flex items-center gap-2 text-sm font-bold text-slate-700">
            <input
              type="checkbox"
              checked={form.applies_to_all_branches}
              disabled={!canManage || isBusy}
              onChange={(event) => setForm((current) => ({ ...current, applies_to_all_branches: event.target.checked }))}
            />
            {labels.allBranches}
          </label>
          <Field label={labels.bankName} value={form.bank_name} disabled={!canManage || isBusy} onChange={(value) => setForm((current) => ({ ...current, bank_name: value }))} />
          <Field label={labels.accountName} value={form.account_name} disabled={!canManage || isBusy} onChange={(value) => setForm((current) => ({ ...current, account_name: value }))} />
          <Field label={labels.accountNo} value={form.account_number} disabled={!canManage || isBusy} onChange={(value) => setForm((current) => ({ ...current, account_number: value }))} />
          <div className="grid gap-2">
            <span className="text-[13px] font-semibold text-slate-700">{labels.qrMode}</span>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className={`rounded-lg border p-3 text-sm font-bold ${form.qr_mode === "promptpay_link" ? "border-blue-300 bg-blue-50 text-blue-900" : "border-slate-200 bg-white text-slate-700"}`}>
                <input
                  type="checkbox"
                  className="mr-2"
                  checked={form.qr_mode === "promptpay_link"}
                  disabled={!canManage || isBusy}
                  onChange={() => setForm((current) => ({ ...current, qr_mode: "promptpay_link" }))}
                />
                {labels.qrModePromptPay}
                <span className="mt-1 block text-xs font-semibold text-slate-500">{labels.qrModePromptPayHint}</span>
              </label>
              <label className={`rounded-lg border p-3 text-sm font-bold ${form.qr_mode === "qr_image" ? "border-blue-300 bg-blue-50 text-blue-900" : "border-slate-200 bg-white text-slate-700"}`}>
                <input
                  type="checkbox"
                  className="mr-2"
                  checked={form.qr_mode === "qr_image"}
                  disabled={!canManage || isBusy}
                  onChange={() => setForm((current) => ({ ...current, qr_mode: "qr_image" }))}
                />
                {labels.qrModeImage}
                <span className="mt-1 block text-xs font-semibold text-slate-500">{labels.qrModeImageHint}</span>
              </label>
            </div>
          </div>
          <Field label={labels.promptpay} value={form.promptpay_phone} disabled={!canManage || isBusy} onChange={(value) => setForm((current) => ({ ...current, promptpay_phone: value }))} />
          <div className="grid gap-2">
            <span className="text-[13px] font-semibold text-slate-700">{labels.qrImage}</span>
            <div className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:grid-cols-[150px_1fr]">
              <div className="flex min-h-36 items-center justify-center rounded-lg border border-slate-200 bg-white">
                {form.qr_mode === "qr_image" && form.qr_image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={form.qr_image_url} alt={labels.qrImage} className="h-32 w-32 object-contain" />
                ) : form.qr_mode === "promptpay_link" && promptpayPreviewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={promptpayPreviewUrl} alt={labels.qrModePromptPay} className="h-32 w-32 object-contain" />
                ) : (
                  <p className="px-3 text-center text-xs font-semibold text-slate-500">
                    {labels.qrImage}
                  </p>
                )}
              </div>
              <div className="grid content-start gap-2">
                <label className={`inline-flex min-h-10 cursor-pointer items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-800 transition hover:bg-slate-50 ${!canManage || isBusy || isQrBusy ? "pointer-events-none opacity-60" : ""}`}>
                  <Icon name="plus" />
                  {isQrBusy ? "..." : labels.uploadQr}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    disabled={!canManage || isBusy || isQrBusy}
                    className="sr-only"
                    onChange={(event) => {
                      uploadQr(event.target.files?.[0]);
                      event.target.value = "";
                    }}
                  />
                </label>
                <ActionButton variant="plain" disabled={!canManage || isBusy || !form.qr_image_url || isQrBusy} onClick={() => setForm((current) => ({ ...current, qr_image_url: "" }))}>
                  {labels.removeQr}
                </ActionButton>
              </div>
            </div>
          </div>
          <label className="inline-flex items-center gap-2 text-sm font-bold text-slate-700">
            <input type="checkbox" checked={form.is_active} disabled={!canManage || isBusy} onChange={(event) => setForm((current) => ({ ...current, is_active: event.target.checked }))} />
            {labels.active}
          </label>
          <div className="flex gap-2">
            <ActionButton type="submit" disabled={!canManage || isBusy || isQrBusy}>
              {isBusy ? labels.saving : labels.save}
            </ActionButton>
            <ActionButton variant="plain" onClick={closePaymentForm} disabled={isBusy || isQrBusy}>
              {labels.cancel}
            </ActionButton>
          </div>
          {isBusy ? (
            <div className="store-v2-popup-overlay" role="dialog" aria-modal="true" aria-live="polite">
              <div className="store-v2-popup-card">
                <div className="store-v2-popup-spinner" aria-hidden="true" />
                <p className="store-v2-popup-title">{labels.saving}</p>
              </div>
            </div>
          ) : null}
        </form>
        </div>
        ) : null}
      </div>
      <PosManagerApprovalModal
        open={Boolean(deleteTarget)}
        title={labels.confirmDeletePayment}
        action="payment_account_delete"
        targetTable="tenant_payment_accounts"
        targetId={deleteTarget?.id ?? ""}
        lang={lang}
        onClose={() => {
          if (!isBusy) setDeleteTarget(null);
        }}
        onApproved={(approvalId) => {
          if (deleteTarget) void deleteAccount(deleteTarget, approvalId);
        }}
        onPinSubmit={async (pin) => {
          if (deleteTarget) await deleteAccount(deleteTarget, pin);
        }}
      />
    </section>
  );
}

function LanguageSettingsPopup({ lang, labels, onClose }: { lang: Language; labels: Labels; onClose: () => void }) {
  const options: Array<{ code: Language; label: string; shortLabel: string }> = [
    { code: "th", label: labels.thai, shortLabel: "TH" },
    { code: "en", label: labels.english, shortLabel: "EN" }
  ];

  function switchLanguage(nextLang: Language) {
    if (nextLang === lang) {
      onClose();
      return;
    }
    persistPosLanguage(nextLang);
    window.setTimeout(() => window.location.reload(), 80);
  }

  return (
    <div
      className="fixed inset-0 z-[95] grid place-items-center bg-slate-950/45 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={labels.languageTitle}
      onClick={onClose}
    >
      <section
        className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-black text-slate-950">{labels.languageTitle}</h3>
            <p className="mt-1 text-sm font-semibold text-slate-500">{labels.languageChoose}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-9 w-9 place-items-center rounded-lg border border-slate-300 bg-white text-sm font-black text-slate-700 hover:bg-slate-50"
            aria-label={labels.cancel}
          >
            x
          </button>
        </div>
        <p className="mt-4 rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-sm font-bold text-blue-700">
          {labels.languageCurrent}: {options.find((option) => option.code === lang)?.label ?? lang}
        </p>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {options.map((option) => {
            const active = option.code === lang;
            return (
              <button
                key={option.code}
                type="button"
                onClick={() => switchLanguage(option.code)}
                className={`flex min-h-[72px] items-center gap-3 rounded-xl border px-4 text-left transition ${
                  active
                    ? "border-blue-500 bg-blue-50 text-blue-700"
                    : "border-slate-200 bg-white text-slate-800 hover:border-blue-200 hover:bg-slate-50"
                }`}
              >
                <span
                  className={`grid h-10 w-10 place-items-center rounded-full text-sm font-black ${
                    active ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-700"
                  }`}
                >
                  {option.shortLabel}
                </span>
                <span className="font-black">{option.label}</span>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function MainMenuPlacementPopup({
  labels,
  onClose,
  onSaved
}: {
  labels: Labels;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [selectedPlacement, setSelectedPlacement] = useState<MainMenuPlacement>(() => {
    if (typeof window === "undefined") return "left";
    try {
      return normalizeMainMenuPlacement(window.localStorage.getItem(POS_MAIN_MENU_PLACEMENT_KEY));
    } catch {
      return "left";
    }
  });
  const options: Array<{ value: MainMenuPlacement; title: string; desc: string }> = [
    { value: "left", title: labels.mainMenuLeft, desc: labels.mainMenuLeftDesc },
    { value: "top", title: labels.mainMenuTop, desc: labels.mainMenuTopDesc },
    { value: "bottom", title: labels.mainMenuBottom, desc: labels.mainMenuBottomDesc }
  ];

  function savePlacement() {
    persistMainMenuPlacement(selectedPlacement);
    onSaved();
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-[95] grid place-items-center bg-slate-950/45 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={labels.mainMenuPlacementTitle}
      onClick={onClose}
    >
      <section
        className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-black text-slate-950">{labels.mainMenuPlacementTitle}</h3>
            <p className="mt-1 text-sm font-semibold text-slate-500">{labels.mainMenuPlacementChoose}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-9 w-9 place-items-center rounded-lg border border-slate-300 bg-white text-sm font-black text-slate-700 hover:bg-slate-50"
            aria-label={labels.cancel}
          >
            x
          </button>
        </div>
        <div className="mt-4 grid gap-3">
          {options.map((option) => {
            const active = option.value === selectedPlacement;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => setSelectedPlacement(option.value)}
                className={`grid min-h-[84px] grid-cols-[42px_1fr] items-center gap-3 rounded-xl border p-4 text-left transition ${
                  active
                    ? "border-blue-500 bg-blue-50 text-blue-800"
                    : "border-slate-200 bg-white text-slate-800 hover:border-blue-200 hover:bg-slate-50"
                }`}
              >
                <span className={`grid h-10 w-10 place-items-center rounded-full ${active ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-700"}`}>
                  <Icon name={option.value === "left" ? "back" : option.value === "top" ? "terminal" : "tables"} />
                </span>
                <span className="min-w-0">
                  <span className="block text-base font-black">{option.title}</span>
                  <span className="mt-1 block text-sm font-semibold text-slate-500">{option.desc}</span>
                </span>
              </button>
            );
          })}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <ActionButton variant="plain" onClick={onClose}>
            {labels.cancel}
          </ActionButton>
          <ActionButton onClick={savePlacement}>
            {labels.save}
          </ActionButton>
        </div>
      </section>
    </div>
  );
}

export function PosSettingsWorkspace({ lang, initialData }: { lang: Language; initialData: PosSettingsSnapshot }) {
  const labels = lang === "en" ? TEXT.en : TEXT.th;
  const [view, setView] = useState<SettingsView>("menu");
  const [store, setStore] = useState(initialData.store);
  const [branches, setBranches] = useState(initialData.branches);
  const [accounts, setAccounts] = useState(initialData.payment_accounts);
  const [taxSettings, setTaxSettings] = useState<TaxSettings>(initialData.tax_settings);
  const [notificationSettings, setNotificationSettings] = useState<PosNotificationSettings>(initialData.notification_settings);
  const [devices, setDevices] = useState<PosDeviceSettings[]>([]);
  const [devicesLoaded, setDevicesLoaded] = useState(false);
  const [status, setStatus] = useState("");
  const [savePopup, setSavePopup] = useState("");
  const [enabledFeatures, setEnabledFeatures] = useState<Record<string, boolean> | null>(null);
  const [packageLockOpen, setPackageLockOpen] = useState(false);
  const [languagePopupOpen, setLanguagePopupOpen] = useState(false);
  const [menuPlacementPopupOpen, setMenuPlacementPopupOpen] = useState(false);
  const canManage = initialData.metadata.can_manage;

  const reportStatus = useCallback((message: string, options?: { popup?: boolean }) => {
    setStatus(message);
    if (options?.popup) {
      setSavePopup(message);
    }
    window.setTimeout(() => setStatus(""), 2800);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadFeatures() {
      try {
        const response = await fetch("/api/pos/features", { cache: "no-store" });
        const body = (await response.json().catch(() => null)) as { data?: { features?: Record<string, boolean> } | null } | null;
        if (!cancelled && response.ok) setEnabledFeatures(body?.data?.features ?? {});
      } catch {
        if (!cancelled) setEnabledFeatures({});
      }
    }
    void loadFeatures();
    return () => {
      cancelled = true;
    };
  }, []);

  function isSettingLocked(viewKey: keyof typeof POS_SETTINGS_FEATURES) {
    const feature = POS_SETTINGS_FEATURES[viewKey];
    return Boolean(enabledFeatures !== null && enabledFeatures[feature] === false);
  }

  function openSettingsView(viewKey: Exclude<SettingsView, "menu">) {
    if (isSettingLocked(viewKey)) {
      setPackageLockOpen(true);
      return;
    }
    setView(viewKey);
  }

  return (
    <main className="h-full min-h-0 overflow-y-auto bg-slate-50 p-3 sm:p-5">
      <section className="min-h-full rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        {status ? (
          <div className="mb-6 flex justify-end">
            <div className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-sm font-bold text-blue-700">{status}</div>
          </div>
        ) : null}

        {view === "menu" ? (
          <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
            <MenuButton icon="store" title={labels.store} desc={labels.storeDesc} onClick={() => openSettingsView("store")} locked={isSettingLocked("store")} />
            <MenuButton icon="branch" title={labels.branches} desc={labels.branchesDesc} onClick={() => openSettingsView("branches")} locked={isSettingLocked("branches")} />
            <MenuButton icon="terminal" title={labels.devices} desc={labels.devicesDesc} onClick={() => openSettingsView("devices")} locked={isSettingLocked("devices")} />
            <MenuButton
              icon="terminal"
              title={lang === "en" ? "Printer Settings" : "ตั้งค่าเครื่องพิมพ์"}
              desc={lang === "en" ? "Receipt printers, Print Agents, branch printers, and cash drawers" : "ตั้งค่าใบเสร็จ, Print Agents, เครื่องพิมพ์สาขา และลิ้นชักเก็บเงิน"}
              onClick={() => openSettingsView("printers")}
              locked={isSettingLocked("printers")}
            />
            <MenuButton icon="activity" title={labels.activityAudit} desc={labels.activityAuditDesc} onClick={() => openSettingsView("activity")} locked={isSettingLocked("activity")} />
            <MenuButton icon="payment" title={labels.payments} desc={labels.paymentsDesc} onClick={() => openSettingsView("payments")} locked={isSettingLocked("payments")} compact />
            <MenuButton
              icon="payment"
              title={lang === "en" ? "INET QR" : "INET QR"}
              desc={lang === "en" ? "Dynamic QR, branch activation, and UAT connection" : "QR แบบกำหนดยอด, เปิดใช้งานรายสาขา และทดสอบ UAT"}
              onClick={() => openSettingsView("inet_nops")}
              locked={isSettingLocked("inet_nops")}
            />
            <MenuButton icon="tax" title={labels.taxes} desc={labels.taxesDesc} onClick={() => openSettingsView("taxes")} locked={isSettingLocked("taxes")} />
            <MenuButton
              icon="bell"
              title={lang === "en" ? "Notification Settings" : "ตั้งค่าการแจ้งเตือน"}
              desc={lang === "en" ? "Popup and sound alerts for table QR customer calls" : "POP UP และเสียงแจ้งเตือนเมื่อลูกค้าเรียกจาก QR โต๊ะ"}
              onClick={() => openSettingsView("notifications")}
              locked={isSettingLocked("notifications")}
            />
            <MenuButton icon="users" title={labels.users} desc={labels.usersDesc} onClick={() => openSettingsView("users")} locked={isSettingLocked("users")} />
            <MenuButton icon="language" title={labels.language} desc={labels.languageDesc} onClick={() => setLanguagePopupOpen(true)} />
            <MenuButton icon="language" title={labels.mainMenuPlacement} desc={labels.mainMenuPlacementDesc} onClick={() => setMenuPlacementPopupOpen(true)} />
            <MenuLink icon="display" title={labels.display} desc={labels.displayDesc} href="/preview/pos/customer-display" locked={isSettingLocked("display")} onLocked={() => setPackageLockOpen(true)} />
          </div>
        ) : null}

        {view === "store" ? (
          <StorePanel labels={labels} store={store} setStore={setStore} onBack={() => setView("menu")} canManage={canManage} reportStatus={reportStatus} />
        ) : null}
        {view === "branches" ? (
          <BranchPanel
            labels={labels}
            branches={branches}
            setBranches={setBranches}
            onBack={() => setView("menu")}
            canManage={canManage}
            activeBranchId={initialData.metadata.branch_id}
            reportStatus={reportStatus}
          />
        ) : null}
        {view === "devices" ? (
          <DevicePanel
            labels={labels}
            devices={devices}
            setDevices={setDevices}
            devicesLoaded={devicesLoaded}
            setDevicesLoaded={setDevicesLoaded}
            branches={branches}
            onBack={() => setView("menu")}
            canManage={canManage}
            activeBranchId={initialData.metadata.branch_id}
            reportStatus={reportStatus}
          />
        ) : null}
        {view === "printers" ? (
          <div className="grid gap-4">
            <div>
              <ActionButton variant="plain" onClick={() => setView("menu")}>
                {labels.back}
              </ActionButton>
            </div>
            <PrintersModule lang={lang === "en" ? "en" : "th"} />
          </div>
        ) : null}
        {view === "activity" ? (
          <ActivityAuditPanel
            labels={labels}
            lang={lang}
            branches={branches}
            onBack={() => setView("menu")}
            reportStatus={reportStatus}
          />
        ) : null}
        {view === "payments" ? (
          <PaymentPanel
            labels={labels}
            lang={lang}
            accounts={accounts}
            setAccounts={setAccounts}
            branches={branches}
            onBack={() => setView("menu")}
            canManage={canManage}
            activeBranchId={initialData.metadata.branch_id}
            reportStatus={reportStatus}
          />
        ) : null}
        {view === "inet_nops" ? (
          <InetNopsSettingsPanel
            lang={lang}
            branches={branches}
            activeBranchId={initialData.metadata.branch_id}
            canManage={canManage}
            onBack={() => setView("menu")}
            reportStatus={reportStatus}
          />
        ) : null}
        {view === "taxes" ? (
          <TaxPanel
            labels={labels}
            taxSettings={taxSettings}
            setTaxSettings={setTaxSettings}
            branches={branches}
            activeBranchId={initialData.metadata.branch_id}
            onBack={() => setView("menu")}
            canManage={canManage}
            reportStatus={reportStatus}
          />
        ) : null}
        {view === "notifications" ? (
          <NotificationPanel
            labels={labels}
            lang={lang}
            settings={notificationSettings}
            setSettings={setNotificationSettings}
            branches={branches}
            activeBranchId={initialData.metadata.branch_id}
            onBack={() => setView("menu")}
            canManage={canManage}
            reportStatus={reportStatus}
          />
        ) : null}
        {view === "users" ? <PosUsersModule lang={lang === "en" ? "en" : "th"} embedded onBack={() => setView("menu")} /> : null}
      </section>
      {savePopup ? <SaveSuccessPopup labels={labels} message={savePopup} onClose={() => setSavePopup("")} /> : null}
      {languagePopupOpen ? <LanguageSettingsPopup lang={lang} labels={labels} onClose={() => setLanguagePopupOpen(false)} /> : null}
      {menuPlacementPopupOpen ? (
        <MainMenuPlacementPopup
          labels={labels}
          onClose={() => setMenuPlacementPopupOpen(false)}
          onSaved={() => reportStatus(labels.saved, { popup: true })}
        />
      ) : null}
      <PackageLockDialog lang={lang} open={packageLockOpen} onClose={() => setPackageLockOpen(false)} />
    </main>
  );
}
