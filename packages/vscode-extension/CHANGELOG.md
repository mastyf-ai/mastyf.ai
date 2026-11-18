# Changelog

## 0.2.0

- Turn on protection from the editor: with Shield 0.6 or later, the command asks Shield to protect your agents (Shield's own switch), then offers to reload the window. Turning protection off stays in Shield.
- Open Shield brings a running Shield 0.6+ to the front at Account → Protection.
- Each block shows the agent that made the call (Shield 0.6+), and "this editor only" uses it. Older Shield: server names, as before.
- Only Shield's own answer counts as Shield; another program on Shield's port no longer does. Requests never follow a redirect.
- The poll interval is capped at an hour (a very large value used to make it poll constantly).
- Listing: Shield is Mastyf's paid app; the free checks are the `mastyf-ai` and `@mastyf_ai/guard` libraries.

## 0.1.0 (preview)

- Status bar: whether this editor's MCP servers are routed through Mastyf Shield.
- Blocked calls panel: what Shield stopped, with the check, rule, matched words and argument.
- Notifications for new blocks from this editor's servers.
- Turn on protection: the steps, and a button to open Shield.
