# Torn Faction Target List userscript

A Torn userscript that shows shared chain targets, compares their estimated battle stats with yours, and lets members suggest players or factions for approval. This repository contains the installable script, its source, and browser/client tests. The separate [backend repository](https://github.com/Grussniffer/torn-targetlist-backend) contains the Torn verification service, Supabase migrations, and hosting configuration.

## Install

The installable file is [`dist/torn-targetlist.user.js`](dist/torn-targetlist.user.js). Install it in Tampermonkey, then visit Torn and open **Target list** in the lower-right corner.

While this repository is private, each person needs GitHub access to download the file. Open that file while signed into GitHub and use **Raw** if your userscript manager offers to install it. Otherwise download the file and open/import it in Tampermonkey, or paste its contents into a new userscript and save. Private GitHub raw links do not provide a dependable shared update URL, so distribute later builds through the same authenticated download/import process. Do not put GitHub access tokens in userscript metadata or URLs.

The current build connects to `https://targetlist.grusmedia.no`. That service must be running and its Supabase tables configured before login can succeed. Creating these repositories does not deploy the backend.

## Sign in and use targets

Sign in with your 16-character **Limited Torn API key**. The backend verifies the key, reads your name, faction and battle stats, and checks that your faction is enabled in the allowed-factions table. Public, Minimal, Full and Custom keys are rejected. The script saves only a short-lived session token in the userscript manager; it does not save your Torn API key locally. The backend retains the key in memory for the session, normally 30 minutes, and removes it on logout, expiry or revoked access.

Target cards show estimated total stats, their source and age, and a comparison with your total. Unknown or old estimates remain visible under **All**. **Possible matches** selects recent estimates at or below the selected percentage of your stats; the default is 60%, with a seven-day estimate age limit. This is a rough comparison, not a prediction that you will win.

Use **Check status** before attacking. The **Attack** link appears only after a current check reports `Okay`, and lasts 60 seconds. Your own player, your faction, and other configured allowed factions are protected. Every attack is selected manually; the script opens Torn's attack page and does not perform attacks automatically.

## Suggest players and factions

Any signed-in member of an allowed faction can open **Suggestions**, choose **Player** or **Faction**, enter the Torn ID, and provide a mandatory comment explaining why the target should be added. Comments are trimmed and limited to 1,000 characters. The pending queue is shared by allowed factions; **My suggestions** also shows your completed proposals.

Current faction leaders and co-leaders of any allowed faction can approve or reject suggestions. The backend verifies the actual Torn leader/co-leader IDs on every decision. An approved player joins the shared pool; an approved faction imports its current roster and preserves individually disabled members. Targets are added only after approval. Scheduled roster updates belong to the backend's future part 2 work.

## Change the service address

1. Set `CONFIG.serviceUrl` in [`src/app.js`](src/app.js) to the backend's direct HTTPS URL.
2. Add the hostname to `@connect` in [`src/metadata.txt`](src/metadata.txt).
3. Rebuild with `npm run build` and distribute the updated file in `dist/`.

The request helper rejects redirects. Keep Supabase server secrets and the operator's registered FFScouter key on the backend; users need only their own Limited Torn key. Local development may use the permitted loopback HTTP addresses.

## Build and check

Use Node.js 24 or later. Building, syntax checking, and unit tests need no installed packages:

```sh
npm run build
npm run check
npm test
```

For the mocked desktop/mobile browser checks, install the development dependency and Chromium first:

```sh
npm install
npx playwright install chromium
npm run test:browser
```

On a Linux environment that needs browser system libraries, use `npx playwright install --with-deps chromium`. To use an existing compatible browser, set `TARGETLIST_BROWSER_PATH` to its full executable path. Tests never call Torn, FFScouter, or a live backend. Browser screenshots go to ignored `artifacts/` and are labelled **MOCK API DATA**.

The committed `dist/torn-targetlist.user.js` is generated from metadata, core logic, and the app source. CI rebuilds it and checks that it matches the committed file, then runs syntax, unit, and mocked browser checks. Commit a rebuilt distribution whenever source or metadata changes. Playwright is a development dependency only; installed users need no Node.js packages.

Tampermonkey is the supported installation target. The responsive panel has desktop/mobile mock coverage; Torn PDA's userscript APIs and redirect handling still need on-device validation.
