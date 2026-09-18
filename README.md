# DesktopBounties

A Vencord userplugin that exposes Discord's **mobile Quest Home Bounty creatives** on desktop.

The plugin follows Discord's current Bounty delivery flow with `GET /quests/get-decisions`, Discord's own runtime `VIDEO_MODAL_MOBILE` placement, a five-decision batch, native ad/heartbeat sessions and the current connection type. The Bounty creative type is also resolved from Discord's runtime enum instead of being tied only to a hardcoded number.

## Current behavior

- Adds **Bounties** directly below **Quests** in the Discord Home shortcut group
- Mirrors the native Quests row classes and dimensions so the sidebar item follows Discord's own sizing, spacing and theme
- Suppresses the native Quests selected state while the Bounties page is open
- Opens Bounties as a **full page**, not a modal
- Shows Discord's native **Orbs balance** directly in the Bounties page header, without wasting a separate toolbar row
- Has no manual refresh button; returning to the tab/window triggers a background refresh
- Shows **only Bounties that are still to complete**
- Does not show a completed/history section
- Does not show old Video Quest history
- Resolves Discord's current `VIDEO_MODAL_MOBILE` placement and `BOUNTY` creative type dynamically from the running client, with conservative numeric fallbacks
- Uses `/quests/get-decisions` as the primary list endpoint and the native desktop `/quests/decision` path only as a fallback when the list endpoint returns no Bounty
- Reuses Discord's native ad session, heartbeat session and connection context
- Never overrides or spoofs `X-Super-Properties`; requests keep the same client identity Discord already uses for the active account
- Uses the Bounty's **`video_hls` full stream** for playback in compact **9:16 portrait cards**
- Does **not** substitute the short `video_preview` clip when the full stream is unavailable
- Mirrors Discord mobile progress semantics by tracking the **maximum full-video playback timestamp** against `reward_timer_seconds`, instead of running a separate polling timer
- Coalesces overlapping focus/visibility refreshes into a single decision request and deduplicates repeated creative IDs
- Lazily initializes HLS players only when their portrait card is near the viewport and limits unnecessary buffering
- Uses Discord's native ad session for both delivery and claim, refreshing/reusing it at claim time exactly like the mobile client
- At the required watch time, sends Discord's creative reward claim request:
  `POST /quests/creatives/{creative_id}/claim-reward`
- Includes sealed decision metadata when Discord supplies it
- Removes a Bounty from the page after Discord accepts the claim
- Resumes an unfinished Bounty video from its saved playback position
- Refreshes Bounties and Orbs automatically when the Discord window/tab becomes active again
- Shows Discord's error and a retry button if a claim is rejected

## Reliability and compatibility

DesktopBounties intentionally avoids static Android version/build headers. Bounty requests go through Discord's own `RestAPI`, so authentication and client headers remain consistent with the rest of the running Discord session.

To reduce unnecessary traffic, decision responses are cached for Discord's response TTL when one is provided, overlapping refreshes are coalesced, duplicate creative IDs are removed, and a fallback decision request only runs when the primary Bounty list contains no Bounty.

The repository includes a GitHub Actions compatibility workflow that builds the plugin against the latest Vencord, runs the TypeScript checker, ESLint and Stylelint.

## Localization

DesktopBounties follows Discord's current locale and updates when the Discord language changes. The plugin UI includes translations for the locale set currently shipped by Discord desktop, including English, Italian, German, French, Spanish, Portuguese, Russian, Ukrainian, Polish, Turkish, Japanese, Korean, Chinese, Hindi and the other supported Discord locales. Numbers and percentages use the active locale's formatting rules.

Server-provided advertiser, product and CTA text is left untouched so Discord can supply the campaign's own localized copy.

## Full video behavior

Discord Bounty creatives expose both preview media and a `video_hls` asset. DesktopBounties intentionally uses `video_hls` as the playable video. The short preview asset is never used to advance completion progress. The player is presented in a portrait 9:16 surface; horizontal source video uses `object-fit: contain` so the full ad is visible instead of being cropped.

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
├── i18n.ts
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
