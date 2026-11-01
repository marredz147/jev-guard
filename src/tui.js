// OpenCode 2 TUI plugin. The server half (src/opencode-v2.js) decides what needs approval, but its
// Context has no client and no UI channel: OpenCode's permission dialog renders only the action name
// for a plugin-defined action ("Call tool jev-guard" / "Tool: jev-guard"). A toast is wrong for this:
// it is broadcast to every open TUI, it expires after a few seconds, and it cannot be dismissed
// (the plugin-facing Toast exposes only `show`). The host does publish `session.composer.top`, a slot
// bound to one session and kept alive while its content is rendered, so the reasoning lives there:
// it appears above the composer of the session that is asking and disappears when the request is
// answered (permission.replied), with no timer of its own.
import { Plugin } from "@opencode/plugin/tui";
import { createElement, insert, setProp } from "@opentui/solid";
import { createSignal } from "solid-js";

export const ACTION = "jev-guard";
const MAX_ACTION_CHARS = 120;

const row = (parts) => parts.filter(Boolean).join(" · ");
const num = (v, digits = 2) => (typeof v === "number" && Number.isFinite(v) ? v.toFixed(digits) : undefined);

/** The ask as display lines: what Jev measured, what else it weighed, what is being asked for. */
export function describeAsk({ metadata = {}, resources = [], action = ACTION } = {}) {
  const risk = num(metadata.risk, 1), approval = num(metadata.approval);
  const facts = row([risk && `risk ${risk}/3`, approval && `approval p=${approval}`]);
  if (!facts) {
    const reason = typeof metadata.reason === "string" ? metadata.reason : `${action} needs approval`;
    return { facts: reason, evidence: undefined, what: undefined };
  }
  const evidence = row([
    num(metadata.userRequested) && `user-asked p=${num(metadata.userRequested)}`,
    num(metadata.fromUntrusted) && `untrusted p=${num(metadata.fromUntrusted)}`,
    num(metadata.confidence) && `conf ${num(metadata.confidence)}`,
  ]);
  const what = String(resources[0] ?? metadata.tool ?? action);
  return { facts, evidence, what: what.length > MAX_ACTION_CHARS ? `${what.slice(0, MAX_ACTION_CHARS - 1)}…` : what };
}

// Plain-JS equivalents of the host's JSX helpers (same calls the bundled plugins compile to).
const element = (tag, props = {}, children = []) => {
  const node = createElement(tag);
  for (const [key, value] of Object.entries(props)) if (value !== undefined) setProp(node, key, value);
  const list = Array.isArray(children) ? children : [children];
  for (const child of list) if (child !== null && child !== undefined && child !== false) insert(node, child);
  return node;
};
const box = (props, children) => element("box", props, children);
const text = (props, children) => element("text", props, children);

/** A banner for one session: empty while it has no ask, reactive when it does. */
function banner(asks, sessionID) {
  const root = box({ width: "100%", flexDirection: "column", paddingLeft: 1 });
  insert(root, () => {
    const ask = asks()[sessionID];
    if (!ask) return null;
    return box({ width: "100%", flexDirection: "column" }, [
      text({}, "⚠ jev-guard: this call needs your approval"),
      ask.facts && text({}, ask.facts),
      ask.evidence && text({}, ask.evidence),
      ask.what && text({}, ask.what),
    ].filter(Boolean));
  });
  return root;
}

export function setup(ctx) {
  const [asks, setAsks] = createSignal({});  // sessionID -> describeAsk(...)
  const forget = (sessionID) => setAsks((prev) => {
    if (!(sessionID in prev)) return prev;
    const next = { ...prev };
    delete next[sessionID];
    return next;
  });
  const offAsk = ctx.data.on("permission.asked", ({ data }) => {
    if (data?.action !== ACTION || !data.sessionID) return;
    const described = describeAsk(data);
    setAsks((prev) => ({ ...prev, [data.sessionID]: described }));
  });
  // The reply event carries no request id match guarantee and no action, but the ask is per session:
  // answering it anywhere clears the banner in every window showing that session.
  const offReply = ctx.data.on("permission.replied", ({ data }) => {
    if (data?.sessionID) forget(data.sessionID);
  });
  const offSlot = ctx.ui.slot({ append: "session.composer.top", render: ({ sessionID }) => banner(asks, sessionID) });
  return () => { offAsk?.(); offReply?.(); offSlot?.(); };
}

export default Plugin.define({ id: ACTION, setup });
