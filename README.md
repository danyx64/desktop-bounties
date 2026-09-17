# DesktopBounties

A Vencord userplugin that exposes Discord's **mobile Quest Home Bounty creatives** on desktop.

The plugin requests Discord's authenticated Quest decision endpoint using the mobile Quest Home placement (`placement=4`) and renders returned Bounty creatives (`creative_type=3`) inside Discord's Quest Home route.

## Current behavior

- Adds **Bounties** directly below **Quests** in the Discord Home shortcut group
- Mirrors the native Quests row classes and dimensions so the sidebar item follows Discord's own sizing, spacing and theme
- Suppresses the native Quests selected state while the Bounties page is open
- Opens Bounties as a **full page**, not a modal
- Shows the current **Orbs balance** in the top-right corner
- Shows **only Bounties that are still to complete**
- Does not show a completed/history section
- Does not show old Video Quest history
- Requests up to 15 Bounty decisions in the current Discord response
- Uses the Bounty's **`video_hls` full stream** for playback
- Does **not** substitute the short `video_preview` clip when the full stream is unavailable
- Tracks the configured `reward_timer_seconds` only while the full HLS video is actually playing, Discord is visible, and the window is focused
- Reuses the same client ad session for the decision and claim flow
- At the required watch time, sends Discord's creative reward claim request:
  `POST /quests/creatives/{creative_id}/claim-reward`
- Includes sealed decision metadata when Discord supplies it
- Removes a Bounty from the page after Discord accepts the claim
- Refreshes the Orbs balance after a successful claim
- Shows Discord's error and a retry button if a claim is rejected

## Full video behavior

Discord Bounty creatives expose both preview media and a `video_hls` asset. DesktopBounties intentionally uses `video_hls` as the playable video. The short preview asset is never used to advance completion progress.

If a Bounty is returned without a playable full HLS stream, the card stays visible with its image and reports that the full video is unavailable instead of playing a short preview as though it were the complete ad.

## Install as a Vencord userplugin

Clone this repository into your Vencord source tree as:

```text
src/userplugins/desktopBounties/
```

The directory contains:

```text
src/userplugins/desktopBounties/
├── index.tsx
├── core.ts
├── ui.tsx
├── styles.css
└── README.md
```

Update and rebuild with:

```bash
cd ~/Vencord/src/userplugins/desktopBounties
git pull
cd ../../..
pnpm build
```

Then fully restart Discord and enable **DesktopBounties** in Vencord's plugin settings.

You can open the page from the Home sidebar or with:

```text
/bounties
```

## Notes

Discord's Bounty APIs, Quest Home modules and generated client classes are internal and may change. The plugin intentionally follows the currently shipped Discord client behavior where possible instead of inventing its own completion state.
