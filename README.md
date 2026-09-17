# DesktopBounties

A Vencord userplugin that exposes Discord's **mobile Quest Home Bounty creatives** on desktop.

The plugin requests Discord's authenticated Quest decision endpoint using the mobile Quest Home placement (`placement=4`) and displays returned Bounty creatives (`creative_type=3`) in a desktop modal.

## Features

- Fetches Bounties using the logged-in Discord session through Vencord's `RestAPI`
- Shows product/advertiser information
- Shows image/video previews when supplied by Discord
- Opens the campaign CTA in the system browser
- Includes a small diagnostic footer with returned decision/creative counts
- Does **not** spoof region, account eligibility, targeting, device identity, or rewards

## Install as a Vencord userplugin

Clone this repository into your Vencord source tree as:

```text
src/userplugins/desktopBounties/
```

The directory should contain:

```text
src/userplugins/desktopBounties/
├── index.tsx
└── styles.css
```

Then rebuild Vencord using your normal source-build workflow and enable **DesktopBounties** in Vencord's plugin settings.

## Usage

Run the built-in Discord command:

```text
/bounties
```

A modal will open and request the mobile Quest Home Bounty placement from Discord.

If Discord returns no Bounty creatives for the account, the plugin will show that explicitly along with the number/types of decisions returned.

## Notes

Discord's Bounty APIs and internal response shapes are undocumented/unstable and may change without notice. This plugin intentionally stays close to the data returned by Discord instead of attempting to bypass eligibility or targeting.
