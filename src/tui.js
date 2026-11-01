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
const MAX_COMMAND_CHARS = 160;

const num = (v, digits = 2) => (typeof v === "number" && Number.isFinite(v) ? v.toFixed(digits) : undefined);

// One score per line with the scale it lives on, so a bare number is never the whole story.
const SCORES = [
  ["risk", (m) => num(m.risk, 1), "0–3"],
  ["approval", (m) => num(m.approval), "0–1"],
  ["you asked for it", (m) => num(m.userRequested), "0–1"],
  ["untrusted source", (m) => num(m.fromUntrusted), "0–1"],
  ["confidence", (m) => num(m.confidence), "0–1"],
];

/** The ask as display pieces: which tool, one bullet per Jev score, the exact call. */
export function describeAsk({ metadata = {}, resources = [], action = ACTION } = {}) {
  const tool = typeof metadata.tool === "string" ? metadata.tool : undefined;
  const full = String(resources[0] ?? tool ?? action);
  const command = tool && full.startsWith(`${tool} `) ? full.slice(tool.length + 1) : full;
  const what = command.length > MAX_COMMAND_CHARS ? `${command.slice(0, MAX_COMMAND_CHARS - 1)}…` : command;
  const scores = SCORES
    .map(([label, read, range]) => [label, read(metadata), range])
    .filter(([, value]) => value !== undefined)
    .map(([label, value, range]) => `• ${label} ${value} (${range})`);
  if (scores.length) return { tool, scores, what };
  const reason = typeof metadata.reason === "string" ? metadata.reason : `${action} needs approval`;
  return { tool, scores, reason, what };
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
function panelView(asks, sessionID, theme = {}) {
  const warn = theme.warning ?? theme.text?.default;
  const muted = theme.text?.subdued;
  const root = box({ width: "100%", flexDirection: "column", paddingLeft: 1 });
  insert(root, () => {
    const all = asks();
    const own = all[sessionID];
    const ids = Object.keys(all);
    if (own) {
      const heading = `⚠ jev-guard — ${own.tool ?? "this call"} needs your approval`;
      return box({ width: "100%", flexDirection: "column" }, [
        text({ fg: warn }, [heading]),
        ...(own.scores.length
          ? own.scores.map((line) => text({ fg: muted }, [line]))
          : [text({ fg: muted }, [own.reason])]),
        own.what && box({ marginTop: 1, marginBottom: 1 }, [text({ fg: warn }, [`$ ${own.what}`])]),
        text({ fg: muted }, ["Answer the permission prompt — this panel closes when you do."]),
      ].filter(Boolean));
    }
    if (!ids.length) return null;
    return box({ width: "100%", flexDirection: "column" }, [
      text({ fg: warn }, [`jev-guard: ${ids.length} pending request${ids.length === 1 ? "" : "s"} in other sessions`]),
      ...ids.map((id) => text({ fg: muted }, [`${id} · ${[all[id].scores[0], all[id].what].filter(Boolean).join(" · ")}`])),
    ]);
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
    render: (input) => (input?.name === PANEL ? panelView(asks, input.sessionID, ctx.theme) : null),
  });
  return () => { offAsk?.(); offReply?.(); offSlot?.(); if (panelOpen()) ctx.ui.panel.close(); };
}

export default Plugin.define({ id: ACTION, setup });
