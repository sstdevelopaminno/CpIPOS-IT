import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const consoleUi = readFileSync(resolve(process.cwd(),"src/components/it-admin/support-chat-console.tsx"),"utf8");
const route = readFileSync(resolve(process.cwd(),"src/app/api/it-admin/v1/support-chat/conversations/[conversationId]/route.ts"),"utf8");

describe("IT close synchronization",()=>{
  it("broadcasts a two-phase close lifecycle to the active POS browser",()=>{
    expect(consoleUi).toContain('event: "conversation_closing"');
    expect(consoleUi).toContain('event: "conversation_closed"');
    expect(consoleUi).toContain('event: "conversation_close_cancelled"');
    expect(consoleUi).toContain("if (!closing) await loadConversation(targetId)");
  });

  it("pushes a closed-case notification to store devices",()=>{
    expect(route).toContain('title: "จบการสนทนาแล้ว"');
    expect(route).toContain('tag: `support-chat-closed:${conversationId}`');
  });
});
