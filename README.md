# OMP Send Context

Send selected code from **VS Code or Devin Desktop**, or selected text and links from **Firefox**, to your [Oh My Pi (OMP)](https://github.com/can1357/oh-my-pi) prompt.

Context is sent only when you invoke a shortcut or command. It is inserted into your prompt for review—not submitted automatically. If delivery is unavailable, the client copies the context to your clipboard so you can paste it yourself.

## Install

Install the OMP plugin, then choose an editor or browser client.

### 1. Install the OMP plugin

Requires OMP **16.3.7 or newer**; optional Linux terminal-focus routing requires **16.5.1 or newer**.

```bash
omp plugin install github:klondikemarlen/omp-send-context
```

Start a fresh OMP process after installation.

### 2. Choose your client

**VS Code or Devin Desktop:** find **Oh My Pi Send Context** in your editor's Extensions view, or install from the [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=klondikemarlen.omp-send-context).

For VS Code:

```bash
code --install-extension klondikemarlen.omp-send-context
```

For Devin Desktop:

```bash
devin-desktop --install-extension klondikemarlen.omp-send-context
```

**Firefox:** install [OMP Send Context from Mozilla Add-ons](https://addons.mozilla.org/en-CA/firefox/addon/omp-send-context/). It works with selected text on eligible HTTP(S) pages, including GitHub pull requests. Firefox-protected pages and local files are excluded.

The add-on can copy context to your clipboard without additional setup. For direct delivery to OMP, install the separate Linux native-messaging host using the [Firefox setup guide](docs/product/firefox.md#install-the-linux-native-messaging-host).

## Send context

1. Start OMP and leave its prompt open.
2. Select code in your editor or text on a web page.
3. Press **Ctrl+Alt+K** on Linux/Windows or **Cmd+Alt+K** on macOS. In Firefox, you can also right-click and choose **Send selection and link to OMP**.
4. Review the context in OMP before submitting your prompt. If the client used clipboard fallback, paste it into OMP first.

Editor selections include a file reference and the selected text by default, plus the workspace root when available. Browser selections include the page link and title; GitHub pull-request selections retain richer source metadata.

Want a smaller editor packet? See [editor settings](docs/product/editor.md#choose-what-the-shortcut-sends).

## Choose an OMP terminal

With multiple OMP consoles open, run this in the console that should receive context:

```text
/ide
```

On Linux, supported terminal focus and keyboard activity also select the receiving console by default. `/ide` selects it once; it does not pin future routing.

To inspect the loaded plugin version and local endpoint:

```text
/ide status
```

See [routing and troubleshooting](docs/product/troubleshooting.md) if context reaches the wrong console or falls back to the clipboard.

## Update

Update the editor extension through its Extensions view and Firefox through its add-on manager. Update the OMP plugin with the same installation command:

```bash
omp plugin install github:klondikemarlen/omp-send-context
```

Restart every running OMP console and reload the editor window to use the updated code. If you still have the old `omp-vscode-context` package, follow the [migration instructions](docs/product/editor.md#install-or-update).

## Privacy

The bridge listens only on this machine and requires private authentication tokens. Source selections are captured only on an explicit command; Linux autofocus changes the receiving console, not what is captured. Context may include selected text, local paths, and optional editor diagnostics. Review it before sending it to your model.

Firefox does not persist page context or collect telemetry. Its opt-in debug log omits selected text, URLs, prompts, and bridge credentials. Read more about [Firefox privacy](docs/product/firefox.md#logging-and-privacy) and the [bridge security boundary](docs/architecture/context-bridge.md#security-and-privacy-boundaries).

## Learn more

- [Knowledge base](docs/README.md): product guides, architecture, developer workflows, and QA scenarios.
- [Editor guide](docs/product/editor.md): packet modes, settings, and terminal routing.
- [Firefox guide](docs/product/firefox.md): direct delivery, sandbox setup, and clipboard fallback.
- [Contributing locally](docs/workflows/development.md): checkout setup and verification.
- [Changelog](CHANGELOG.md) · [Report an issue](https://github.com/klondikemarlen/omp-send-context/issues)

If this project helps you, you can optionally support maintenance with a [Ko-fi tip](https://ko-fi.com/klondikemarlen).
