# Torn Target List

Find chain targets that match your stats.

## Install

Open the [script](dist/torn-targetlist.user.js) and copy all its code. Sign into GitHub with access to this private repository first.

### Tampermonkey

1. Install [Tampermonkey](https://www.tampermonkey.net/) in your browser.
2. Open its **Dashboard** and click **Add a new script**.
3. Replace the starter code with the copied script, save it, and make sure it is enabled.

On Chrome, enable **Allow User Scripts** in Tampermonkey's extension settings ([help](https://www.tampermonkey.net/faq.php?ext=dhdg&q=Q209)).

### Torn PDA

1. Open **Settings → Advanced Browser Settings** and turn on **Enable custom user scripts**.
2. Open **Manage scripts**, tap **+**, and paste the copied script into **Paste source code**.
3. Leave **Injection time** at **END**, tap **Add**, make sure the script is enabled, and reload Torn inside PDA.

Torn PDA still needs testing on a device.

## Start

Open Torn, click **Target list** in the lower-right corner, and sign in with your **Limited Torn API key**.

The backend is already set to [targetlist.grusmedia.no](https://targetlist.grusmedia.no). You only need your Torn key.

## Use

- **Targets:** browse the list or filter by estimated stats.
- **Check status:** check a target before opening its attack page.
- **Suggestions:** suggest a player or faction with a required comment.
- **Approvals:** faction leaders and co-leaders can approve or reject suggestions.

Your key is sent to the backend and Torn for login and kept only for your session. Only allowed factions can use the list. Battle stats are estimates; attacks are manual.
