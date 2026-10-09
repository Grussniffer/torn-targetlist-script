# Torn Target List

Find chain targets that match your stats.

## Install

1. Download [`torn-targetlist.user.js`](dist/torn-targetlist.user.js) and import it into Tampermonkey.
2. Open Torn and click **Target list** in the lower-right corner.
3. Sign in with your **Limited Torn API key**.

The backend address is already set to **https://targetlist.grusmedia.no**. No server address or FFScouter key needs entering in the script.

While this repository is private, sign into GitHub with access to download it. Import newer downloads to update your script.

## Use

- **Targets:** browse the list or filter by estimated stats.
- **Check status:** check a target before opening its attack page.
- **Suggestions:** suggest a player or faction with a required comment.
- **Approvals:** faction leaders and co-leaders can approve or reject suggestions.

Your key is sent to the backend and Torn for login and kept only for your session. Only allowed factions can use the list. Battle stats are estimates; attacks are manual.

## Development

Use Node.js 24 or later. Build and run the checks:

```sh
npm run build
npm run check
npm test
```

For the mocked desktop/mobile browser checks:

```sh
npm install
npx playwright install chromium
npm run test:browser
```

An existing Chromium browser can be selected with `TARGETLIST_BROWSER_PATH`. Rebuild and commit `dist/torn-targetlist.user.js` after source changes. Browser tests use mock data and save screenshots in ignored `artifacts/`.

The separate [backend repository](https://github.com/Grussniffer/torn-targetlist-backend) contains server setup, Supabase configuration and FFScouter integration. Keep server secrets there. Tampermonkey is supported; Torn PDA still needs device testing.
