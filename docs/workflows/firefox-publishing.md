# Publishing the Firefox Client

This guide covers publishing `firefox/` as a signed Firefox add-on through Mozilla Add-ons (AMO). The AMO add-on, VS Code/OMP package, and Firefox native-host Debian package are separate artifacts and follow their own release paths.

Official references:

- [AMO signing and distribution overview](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/)
- [Submitting an add-on](https://extensionworkshop.com/documentation/publish/submitting-an-add-on/)
- [`web-ext` command reference](https://extensionworkshop.com/documentation/develop/web-ext-command-reference/)
- [Firefox native messaging](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Native_messaging)

## Release boundary

- `firefox/manifest.json` and `firefox/package.json` carry the Firefox client version.
- `firefox/native-host/package.json` carries the Linux Firefox native messaging host version.
- `package.json` and `package-lock.json` carry the VS Code/OMP package version.
- `firefox/manifest.json` contains the stable extension ID `omp-send-context@klondikemarlen.github.io`.
- The Linux Firefox native messaging host manifest must allowlist that exact extension ID. Never change the ID casually; an ID change requires a coordinated host manifest update and a new AMO installation path.
- The Linux native messaging host is not uploaded to AMO. Ubuntu 26.04 (Resolute) users can install the packaged, statically linked Go host from `ppa:klondikemarlen/omp-send-context`; the package does not depend on Node.js. Source-checkout installation remains available for other distributions and development.

## Refresh listing documentation without a new add-on

For a description or documentation-link change, update `docs/firefox-amo-metadata.json`, review and merge that change, then edit only the existing listing metadata. AMO's [metadata edit API](https://mozilla.github.io/addons-server/topics/api/addons.html#edit) supports an authenticated `PATCH /api/v5/addons/addon/omp-send-context/` with translated `summary`, `description`, and `developer_comments` fields.

Use the existing local credential setup; never print credentials or generated authorization tokens. Do not send the metadata file's `version` block, sign/upload an unchanged XPI, or publish the native-host package for a listing-only edit. After the update, read the public listing back, verify its documentation links and concise copy, and confirm the add-on version is unchanged.

Keep current user-facing instructions in the product guide and link to it from the listing. Historical version release notes remain historical.

## Before publishing

1. Create a GitHub issue and issue-named branch.
2. Implement the client and open a pull request against `main`.
3. Install dependencies and run the reproducible checks:

   ```bash
   npm ci
   npm test
   npm run test:firefox-native-host
   npx web-ext lint --source-dir firefox --ignore-files 'native-host/**' 'native-host/' 'scripts/**' 'scripts/'
   ```

4. Install the Linux native-messaging host before interactive QA. For Ubuntu 26.04 (Resolute), add `ppa:klondikemarlen/omp-send-context`, run `sudo apt update && sudo apt install omp-send-context-firefox-host`, and use the package's system manifest for system Firefox. For Snap or Flatpak Firefox, first run `sudo apt install xdg-native-messaging-proxy`, then run `omp-send-context-install-firefox-host --sandboxed` as the normal desktop user. The sandboxed command must pass. Source-checkout installation remains `npm run install:firefox-host` or `npm run install:firefox-host -- --sandboxed`.
5. Start a fresh OMP process. Firefox may pick up the manifest and proxy registration live; reload the add-on or fully restart Firefox if needed. Run the [Firefox Manual QA](../qa-scenarios/firefox.md) flow in a fresh Firefox profile. Test cases 1–4 must be **PASS** with `native:succeeded`; test case 5 must be **PASS** with the expected clipboard fallback evidence.
6. Review the packaged source. Do not include credentials, local bridge state, test fixtures, or the native host in the Firefox add-on artifact.
7. Confirm the manifest's `browser_specific_settings.gecko.id`, minimum Firefox version, permissions, host scope, and `data_collection_permissions` are intentional.
8. Merge the implementation pull request only after review, automated checks, native-host registration, and interactive QA are complete.

## Publish the native-host PPA package

The native host package is built from `firefox/native-host/` as a Debian native source package. Create `ppa:klondikemarlen/omp-send-context` in Launchpad before the first upload, then build and sign from the release checkout:

```bash
cd firefox/native-host
dpkg-buildpackage -S -d -kYOUR_UPLOAD_KEY
dput ppa:klondikemarlen/omp-send-context ../omp-send-context-firefox-host_*.changes
```

Wait for Launchpad to build and publish `omp-send-context-firefox-host` for Ubuntu 26.04 (Resolute)/amd64 before publishing a matching changed AMO version. Verify the package's `InRelease` and package index are public, then test installation with `sudo apt install omp-send-context-firefox-host`.

For a native-host-only fix, leave the unchanged add-on and OMP/Marketplace versions alone. Update `firefox/native-host/package.json` and `firefox/native-host/debian/changelog` on the reviewed release branch after the implementation merge. Verify both the JavaScript source host and the compiled Go host, then run [multiple-session Firefox QA](/docs/qa-scenarios/firefox.md#7-multiple-omp-sessions) through Firefox's native-messaging API and inspect the actual destination prompt. The full capture/metadata/fallback cases remain required when the add-on changes.

After publication, observe the exact package version in the signed PPA index and install from that channel. Check the installed package version and the host executable selected by Firefox's manifest, then repeat native-message delivery using that installed executable. A locally compiled candidate or extracted package is useful pre-install QA, but is not proof of an apt/system installation. Missing sudo authentication blocks installation, not publication; report these outcomes separately.

## Build the AMO upload artifact

From the release checkout:

```bash
npm ci
npm run package:firefox
```

The command cleans `/tmp/omp-send-context-firefox`, builds one unsigned ZIP there, and prints its path and SHA-256. Upload that printed ZIP to the AMO submission form. The generated ZIP is disposable; do not commit it unless the repository release policy explicitly requires checked-in artifacts.

## Signed pre-release validation

AMO version numbers are unique across listed and unlisted channels. Do not submit a version as unlisted and then re-submit that same version as listed; AMO rejects the second submission after the first version is consumed.

For a normal listed release, run the manual QA flow in a fresh profile from the checkout with `web-ext run` or a temporary add-on, then submit that version through the listed channel. This is source-equivalent QA at the listed version; it does not validate AMO signing or the final downloaded XPI.

If signed-XPI QA is required before a listed submission, use a unique pre-release version for the unlisted submission, install its signed XPI in a fresh profile, and run the manual QA flow. Bump the version for the listed release, rebuild it, and repeat the focused fresh-profile install check; never attempt to reuse the unlisted version for the listed channel.

With AMO API credentials configured locally:

```bash
 AMO_CHANNEL=unlisted npm run sign:firefox
```

The signing script requires a clean Git worktree; it stages a temporary Firefox source tree and injects the full source commit into the exported debug log.

Do not submit the listed release until the selected QA path passes. Record whether the listed artifact was QA-tested directly or followed a distinct signed unlisted pre-release.

## Submit through AMO

1. Sign in to the [AMO Developer Hub](https://addons.mozilla.org/developers/).
2. Choose **Submit a New Add-on** for the first release, or open the existing add-on for a new version.
3. Upload the ZIP path printed by `npm run package:firefox` from `/tmp/omp-send-context-firefox/`.
4. Complete the listing metadata, support URL, privacy/data-collection declarations, and source-code submission requested by AMO.
5. Keep the stable extension ID unchanged.
6. Submit for signing/review. Record the AMO add-on URL and submitted version in the release record.

For repeatable command-line submission, configure the AMO API credentials through a local secret manager or ignored shell environment variables. Use the names below in `.envrc`; they are local aliases, not AMO-required variable names:

```bash
export AMO_API_ISSUER='your-AMO-issuer'
export AMO_API_SECRET='your-AMO-secret'
```

Submit the listed add-on with:

```bash
npm run sign:firefox
```

The script reads `AMO_API_ISSUER` and `AMO_API_SECRET`, passes them to web-ext through `WEB_EXT_API_KEY` and `WEB_EXT_API_SECRET`, applies [`firefox-amo-metadata.json`](../firefox-amo-metadata.json), excludes the Linux native-messaging host, and never prints the credentials.

Do not paste credentials into issue, pull-request, or release notes. If AMO requires human review, the release remains pending until AMO reports the signed/public result.

## Post-publish verification

1. Poll the AMO listing until the new version is visible.
2. In a fresh Firefox profile, install the published AMO add-on rather than the temporary checkout.
3. Confirm **about:addons** shows the expected extension name and version.
4. Install the matching Linux native-messaging host. For Ubuntu 26.04 (Resolute), install `omp-send-context-firefox-host` from `ppa:klondikemarlen/omp-send-context`; system Firefox uses the packaged system manifest. For Snap or Flatpak Firefox, install `xdg-native-messaging-proxy` with `sudo apt install xdg-native-messaging-proxy`, then run `omp-send-context-install-firefox-host --sandboxed` as the normal desktop user. Source-checkout installation remains available with `npm run install:firefox-host -- --sandboxed`. Require native delivery to report `native:succeeded`.
5. Start a fresh OMP process. Firefox may pick up the manifest and proxy registration live; reload the add-on or fully restart Firefox if needed. Run the [Firefox Manual QA](../qa-scenarios/firefox.md) test cases 1–4. Require `native:succeeded` for native-delivery cases.
6. Confirm test case 5 separately by temporarily making the Linux Firefox native messaging host unavailable and verifying the exact clipboard fallback.
7. Record the AMO URL, visible version, Firefox version, OMP version, Linux native-host version, host-install command result, and PASS/FAIL/BLOCKED results.

## Rollback

If the published add-on is defective:

1. Disable or unpublish the affected AMO version according to AMO’s current controls.
2. Restore the last known-good native host and OMP plugin versions.
3. Open a corrective issue and release a higher Firefox version; do not reuse the published version number.
4. Repeat linting, fresh-profile installation, and the manual QA flow before republishing.
