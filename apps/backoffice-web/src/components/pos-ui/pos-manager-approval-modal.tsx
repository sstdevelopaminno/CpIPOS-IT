"use client";

import type { ApprovalAction } from "@pos/shared-types";
import { ManagerOverrideModal } from "@/components/pos/manager-override-modal";

type Props = {
  open: boolean;
  title: string;
  action: ApprovalAction;
  targetTable: string;
  targetId: string;
  onClose: () => void;
  onApproved: (approvalId: string) => void;
  onPinSubmit?: (pin: string) => Promise<void>;
  lang?: "th" | "en";
  labels?: {
    pinLabel?: string;
    pinKeypadHint?: string;
    pinLengthError?: string;
    pinRejected?: string;
    checkingAccess?: string;
    clear?: string;
    remove?: string;
    closeAriaLabel?: string;
  };
};

export function PosManagerApprovalModal(props: Props) {
  return <ManagerOverrideModal {...props} />;
}
