import type { PrinterConnectionType } from "@pos/shared-types";

export type AdapterPrintContext = {
  printerId: string;
  printerName: string;
  connectionType: PrinterConnectionType;
  ipAddress: string | null;
  port: number | null;
  payloadText: string;
  payloadHtml?: string | null;
  metadata: Record<string, unknown>;
};

export type AdapterPrintResult = {
  providerJobId?: string;
  bytesSent?: number;
  metadata?: Record<string, unknown>;
};

export interface PrinterAdapter {
  readonly connectionType: PrinterConnectionType;
  print(ctx: AdapterPrintContext): Promise<AdapterPrintResult>;
}
