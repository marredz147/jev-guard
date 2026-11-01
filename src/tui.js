// OpenCode 2 TUI plugin. The server half (src/opencode-v2.js) decides what needs approval, but its
// Context has no client and no UI channel: OpenCode's permission dialog renders only the action name
// for a plugin-defined action ("Call tool jev-guard" / "Tool: jev-guard"), so the risk assessment's
// reasoning never reaches the user from there. The TUI-side Context does have `ui.toast`, and the ask
// itself carries the reason in `metadata` (permission.asked -> data.metadata.reason), so this entry
// turns every jev-guard ask into a toast that shows it.
import { Plugin } from "@opencode/plugin/tui";

export const ACTION = "jev-guard";

/** Toast the reasoning behind each ask the server half raises. */
export function setup(ctx) {
  const shown = new Set();  // request ids already toasted; one ask fires permission.asked once
  const off = ctx.data.on("permission.asked", ({ data }) => {
    if (data?.action !== ACTION || shown.has(data.id)) return;
    shown.add(data.id);
    if (shown.size > 200) shown.delete(shown.values().next().value);
    const reason = typeof data.metadata?.reason === "string"
      ? data.metadata.reason
      : `jev-guard: ${data.resources?.join(", ") ?? ACTION} needs approval`;
    ctx.ui.toast.show({ title: "jev-guard", message: reason, variant: "warning", duration: 8000, sessionID: data.sessionID });
  });
  return () => { off?.(); };
}

export default Plugin.define({ id: ACTION, setup });
