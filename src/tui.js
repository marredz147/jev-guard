// OpenCode 2 TUI plugin. The server half (src/opencode-v2.js) decides what needs approval, but its
// Context has no client and no UI channel: OpenCode's permission dialog renders only the action name
// for a plugin-defined action ("Call tool jev-guard" / "Tool: jev-guard"). A toast is wrong for this:
// it is broadcast to every open TUI, it expires on a timer, and the plugin-facing Toast exposes only
// `show`. The host does publish `session.panel`, a slot selected by `ui.panel.open(name)` and kept
// rendered while this plugin keeps it open, so the description lives there: it appears as its own
// panel while a request is pending, the asking itself stays OpenCode's normal permission prompt, and
// any answer (allow or reject, from any client) closes the panel again.
import { Plugin } from "@opencode/plugin/tui";
import { createElement, insert, setProp } from "@opentui/solid";
import { createSignal } from "solid-js";

export const ACTION = "jev-guard";
export const PANEL = "jev-guard";
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

/** Panel body: this session's ask in full, or a summary of asks pending elsewhere. */
function panelView(asks, sessionID) {
  const root = box({ width: "100%", flexDirection: "column", paddingLeft: 1 });
  insert(root, () => {
    const all = asks();
    const own = all[sessionID];
    const ids = Object.keys(all);
    const lines = [];
    if (own) {
      lines.push(text({}, "⚠ jev-guard: this call needs your approval"));
      if (own.facts) lines.push(text({}, own.facts));
      if (own.evidence) lines.push(text({}, own.evidence));
      if (own.what) lines.push(text({}, own.what));
      lines.push(text({}, "Answer the permission prompt — this panel closes when you do."));
    } else if (ids.length) {
      lines.push(text({}, `jev-guard: ${ids.length} pending request${ids.length === 1 ? "" : "s"} in other sessions`));
      for (const id of ids) lines.push(text({}, `${id} · ${[all[id].facts, all[id].what].filter(Boolean).join(" · ")}`));
    }
    if (!lines.length) return null;
    return box({ width: "100%", flexDirection: "column" }, lines);
  });
  return root;
}

export function setup(ctx) {
  const [asks, setAsks] = createSignal({});  // sessionID -> describeAsk(...)
  const panelOpen = () => ctx.ui.panel.current()?.name === PANEL;
  const closeWhenIdle = () => { if (!Object.keys(asks()).length && panelOpen()) ctx.ui.panel.close(); };

  const offAsk = ctx.data.on("permission.asked", ({ data }) => {
    if (data?.action !== ACTION || !data.sessionID) return;
    const described = describeAsk(data);
    setAsks((prev) => ({ ...prev, [data.sessionID]: described }));
    if (!panelOpen()) ctx.ui.panel.open(PANEL, { presentation: "panel" });
  });
  // The reply event carries no action and no guaranteed request id, but asks are one per session:
  // answering one anywhere (desktop, mobile client, Orca) closes the panel in every TUI showing it.
  const offReply = ctx.data.on("permission.replied", ({ data }) => {
    if (!data?.sessionID) return;
    setAsks((prev) => {
      if (!(data.sessionID in prev)) return prev;
      const next = { ...prev };
      delete next[data.sessionID];
      return next;
    });
    closeWhenIdle();
  });
  const offSlot = ctx.ui.slot({
    append: "session.panel",
    render: (input) => (input?.name === PANEL ? panelView(asks, input.sessionID) : null),
  });
  return () => { offAsk?.(); offReply?.(); offSlot?.(); if (panelOpen()) ctx.ui.panel.close(); };
}

export default Plugin.define({ id: ACTION, setup });
