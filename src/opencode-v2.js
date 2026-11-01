// OpenCode 2 plugin. V2 loads `default.setup(ctx)` and has no `tool.execute.before` / `permission.ask` hooks:
// tool calls go through ctx.tool.hook("execute.before" / "execute.after"), and every permission check, including
// ones the user's rules already allow, passes ctx.permission.hook("evaluate") with an effect the plugin may change.
// A risky call asks its own question through ctx.permission.assert, so it gets OpenCode's real approval prompt
// whether or not the tool would have checked a permission itself; OpenCode's own rules still apply afterwards.
import { assessAction, scanContent, collectText, preview, excerpt, INSTRUCTION_FILE } from "./guard.js";
import { scanInstructionsCached } from "./skills.js";
import { buildContext } from "./context.js";
import { readSession, remember } from "./session.js";

export const ACTION = "jev-guard";  // permission action of the approval prompt; a deny rule matching it blocks risky calls

/** User and assistant text from V2's ctx.session.context() messages. */
export function messagesFromV2(messages) {
  const out = [];
  for (const m of messages ?? []) {
    const text = m.type === "user" ? m.text
      : m.type === "assistant" ? (m.content ?? []).filter((p) => p.type === "text").map((p) => p.text).join("\n") : "";
    if (text?.trim()) out.push({ role: m.type, text: text.trim() });
  }
  return out.slice(-8);
}

export async function setup(ctx, { log = (m) => console.warn(m) } = {}) {
  const cwd = ctx.location?.directory;
  const asking = new Map();  // call id → message shown in the approval prompt
  // OpenCode's permission dialog renders only the action name for a plugin-defined action like
  // ours ("Call tool jev-guard" / "Tool: jev-guard"), not e.message or metadata.reason (confirmed
  // on OpenCode 2.2.5), and this Context has no UI channel of its own. The reasoning leaves
  // through metadata on the assert below, which src/tui.js — the package's TUI entry — shows in a
  // jev-guard panel while the request is pending. `asking`/`e.message` still make the message the
  // deny reason.
  const failOpen = (err) => {
    log(`jev-guard: ${err.message}`);
    if (process.env.JEV_GUARD_FAIL_CLOSED) throw new Error(`jev-guard unavailable: ${err.message}`);
    return null;
  };
  // The session's messages; empty when they can't be read, so the call is judged on its own.
  const context = async (sessionID) => {
    const messages = await ctx.session.context({ sessionID }).catch(() => []);
    return buildContext({ sessionId: sessionID, messages: messagesFromV2(messages) });
  };

  await ctx.permission.hook("evaluate", (e) => {
    if (e.action !== ACTION) return;
    e.effect = "ask";  // whatever the rules say: this question exists because Jev wanted a human
    const id = e.source?.type === "tool" ? e.source.id : undefined;
    if (id && asking.has(id)) e.message = asking.get(id);
  });

  await ctx.tool.hook("execute.before", async (e) => {
    const r = await assessAction({ tool: e.tool, input: e.input, cwd, agent: "opencode", context: await context(e.sessionID) }).catch(failOpen);
    if (r) remember(e.sessionID, "calls", { tool: e.tool, preview: preview(e.input, 100), level: r.level });
    if (!r || r.level === "allow") return;
    if (r.level === "deny") throw new Error(r.message);
    asking.set(e.id, r.message);
    try {
      await ctx.permission.assert({
        sessionID: e.sessionID, agent: e.agent, action: ACTION, resources: [`${e.tool} ${preview(e.input)}`],
        metadata: {
          tool: e.tool, reason: r.message,
          risk: r.risk, approval: r.approval, userRequested: r.userRequested, fromUntrusted: r.fromUntrusted, confidence: r.confidence,
        },
        source: { type: "tool", messageID: e.messageID, id: e.id },
      });
    } finally { asking.delete(e.id); }
  });

  await ctx.tool.hook("execute.after", async (e) => {
    if (e.status !== "completed") return;
    const input = e.input ?? {};
    const source = input.url ?? input.filePath ?? input.path;
    const instructions = /^skill$/i.test(e.tool ?? "") || (source && INSTRUCTION_FILE.test(source));  // skill passes {name}, no path
    const text = collectText(e.result.content ?? e.result.output);
    const r = await (instructions
      ? scanInstructionsCached({ text, source: source ?? input.name ?? e.tool })
      : scanContent({ text, tool: e.tool, source: preview(input, 120), task: readSession(e.sessionID).prompts.at(-1)?.text })
    ).catch(() => null);
    if (!r?.flagged) return;
    remember(e.sessionID, "flags", { kind: r.kind, source, tool: e.tool, p: +r.p.toFixed(2), excerpt: excerpt(text), reported: true });
    log(r.message);
    e.result.content = [{ type: "text", text: `[${r.message}]` }, ...(e.result.content ?? [])];
  });
}
