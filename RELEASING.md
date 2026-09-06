# Release qualification and retention

Release from a clean checkout of one reviewed commit. Preserve existing Git history.
Run `npm run qualify` against that exact commit before pushing or tagging it. Local
qualification is the normal gate; GitHub Actions Verify is manual-only and optional
as a second Linux environment.

Archive an already verified build on a host with Node.js, Git, and tar:

```sh
node scripts/archive-release.mjs dist /absolute/path/outside/repository/release-artifacts
```

Use a new empty output directory for each archive. The command refuses a dirty
checkout or an existing same-commit archive. Verify `SHA256SUMS` after transferring
an archive, and verify the contained files against `RELEASE.json` after extracting.
Rebuilds can have new timestamps: the archive hash identifies the exact deployed
bytes, while the commit identifies their source. Retain the last known good archive
for rollback instead of rebuilding it during an incident.

A manually run Verify workflow provides an independent Linux check using a synthetic
HMAC key and retains its qualified artifact for 90 days. It is optional and does not
replace local qualification of the active-key production build.

After all required checks pass, create an annotated release tag on that exact
commit and push the tag. Choose a unique version tag matching the release; never
move an existing tag. Record the tag, commit, archive hash, qualification run, and
actual deployment time together. Creating an archive or tag does not deploy it.
Do not change repository visibility as part of the build.

## Browser qualification

`npm run qualify` includes the production build, release verification, real Chromium
boot/save/restore, and offline PWA verification. `npm run qualify:browsers` is an
optional additional Chromium/Firefox/WebKit pass against the built `dist/pwa/`.
It checks resource preparation, game entry, real-tab save takeover, two service-worker
cache generations, offline Continue, and preservation of a newer public save. WebKit's
cache fallback is tested by dropping all connections to the origin; Playwright's
offline emulation has a known WebKit service-worker navigation limitation. Chromium
and Firefox also use browser offline emulation. The cache-generation fixture uses the
same candidate's assets with two worker identities; it does not claim compatibility
between arbitrary historical releases. Existing browser fixtures exercise real Main
save/restore.

Before the first deployment, record a short real-device pass on supported Safari/iOS
and Android devices: launch from the home screen, enter gameplay, exercise audio and
controls, background/foreground, save/Continue, and cold offline launch. Automated
WebKit is useful coverage but is not a real iOS device qualification. Record failures
and supported browser versions rather than claiming untested support.

Before a later release, keep the currently deployed build open with a real save,
serve the new build at the same deployment path, reload and Continue, then go offline
and Continue again. Test rollback against the same save. Never raise
`FIRST_PUBLIC_GAME_STATE_VERSION` to make an old client delete an unfamiliar save;
New Game and Reset are the explicit destructive paths. Close pre-ownership legacy
tabs during the first rollout, because an already-loaded older client cannot follow
the new single-session protocol.

## Ms. Pac-Man signing

The optional manual Verify workflow uses the explicitly synthetic full-build path and
fixture HMAC key. Its archive is marked `synthetic-test-not-for-deployment`; never
deploy it or relabel it as a production release. Build production `dist` with the
existing active-key release tooling, qualify those bytes, and archive that directory.
Keep the local key files and rotation state outside version control.

The active signing key is stored locally in
`.release-secrets/ms-pac-man-2010-hmac.hex`. This directory is ignored by Git.
When setting up a new checkout for an existing deployment, obtain the existing
primary server key privately and import it through the hidden input prompt:

```sh
npm run hmac:import
npm run hmac:check
```

Import is only needed when the active key file is absent. The check prints a
fingerprint, not the key. Confirm that the imported key matches the server's
primary key and that no rotation is staged before building:

```sh
npm run release
```

This produces the complete verified distribution in `dist/`: the about page,
signed PWA, desktop download, release metadata, and checksums. Upload the contents
of that directory while preserving its structure. Run these commands locally;
GitHub Actions is not required. On Windows PowerShell, use `npm.cmd` if needed.

Keep key files out of source control and uploaded source archives. Do not generate
a new key merely because a checkout lacks one; the client must use a key accepted
by the existing server. If rotation is staged, resolve that rotation before an
active-key release. The embedded client key is recoverable from distributed builds
and does not authenticate legitimate play.
