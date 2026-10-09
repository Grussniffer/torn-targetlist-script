# NWA Target Finder

Find chain targets for **North West Alliance**.

## Install

[**Install NWA Target Finder**](https://raw.githubusercontent.com/Grussniffer/torn-targetlist-script/codex/initial/dist/torn-targetlist.user.js)

### Tampermonkey

1. Install [Tampermonkey](https://www.tampermonkey.net/) in your browser.
2. Click the **Install NWA Target Finder** link above and confirm **Install** in Tampermonkey.
3. Reload Torn.

On Chrome, enable **Allow User Scripts** in Tampermonkey's extension settings ([help](https://www.tampermonkey.net/faq.php?ext=dhdg&q=Q209)).

![Chrome Allow User Scripts switch enabled in Tampermonkey's official help screenshot](docs/images/tampermonkey-allow-user-scripts.png)

*Chrome screenshot from [Tampermonkey's official help](https://www.tampermonkey.net/faq.php?ext=dhdg&q=Q209).*

### Torn PDA

1. Open **Settings → Advanced Browser Settings** and turn on **Enable custom user scripts**.
2. Open **Manage scripts → +**. Tap **Configure** beside **Remote load/update**, and enter this link in **Remote URL**:

   ```text
   https://raw.githubusercontent.com/Grussniffer/torn-targetlist-script/codex/initial/dist/torn-targetlist.user.js
   ```

3. Tap **Fetch → Load**, choose **Continue** if permissions appear, and reload Torn inside PDA.

## Start

Open Torn and click the green **NWA** button on the right edge. Sign in with your **Limited Torn API key** the first time.

NWA finds a target within your stat limit, checks availability, and opens its attack page. You start the attack yourself. If a target is unavailable, NWA tries another match, checking up to five per click.

The small **⚙** underneath opens settings, the target list, and suggestions. Your stat limit is saved between pages.

<img src="docs/images/nwa-controls.png" width="720" alt="Actual NWA controls with arrows: NWA finds a target and the gear underneath opens settings">

<img src="docs/images/nwa-login.png" width="720" alt="Actual NWA sign-in panel: enter your Limited Torn API key and tap Sign in">

The backend is already set to [targetlist.grusmedia.no](https://targetlist.grusmedia.no). You only need your Torn key.

## Use

- **Targets:** browse the list or filter by estimated stats.
- **Check status:** check a target before opening its attack page.
- **Suggestions:** suggest a player or faction with a required comment.
- **Approvals:** faction leaders and co-leaders can approve or reject suggestions.

Your key is sent to the backend and Torn for login and kept only in backend memory for your session. The script saves a session token so you can stay signed in for up to **7 days**. A backend restart requires signing in again. Only allowed factions can use the list. Battle stats are estimates; attacks are manual.

Disable any separate old **Torn Faction Target List** entry. Your installed version appears in the settings header.
