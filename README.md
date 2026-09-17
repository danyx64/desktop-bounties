# DesktopBounties

A Vencord userplugin that exposes Discord's **mobile Quest Home Bounty creatives** on desktop.

The plugin requests Discord's authenticated Quest decision endpoint using the mobile Quest Home placement (`placement=4`) and displays returned Bounty creatives (`creative_type=3`).

## Features

- Adds a **Bounties** row directly below **Quests** in Discord Home
- Uses a target-style Bounties icon and integrates the row into Discord's virtualized Home/DM list
- Fetches Bounties through the logged-in Discord session with Vencord's `RestAPI`
- Shows product/advertiser information and image/video assets returned by Discord
- Shows real watch progress based on `reward_timer_seconds`
- Watch progress advances only while the Bounty video is actually playing and the Discord window is visible and focused
- Reuses a client ad session ID for the decision and reward flow
- Once the required watch time is reached, sends Discord's creative reward claim request:
  `POST /quests/creatives/{creative_id}/claim-reward`
- Includes the decision metadata returned by Discord when claiming
- Displays Discord's error if the server rejects the claim, with a **Retry claim** button
- Keeps `/bounties` as a fallback command

## What it does not do

DesktopBounties does **not** fake a completed Bounty, spoof region/account eligibility, or mark a reward completed only on the client. The UI only shows **Completed** after Discord accepts the reward claim request.

If Discord requires additional mobile-only attribution or heartbeat state that is not present in the desktop session, the server may reject the claim. In that case the plugin shows the server error rather than pretending the Bounty completed.

## Install as a Vencord userplugin

Clone this repository into your Vencord source tree as:

```text
src/userplugins/desktopBounties/
```

The directory should contain:

```text
src/userplugins/desktopBounties/
├── index.tsx
├── styles.css
└── README.md
```

Then rebuild your Vencord source build and enable **DesktopBounties** in Vencord's plugin settings.

Typical update flow:

```bash
cd src/userplugins/desktopBounties
git pull
cd ../../..
pnpm build
```

Restart Discord after rebuilding.

## Usage

Open Discord Home. A **Bounties** entry should appear immediately below **Quests**. Click it to load the Bounties that Discord returns for your account.

You can also use:

```text
/bounties
```

While a Bounty video is playing, the progress bar shows how many required seconds have been watched. Reaching 100% triggers the server-side reward claim. A successful Discord response marks it completed; a rejected request shows the actual error.

## Notes

Discord's Bounty APIs, client modules, and response shapes are internal/unstable and may change without notice. Because the sidebar integration patches Discord's Home/DM list, a Discord update can require updating the patch target.
