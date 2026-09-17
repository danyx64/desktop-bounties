# DesktopBounties

A Vencord userplugin that exposes Discord's **mobile Quest Home Bounty creatives** on desktop and gives them a dedicated desktop UI.

The plugin requests Discord's authenticated Quest decision endpoint using the mobile Quest Home placement (`placement=4`) and renders returned Bounty creatives (`creative_type=3`) inside Discord's normal Quest Home route.

## Features

- Adds **Bounties** directly below **Quests** in the Discord Home shortcut group
- Uses a Discord-style target icon, hover state and selected state instead of a custom outlined button
- Opens Bounties as a **full page** inside `/quest-home`, not as a modal
- Shows the current **Orbs balance** in the top-right corner
- Provides separate **Available**, **In Progress**, and **Completed** views
- Makes completed Bounties obvious with a completion overlay, check badge and green completion progress
- Keeps successfully claimed Bounties in a local Completed history even if Discord stops returning that creative later
- Fetches Bounties through the logged-in Discord session with Vencord's `RestAPI`
- Shows product/advertiser information and image/video assets returned by Discord
- Tracks watch progress from `reward_timer_seconds`
- Watch progress advances only while the Bounty video is actually playing and the Discord window is visible and focused
- Reuses a client ad session ID for the decision and reward flow
- Once the required watch time is reached, sends Discord's creative reward claim request:
  `POST /quests/creatives/{creative_id}/claim-reward`
- Includes the sealed decision metadata returned by Discord when claiming
- Refreshes the Orbs balance after a successful claim
- Displays Discord's actual error if the server rejects the claim, with a **Retry claim** button
- Keeps `/bounties` as a shortcut to the dedicated page

## Completion behavior

DesktopBounties does **not** fake a completed Bounty. A card is marked **Completed / Claimed on Discord** only after the creative reward claim request succeeds.

If Discord requires additional attribution state that is not available in the desktop session, the server may reject the request. The plugin shows that error rather than pretending the Bounty completed.

## Install as a Vencord userplugin

Clone this repository into your Vencord source tree as:

```text
src/userplugins/desktopBounties/
```

The directory should contain:

```text
src/userplugins/desktopBounties/
├── index.tsx
├── core.ts
├── ui.tsx
├── styles.css
└── README.md
```

Then rebuild your Vencord source build and enable **DesktopBounties** in Vencord's plugin settings.

Typical update flow:

```bash
cd ~/Vencord/src/userplugins/desktopBounties
git pull
cd ../../..
pnpm build
```

Restart Discord after rebuilding.

## Usage

Open Discord Home. **Bounties** appears in the same shortcut group as Friends, Nitro, Shop and Quests, directly below Quests.

Click **Bounties** or run:

```text
/bounties
```

The dedicated page shows your Orbs balance, Bounty status tabs and cards. Start a video to move a Bounty into **In Progress**. Reaching the required watch time triggers the server-side claim. After Discord accepts it, the Bounty moves to **Completed**.

## Notes

Discord's Bounty APIs, Quest Home modules, and response shapes are internal/unstable and may change without notice. The plugin patches the Quest Home route and the Home/DM shortcut list, so Discord client updates can require updating the patch targets.
