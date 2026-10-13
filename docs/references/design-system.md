# Design system reference

This reference preserves the intended visual tokens for the extension's compact interfaces. It is design guidance, not an inventory of styles implemented by every client. Consult each component's source before asserting current rendered behavior.

## Color tokens

| Token                        | Value     |
| ---------------------------- | --------- |
| `surface`                    | `#10141a` |
| `surface-dim`                | `#10141a` |
| `surface-bright`             | `#353940` |
| `surface-container-lowest`   | `#0a0e14` |
| `surface-container-low`      | `#181c22` |
| `surface-container`          | `#1c2026` |
| `surface-container-high`     | `#262a31` |
| `surface-container-highest`  | `#31353c` |
| `on-surface`                 | `#dfe2eb` |
| `on-surface-variant`         | `#c6c6cd` |
| `inverse-surface`            | `#dfe2eb` |
| `inverse-on-surface`         | `#2d3137` |
| `outline`                    | `#909097` |
| `outline-variant`            | `#45464d` |
| `surface-tint`               | `#bec6e0` |
| `primary`                    | `#bec6e0` |
| `on-primary`                 | `#283044` |
| `primary-container`          | `#131b2e` |
| `on-primary-container`       | `#7c839b` |
| `inverse-primary`            | `#565e74` |
| `secondary`                  | `#c2c7cf` |
| `on-secondary`               | `#2c3137` |
| `secondary-container`        | `#42474e` |
| `on-secondary-container`     | `#b1b5bd` |
| `tertiary`                   | `#67df70` |
| `on-tertiary`                | `#00390d` |
| `tertiary-container`         | `#002105` |
| `on-tertiary-container`      | `#0e9834` |
| `error`                      | `#ffb4ab` |
| `on-error`                   | `#690005` |
| `error-container`            | `#93000a` |
| `on-error-container`         | `#ffdad6` |
| `primary-fixed`              | `#dae2fc` |
| `primary-fixed-dim`          | `#bec6e0` |
| `on-primary-fixed`           | `#131b2e` |
| `on-primary-fixed-variant`   | `#3f465b` |
| `secondary-fixed`            | `#dee3eb` |
| `secondary-fixed-dim`        | `#c2c7cf` |
| `on-secondary-fixed`         | `#171c22` |
| `on-secondary-fixed-variant` | `#42474e` |
| `tertiary-fixed`             | `#83fc89` |
| `tertiary-fixed-dim`         | `#67df70` |
| `on-tertiary-fixed`          | `#002105` |
| `on-tertiary-fixed-variant`  | `#005317` |
| `background`                 | `#10141a` |
| `on-background`              | `#dfe2eb` |
| `surface-variant`            | `#31353c` |

## Typography

| Style            | Font           | Size | Weight | Line height | Letter spacing |
| ---------------- | -------------- | ---- | ------ | ----------- | -------------- |
| `display-lg`     | Inter          | 24px | 700    | 32px        | -0.01em        |
| `headline-md`    | Inter          | 18px | 600    | 24px        | -0.005em       |
| `body-base`      | Inter          | 14px | 400    | 20px        | —              |
| `body-bold`      | Inter          | 14px | 600    | 20px        | —              |
| `code-mono`      | JetBrains Mono | 13px | 400    | 18px        | —              |
| `code-mono-bold` | JetBrains Mono | 13px | 600    | 18px        | —              |
| `label-caps`     | Inter          | 11px | 600    | 16px        | 0.05em         |

Use monospace styles for payloads and file references, and `label-caps` for compact state labels when applying this system.

## Shape and spacing

- Base spacing unit: `4px`; `xs` 4px, `sm` 8px, `md` 12px, `lg` 16px, `xl` 24px.
- Radius tokens: `sm` 0.125rem, default 0.25rem, `md` 0.375rem, `lg` 0.5rem, `xl` 0.75rem, `full` 9999px.
- Popup width: `220px`; gutter: `12px`.
- The intended shape language is soft-square: compact rounding for controls and surfaces, fully rounded status badges.

## Component guidance

- Use tonal surfaces and subtle outlines to separate layers instead of relying on heavy shadows.
- Keep controls and labels compact; reserve accent colors for meaningful actions or status.
- Keep handoff payloads and file references visually distinct from interface labels.
- A popup is designed for a narrow, fixed-width surface; do not assume this layout fits other clients unchanged.

These statements describe intended design, not proof that a component uses every token. For current implementation examples, see the repository's [Firefox popup](https://github.com/klondikemarlen/omp-send-context/blob/main/firefox/popup.html) and its [page notification](https://github.com/klondikemarlen/omp-send-context/blob/main/firefox/content.js). Source links target the repository because the runtime package does not include the Firefox client. If actual styling and this reference differ, use the owning UI source as evidence of current rendering and update the reference when a design decision is intentional.

Related product context: [context bridge architecture](../architecture/context-bridge.md).
