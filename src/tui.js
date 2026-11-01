// OpenCode 2 TUI plugin. The server half (src/opencode-v2.js) decides what needs approval, but its
// Context has no client and no UI channel: OpenCode's permission dialog renders only the action name
// for a plugin-defined action ("Call tool jev-guard" / "Tool: jev-guard"), so the risk assessment's
// reasoning never reaches the user from there. The TUI-side Context does have `ui.toast`, and the ask
// itself carries the assessment in `metadata` (permission.asked -> data.metadata), so this entry turns
// every jev-guard ask into a toast that shows it.
import { Plugin } from "@opencode/plugin/tui";

export const ACTION = "jev-guard";
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

/** Toast the reasoning behind each ask the server half raises. */
export function setup(ctx) {
  const shown = new Set();  // request ids already toasted; one ask fires permission.asked once
  const off = ctx.data.on("permission.asked", ({ data }) => {
    if (data?.action !== ACTION || shown.has(data.id)) return;
    shown.add(data.id);
    if (shown.size > 200) shown.delete(shown.values().next().value);
    ctx.ui.toast.show({ title: "jev-guard", message: formatAsk(data), variant: "warning", duration: 8000, sessionID: data.sessionID });
  });
  return () => { off?.(); };
}

export default Plugin.define({ id: ACTION, setup });
