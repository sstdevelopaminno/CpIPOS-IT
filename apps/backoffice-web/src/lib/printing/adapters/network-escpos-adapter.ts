import net from "node:net";
import type { PrinterAdapter } from "@/lib/printing/adapters/types";

function toEscPosPayload(text: string): Buffer {
  const initialize = Buffer.from([0x1b, 0x40]);
  const body = Buffer.from(text, "utf8");
  const lineFeed = Buffer.from([0x0a, 0x0a]);
  const cut = Buffer.from([0x1d, 0x56, 0x00]);
  return Buffer.concat([initialize, body, lineFeed, cut]);
}

function clampByte(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

function toCashDrawerPayload(metadata: Record<string, unknown>): Buffer {
  const initialize = Buffer.from([0x1b, 0x40]);
  const kickPin = clampByte(metadata.drawer_kick_pin, 0, 0, 1);
  const pulseOnUnits = clampByte(Math.round(Number(metadata.drawer_pulse_on_ms ?? 50) / 2), 25, 10, 250);
  const pulseOffUnits = clampByte(Math.round(Number(metadata.drawer_pulse_off_ms ?? 250) / 2), 125, 25, 250);
  return Buffer.concat([initialize, Buffer.from([0x1b, 0x70, kickPin, pulseOnUnits, pulseOffUnits])]);
}

export class NetworkEscPosAdapter implements PrinterAdapter {
  readonly connectionType = "NETWORK_ESC_POS" as const;

  async print(ctx: Parameters<PrinterAdapter["print"]>[0]) {
    if (!ctx.ipAddress) {
      throw new Error("NETWORK_ESC_POS requires printer ip_address.");
    }

    const port = ctx.port ?? 9100;
    const payload = ctx.metadata.command === "open_cash_drawer" ? toCashDrawerPayload(ctx.metadata) : toEscPosPayload(ctx.payloadText);

    await new Promise<void>((resolve, reject) => {
      const socket = net.createConnection({ host: ctx.ipAddress!, port }, () => {
        socket.write(payload);
        socket.end();
      });

      socket.setTimeout(5000);
      socket.on("timeout", () => {
        socket.destroy();
        reject(new Error("NETWORK_ESC_POS socket timeout."));
      });
      socket.on("error", (error) => reject(error));
      socket.on("close", (hadError) => {
        if (!hadError) {
          resolve();
        }
      });
    });

    return {
      bytesSent: payload.byteLength,
      metadata: {
        host: ctx.ipAddress,
        port,
        command: ctx.metadata.command === "open_cash_drawer" ? "open_cash_drawer" : "print"
      }
    };
  }
}
