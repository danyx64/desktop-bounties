# DesktopBounties

A Vencord userplugin that exposes Discord's **mobile Quest Home Bounty creatives** on desktop.

The plugin mirrors Discord mobile's current Bounty delivery flow: `GET /quests/get-decisions` with `placement=5` (`VIDEO_MODAL_MOBILE`), `num_decisions_requested=5`, the native ad/heartbeat sessions, and the current connection type. Returned Bounty creatives use `creative_type=3`.

Discord's Bounty APIs, Quest Home modules and generated client classes are internal and may change. The plugin intentionally follows the currently shipped Discord client behavior where possible instead of inventing its own completion state.
