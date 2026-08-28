# WILLEM_CHECKLIST — the human gates left after the mini migration build

Everything below needs you specifically (a login, a device in your hand, or a judgment call). Everything else from the spec is built, tested, and running. The app lives at https://spoton-worker.tail6e1056.ts.net — username `willem`, password in Bitwarden under "Command Center mini (live) — willem".

## Phone bring-up (spec A6)
1. On your iPhone, open the Tailscale app and set VPN On Demand to Always, for both Wi-Fi and Cellular.
2. In Safari, open https://spoton-worker.tail6e1056.ts.net, sign in, and use Share, then "Add to Home Screen".
3. Open the home-screen app, go to Settings, Notifications, and tap Enable Push (the permission prompt must come from your tap).
4. Ask any planner to send a test notification (or just wait for the weekly Monday self-test at 9:00) and confirm it lands on the lock screen; tapping it should open the right session.

## Desktop push on KEG and SILO
5. On each machine, open the same URL in the browser, sign in, and enable push in Settings, Notifications. Web push shows up as a native Windows notification.

## Seed browser logins (spec 7)
6. Tell any worker "seed the browser logins" — it launches the seed Chrome profile (~/browser-profiles/_seed), fills each of QuickBooks, Google, AccuLynx, and Enzy from the saved logins itself, and only pings you when a site challenges. Your part is answering those challenges once: AccuLynx emails a code to the admin inbox, and Google or Intuit may ask for 2FA on a brand-new browser. The profile keeps every session afterward.
7. AccuLynx follow-up: once that login exists, tell any session "mint the AccuLynx API key and vault it" — the skill now documents the whole path and it finishes without you. This is the one unverified item from the build (everything needed an API key that only exists behind that one-time code).

## One-time re-auths on the mini
8. Railway CLI: run `railway login` in a terminal on the mini (the old token expired). Until then, workers cannot read Railway variables from this machine.

## Backup first delivery (spec A9)
9. The nightly 3:30am backup archives ~/.claude and ~/.command-center locally and delivers off-mini via Taildrop to SILO or KEG — but the whole fleet was offline during the build, so no delivery has happened yet. Power on SILO (or KEG) overnight once and accept the incoming Taildrop file; after that it is automatic any night a machine is on.

## Acceptance items you wanted eyes on (spec 11)
10. OTP round-trip: the next time a login wall wants a code during a real run, you get a decision-needed notification and answer it in chat — try it once end to end.
11. Dev-verify-promote eyeball: next frontend change, let the worker build on dev (port 8443 route of the same URL), look at it, then say promote.
12. The cutover call: when the system has run real work for a stretch and you are happy, demote KEG and SILO to browsers. Their local installs stay untouched as the rollback path until you say otherwise.

## Done without you (for the record)
- Voice-from-phone loop: proven by the automated acceptance run (compile, dispatch, chain, wake, verify, verified-done); the only untested link is your phone's mic, which item 2 gives you.
- Every phase of the build is logged one line per phase in MIGRATION.md, with commit hashes.
