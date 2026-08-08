import type { PrinterAdapter } from "@/lib/printing/adapters/types";

export class StarWebPrntAdapter implements PrinterAdapter {
  readonly connectionType = "STAR_WEBPRNT" as const;

  async print(ctx: Parameters<PrinterAdapter["print"]>[0]) {
    const endpoint = typeof ctx.metadata.webprnt_url === "string" ? ctx.metadata.webprnt_url : null;
    if (!endpoint) {
      throw new Error("STAR_WEBPRNT requires metadata.webprnt_url.");
    }

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        printer_id: ctx.printerId,
        payload_text: ctx.payloadText
      })
    });

    if (!response.ok) {
      throw new Error(`STAR_WEBPRNT request failed with status ${response.status}.`);
    }

    return {
      metadata: {
        endpoint
      }
    };
  }
}
