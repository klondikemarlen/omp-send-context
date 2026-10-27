# Troubleshooting

Use this quick reference to choose the next action. Product setup and behavior are documented in the [editor guide](editor.md) and [Firefox guide](firefox.md); Firefox release acceptance steps are in the [manual QA scenario](../qa-scenarios/firefox.md).

| Symptom                                                                 | Try this                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Editor shortcut does nothing                                            | Focus an editor with an open file; verify the shortcut under **File → Preferences → Keyboard Shortcuts** (macOS: **Code → Settings → Keyboard Shortcuts**) and check that `ompContext.insertMode` is set as intended.                                                                                                                                                                                 |
| Editor sends a smaller or larger packet than expected                   | Review `ompContext.insertMode` and `ompContext.contentMode`; `editorContext` plus `reference` is the smallest file-reference form.                                                                                                                                                                                                                                                                    |
| Editor sends to an unexpected OMP terminal                              | Run `/ide` in the intended terminal to select it once. It does not pin later routing; use `/ide status` to inspect the active endpoint and version.                                                                                                                                                                                                                                                   |
| Focus routing stops after a new-session attempt                         | Confirm `/ide status` in each console shows the updated plugin, then restart older processes. Enabled autofocus recovers even when another plugin cancels the transition; `/ide` remains a one-time selection and explicit rearm, not a prerequisite after every session change. For repeatable diagnosis, use the [focus lifecycle QA](/docs/qa-scenarios/omp-focus.md).                             |
| Context goes to a background terminal after another instance restarts   | Update the OMP plugin and restart older processes, including children managed by `ompi`. Focus the intended terminal, then send without a repair command. Capability replies, mouse reports, and focus-out must not select another console. Use the [independent restart QA](/docs/qa-scenarios/omp-focus.md#independent-terminal-restarts) to separate false activity from missing focus forwarding. |
| Editor/OMP update appears not to take effect                            | Restart every OMP console and reload the editor window. On OMP 18.11.1, `/reload-plugins` does not replace the loaded extension module. Confirm the version in the new process with `/ide status`.                                                                                                                                                                                                    |
| Firefox says the page is unsupported                                    | Use an ordinary HTTP(S) page and select non-empty text. Protected pages, Firefox internal pages, AMO, `file:` URLs, and empty selections are not eligible.                                                                                                                                                                                                                                            |
| Firefox says the OMP host is unavailable; clipboard receives the packet | This is the expected fallback when native messaging is unavailable or rejects delivery. Install/register the native host for direct delivery, start a fresh OMP process, and restart Firefox if needed.                                                                                                                                                                                               |
| Firefox native delivery is not working                                  | Confirm the extension ID `omp-send-context@klondikemarlen.github.io` is allowlisted in the native-host manifest. For Snap/Flatpak, confirm `xdg-native-messaging-proxy` is installed and the sandboxed registration command was run as the desktop user. Do not put the manifest in a sandbox-private directory.                                                                                      |
| Firefox delivers to another terminal after `/ide`                       | Update the separately installed Firefox native host; updating only OMP or the add-on does not replace it. Older pointer-only hosts can follow an outdated selection after another instance starts or stops. See [Firefox terminal selection](/docs/product/firefox.md#choose-the-omp-terminal).                                                                                                       |
| Firefox shortcut is intercepted or differs on this system               | Check **about:addons → Manage Extension Shortcuts**; the suggested defaults are `Ctrl+Alt+K` (Linux/Windows) and `Command+Alt+K` (macOS). Use the context-menu command as an alternative.                                                                                                                                                                                                             |
| Firefox debug log is empty or lacks recent events                       | Enable logging from the toolbar popup before reproducing. Logging is session-only and is cleared when Firefox restarts.                                                                                                                                                                                                                                                                               |
| GitHub packet lacks diff details                                        | Confirm the page is a GitHub pull request and the selection is within the visible diff. The page URL remains available when optional diff metadata cannot be extracted.                                                                                                                                                                                                                               |

## Suspend and partial restarts

Send Context 2.8.0 replaces a process-relative activity clock that could fall hours behind after Linux suspend. Install the update and restart every pre-2.8.0 OMP process once, including `ompi` children. Later protocol-compatible versions can coexist; restarting one does not require restarting its already-updated peers.

To inspect a bridge without claiming terminal focus, query its loopback health endpoint:

```bash
curl -fsS http://127.0.0.1:PORT/health
```

Replace `PORT` with the endpoint reported by that console's `/ide status`. Health reports the running plugin's `version`, `protocolVersion`, PID, and instance identity, without its bearer token. Older plugins may omit the new metadata; missing means unknown, not updated. `/ide status` itself is read-only, but typing in a console is activity, so collect endpoints before a focus-only reproduction. Do not share private registry records: they contain credentials.

If routing still fails after every process reaches the fixed baseline, preserve the distinction between physical focus forwarding and delivery: follow the [focus lifecycle QA](/docs/qa-scenarios/omp-focus.md) without running `/ide` to repair the target first.

## Global routing diagnostics

Send Context 2.9.0 adds optional passive diagnostics for intermittent wrong-terminal delivery. Enable it once for every updated OMP/`ompi` console:

```bash
omp plugin config set omp-send-context diagnostics true
```

Diagnostics default to off. After installing the update, restart each older OMP process once to load the feature; updating files or running `/reload-plugins` does not replace already-loaded code. Thereafter, running updated consoles follow the global setting without restarting, including consoles with autofocus disabled or forced on by a command-line flag. New consoles inherit it. This setting does not restart terminals or change model/provider configuration.

Run `/ide diagnostics` to inspect that console's recording state and log path. It does not start a missing bridge, select the console, or repair autofocus; typing any command is still ordinary keyboard activity. If a failure occurs, leave the failed consoles untouched before running this command or `/ide`.

Logs are local JSON Lines files under `~/.omp/agent/send-context-diagnostics/`, with a separate random filename for each plugin registration. The directory is private (`0700`) and files are private (`0600`). Each registration retains at most two files of 1 MiB each, the active `.jsonl` file and its `.jsonl.1` predecessor. Files remain after shutdown or disabling diagnostics so the failure evidence is preserved; remove old captures when no longer needed.

Capture includes lifecycle events, timestamps, PID and bridge identity, loaded version, session identity, subscription/guard state, activity claims, delivery outcomes, and coarse input categories. It excludes typed characters, prompt/context contents, bearer tokens, credentials, working directories, session-file paths, and arbitrary error text. Diagnostics never queries the terminal, generates input, claims routing, or repairs a subscription. Snapshot sampling reads local state without health probes; it is not proof of successful editor delivery.

After a misroute, report the approximate time, intended and actual `ompi` instance IDs, and whether a console was recently started or restarted. These controller IDs differ from the bridge identities in the logs. Preserve the relevant capture files before using `/ide` to recover, when practical. Review logs before sharing; session/process identities and timing are still metadata about your work.

Disable capture globally with:

```bash
omp plugin config set omp-send-context diagnostics false
```

Disabling stops diagnostic sampling and writing without changing routing or removing the existing logs. This feature gathers evidence for [the intermittent routing investigation](https://github.com/klondikemarlen/omp-send-context/issues/193); it is not a fix for that unresolved failure.
