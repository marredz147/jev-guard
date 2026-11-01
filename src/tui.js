// OpenCode 2 TUI plugin. The server half (src/opencode-v2.js) decides what needs approval, but its
// Context has no client and no UI channel: OpenCode's permission dialog renders only the action name
// for a plugin-defined action ("Call tool jev-guard" / "Tool: jev-guard"), so the assessment never
// reaches the user there. A toast is wrong too: `ui.toast` is broadcast to every TUI, it expires on
// a timer, and the plugin-facing Toast exposes only `show`. `ui.panel` cannot carry this either —
// `panel.open()` targets the session that is current when it is called and a plugin has one active
// panel, so an ask from another tab would surface in the wrong tab and vanish when you switch.
// `session.composer.top` renders per session instead: each tab shows its own pending ask above the
// input, nothing shows in tabs without one, and the asking is still OpenCode's normal permission
// prompt, so any client (desktop, mobile, Orca) can answer it.
import { Plugin } from "@opencode/plugin/tui";
import { createElement, insert, setProp } from "@opentui/solid";
import { createSignal } from "solid-js";

export const ACTION = "jev-guard";
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

/** The ask as display pieces: which tool, one bullet per Jev score, the exact call, and what the call changes. */
export function describeAsk({ metadata = {}, resources = [], action = ACTION } = {}) {
  const tool = typeof metadata.tool === "string" ? metadata.tool : undefined;
  const full = resources[0] == null ? undefined : String(resources[0]);
  const command = full === undefined ? undefined : tool && full.startsWith(`${tool} `) ? full.slice(tool.length + 1) : full;
  const what = command?.length > MAX_COMMAND_CHARS ? `${command.slice(0, MAX_COMMAND_CHARS - 1)}…` : command;
  const diff = Array.isArray(metadata.diff) && metadata.diff.length ? metadata.diff.map(String) : undefined;
  const scores = SCORES
    .map(([label, read, range]) => [label, read(metadata), range])
    .filter(([, value]) => value !== undefined)
    .map(([label, value, range]) => `• ${label} ${value} (${range})`);
  if (scores.length) return { tool, scores, what, diff };
  const reason = typeof metadata.reason === "string" ? metadata.reason : `${action} needs approval`;
  return { tool, scores, reason, what, diff };
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

/** Banner body: this session's ask, or nothing at all. */
export function bannerView(asks, sessionID, theme = {}) {
  const warn = theme.warning ?? theme.text?.default;
  const muted = theme.text?.subdued;
  const added = theme.success ?? theme.text?.default;
  const removed = theme.error ?? theme.warning ?? theme.text?.default;
  const root = box({ width: "100%", flexDirection: "column", paddingLeft: 1 });
  insert(root, () => {
    const ask = asks()[sessionID];
    if (!ask) return null;
    const diffLine = (line) => text({ fg: line.startsWith("+") ? added : line.startsWith("-") ? removed : muted }, [line]);
    return box({ width: "100%", flexDirection: "column", marginTop: 1 }, [
      text({ fg: warn }, [`⚠ jev-guard — ${ask.tool ?? "this call"} needs your approval`]),
      ask.diff?.length && box({ flexDirection: "column", marginTop: 1 }, ask.diff.map(diffLine)),
      ...(ask.scores.length
        ? ask.scores.map((line) => text({ fg: muted }, [line]))
        : [text({ fg: muted }, [ask.reason])]),
      ask.what && box({ marginTop: 1, marginBottom: 1 }, [text({ fg: warn }, [`$ ${ask.what}`])]),
      text({ fg: muted }, ["Answer the permission prompt — this clears when you do."]),
    ].filter(Boolean));
  });
  return root;
}

export function setup(ctx) {
  const [asks, setAsks] = createSignal({});  // sessionID -> describeAsk(...)

  const offAsk = ctx.data.on("permission.asked", ({ data }) => {
    if (data?.action !== ACTION || !data.sessionID) return;
    const described = describeAsk(data);
    setAsks((prev) => ({ ...prev, [data.sessionID]: described }));
  });
  // The reply event carries no action and no guaranteed request id, but asks are one per session:
  // answering one anywhere (desktop, mobile client, Orca) clears the banner in every TUI.
  const offReply = ctx.data.on("permission.replied", ({ data }) => {
    if (!data?.sessionID) return;
    setAsks((prev) => {
      if (!(data.sessionID in prev)) return prev;
      const next = { ...prev };
      delete next[data.sessionID];
      return next;
    });
  });
  const offSlot = ctx.ui.slot({
    prepend: "session.composer.top",
    render: (input) => bannerView(asks, input?.sessionID, ctx.theme),
  });
  return () => { offAsk?.(); offReply?.(); offSlot?.(); };
}

export default Plugin.define({ id: ACTION, setup });
