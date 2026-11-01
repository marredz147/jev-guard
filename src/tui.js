// OpenCode 2 TUI plugin. The server half (src/opencode-v2.js) decides what needs approval, but its
// Context has no client and no UI channel: OpenCode's permission dialog renders only the action name
// for a plugin-defined action ("Call tool jev-guard" / "Tool: jev-guard"), so the risk assessment's
// reasoning never reaches the user from there. The TUI-side Context does have `ui.toast`, and the ask
// itself carries the assessment in `metadata` (permission.asked -> data.metadata), so this entry turns
// every jev-guard ask into a toast that shows it — and takes it away once the user answers.
import { Plugin } from "@opencode/plugin/tui";

export const ACTION = "jev-guard";
export const TOAST_MS = 8000;  // long enough to read while deciding
const MAX_ACTION_CHARS = 120;  // a toast is narrow; the command's tail is the least useful part

const row = (parts) => parts.filter(Boolean).join(" · ");

/**
 * The toast body: the verdict numbers first, the call last, one thought per line. OpenCode's dialog
 * carries none of this, and the toast wraps at ~50 columns, so one prose sentence becomes a wall of text.
 */
export function formatAsk({ metadata = {}, resources = [], action = ACTION } = {}) {
  const num = (v, digits = 2) => (typeof v === "number" && Number.isFinite(v) ? v.toFixed(digits) : undefined);
  const risk = num(metadata.risk, 1), approval = num(metadata.approval);
  const facts = row([risk && `risk ${risk}/3`, approval && `approval p=${approval}`]);
  if (!facts) return typeof metadata.reason === "string" ? metadata.reason : `jev-guard: ${action} needs approval`;
  const evidence = row([
    num(metadata.userRequested) && `user-asked p=${num(metadata.userRequested)}`,
    num(metadata.fromUntrusted) && `untrusted p=${num(metadata.fromUntrusted)}`,
    num(metadata.confidence) && `conf ${num(metadata.confidence)}`,
  ]);
  const what = String(resources[0] ?? metadata.tool ?? action);
  return [facts, evidence, what.length > MAX_ACTION_CHARS ? `${what.slice(0, MAX_ACTION_CHARS - 1)}…` : what].join("\n");
}

/** Toast the reasoning behind each ask the server half raises, and clear it when the ask is answered. */
export function setup(ctx) {
  const asked = new Map();  // request id -> when it was toasted, so a stale reply cannot touch other toasts
  const latest = new Map();  // session id -> its most recent ask, the fallback when the reply's id does not match
  const prune = () => { if (asked.size > 200) asked.delete(asked.keys().next().value); };

  const offAsk = ctx.data.on("permission.asked", ({ data }) => {
    if (data?.action !== ACTION || asked.has(data.id)) return;
    asked.set(data.id, Date.now());
    latest.set(data.sessionID, data.id);
    prune();
    ctx.ui.toast.show({ title: "jev-guard", message: formatAsk(data), variant: "warning", duration: TOAST_MS, sessionID: data.sessionID });
  });

  // `ui.toast` has `show` and nothing else — no dismiss — and the host replaces the current toast when
  // a new one arrives, so an answered ask is cleared by showing an empty toast that expires at once.
  // The window check keeps that from replacing a different plugin's toast once ours is long gone.
  const offReply = ctx.data.on("permission.replied", ({ data }) => {
    if (!data) return;
    const id = asked.has(data.requestID) ? data.requestID : latest.get(data.sessionID);
    const at = id && asked.get(id);
    if (!at) return;
    asked.delete(id);
    latest.delete(data.sessionID);
    if (Date.now() - at >= TOAST_MS) return;
    ctx.ui.toast.show({ title: "jev-guard", message: " ", variant: "info", duration: 1, sessionID: data.sessionID });
  });

  return () => { offAsk?.(); offReply?.(); };
}

export default Plugin.define({ id: ACTION, setup });
