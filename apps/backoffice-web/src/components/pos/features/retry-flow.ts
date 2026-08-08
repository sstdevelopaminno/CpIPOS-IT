import { extractApiErrorCode, isConflictErrorCode } from "@/components/pos/pos-sales-errors";

export async function runPendingSubmitRetry(args: {
  hasPending: boolean;
  isBusy: boolean;
  isOnline: boolean;
  stillOfflineMessage: string;
  retryFailedMessage: string;
  submitOrder: () => Promise<void>;
  markPendingFailed: (errorMessage: string) => void;
  dequeuePending: () => void;
  onConflictTableNotAvailable: () => void;
  onConflictShiftNotOpen: () => void;
  onSetSubmitting: (value: boolean) => void;
  onSetOnline: (value: boolean) => void;
  onMarkConnectivityFromError: (error: unknown) => void;
  onPushMessage: (message: string) => void;
}): Promise<void> {
  const {
    hasPending,
    isBusy,
    isOnline,
    stillOfflineMessage,
    retryFailedMessage,
    submitOrder,
    markPendingFailed,
    dequeuePending,
    onConflictTableNotAvailable,
    onConflictShiftNotOpen,
    onSetSubmitting,
    onSetOnline,
    onMarkConnectivityFromError,
    onPushMessage
  } = args;
  if (!hasPending || isBusy) return;
  if (!isOnline) {
    onPushMessage(stillOfflineMessage);
    return;
  }
  onSetSubmitting(true);
  try {
    await submitOrder();
    onSetOnline(true);
  } catch (retryError) {
    const retryMessage = retryError instanceof Error ? retryError.message : retryFailedMessage;
    const retryCode = extractApiErrorCode(retryMessage);
    if (isConflictErrorCode(retryCode)) {
      dequeuePending();
      if (retryCode === "table_not_available") {
        onConflictTableNotAvailable();
      }
      if (retryCode === "shift_not_open") {
        onConflictShiftNotOpen();
      }
      onPushMessage(retryMessage);
      return;
    }
    markPendingFailed(retryMessage);
    onMarkConnectivityFromError(retryError);
    onPushMessage(retryMessage);
  } finally {
    onSetSubmitting(false);
  }
}

export async function runPendingPaymentRetry(args: {
  hasPendingPayment: boolean;
  isBusy: boolean;
  isOnline: boolean;
  stillOfflineMessage: string;
  retryFailedMessage: string;
  submitPayment: () => Promise<void>;
  markPendingPaymentFailed: (errorMessage: string) => void;
  onSetTransferSubmitting: (value: boolean) => void;
  onSetOnline: (value: boolean) => void;
  onMarkConnectivityFromError: (error: unknown) => void;
  onPushMessage: (message: string) => void;
}): Promise<void> {
  const {
    hasPendingPayment,
    isBusy,
    isOnline,
    stillOfflineMessage,
    retryFailedMessage,
    submitPayment,
    markPendingPaymentFailed,
    onSetTransferSubmitting,
    onSetOnline,
    onMarkConnectivityFromError,
    onPushMessage
  } = args;
  if (!hasPendingPayment || isBusy) return;
  if (!isOnline) {
    onPushMessage(stillOfflineMessage);
    return;
  }
  onSetTransferSubmitting(true);
  try {
    await submitPayment();
    onSetOnline(true);
  } catch (retryError) {
    const retryMessage = retryError instanceof Error ? retryError.message : retryFailedMessage;
    markPendingPaymentFailed(retryMessage);
    onMarkConnectivityFromError(retryError);
    onPushMessage(retryMessage);
  } finally {
    onSetTransferSubmitting(false);
  }
}
