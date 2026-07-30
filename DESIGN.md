---
name: OMP Send Context
colors:
  surface: '#10141a'
  surface-dim: '#10141a'
  surface-bright: '#353940'
  surface-container-lowest: '#0a0e14'
  surface-container-low: '#181c22'
  surface-container: '#1c2026'
  surface-container-high: '#262a31'
  surface-container-highest: '#31353c'
  on-surface: '#dfe2eb'
  on-surface-variant: '#c6c6cd'
  inverse-surface: '#dfe2eb'
  inverse-on-surface: '#2d3137'
  outline: '#909097'
  outline-variant: '#45464d'
  surface-tint: '#bec6e0'
  primary: '#bec6e0'
  on-primary: '#283044'
  primary-container: '#131b2e'
  on-primary-container: '#7c839b'
  inverse-primary: '#565e74'
  secondary: '#c2c7cf'
  on-secondary: '#2c3137'
  secondary-container: '#42474e'
  on-secondary-container: '#b1b5bd'
  tertiary: '#67df70'
  on-tertiary: '#00390d'
  tertiary-container: '#002105'
  on-tertiary-container: '#0e9834'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#dae2fc'
  primary-fixed-dim: '#bec6e0'
  on-primary-fixed: '#131b2e'
  on-primary-fixed-variant: '#3f465b'
  secondary-fixed: '#dee3eb'
  secondary-fixed-dim: '#c2c7cf'
  on-secondary-fixed: '#171c22'
  on-secondary-fixed-variant: '#42474e'
  tertiary-fixed: '#83fc89'
  tertiary-fixed-dim: '#67df70'
  on-tertiary-fixed: '#002105'
  on-tertiary-fixed-variant: '#005317'
  background: '#10141a'
  on-background: '#dfe2eb'
  surface-variant: '#31353c'
typography:
  display-lg:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '700'
    lineHeight: 32px
    letterSpacing: -0.01em
  headline-md:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 24px
    letterSpacing: -0.005em
  body-base:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  body-bold:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '600'
    lineHeight: 20px
  code-mono:
    fontFamily: JetBrains Mono
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
  code-mono-bold:
    fontFamily: JetBrains Mono
    fontSize: 13px
    fontWeight: '600'
    lineHeight: 18px
  label-caps:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.05em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  base-unit: 4px
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 24px
  popup-width: 220px
  gutter: 12px
---

## Brand & Style

The design system for this developer tool is rooted in **Technical Minimalism**. It prioritizes extreme efficiency, low cognitive load, and visual integration with high-performance environments like VS Code and Firefox. The personality is professional, reliable, and utility-focused—acting as a seamless "first-party" bridge rather than a distracting third-party layer.

The aesthetic draws from **Corporate Modernism** and **Modern Terminal UI**. It utilizes a dark-mode-first approach with high-contrast elements to ensure readability during extended coding sessions. The style avoids decorative flourishes, favoring purposeful whitespace, crisp hairline borders, and a rigorous typographic hierarchy that distinguishes between UI controls and code-based payloads.

## Colors

The color palette is built on a foundation of "GitHub Slate" and "OMP Indigo," optimized for developer tools.

- **Primary (OMP Indigo):** Used for brand anchors, primary headers, and deep technical grounding.
- **Secondary (GitHub Slate):** Used for utility surfaces, secondary buttons, and toast backgrounds.
- **Tertiary (Terminal Green):** Reserved for status highlights, active connections, and primary action confirmations.
- **Neutral:** A range of deep grays (`#0D1117` to `#30363D`) for surfaces and borders to create depth without high-vibrancy noise.
- **Semantic Roles:**
  - **Success:** `#3FB950` (Terminal Green)
  - **Error:** `#F85149`
  - **Warning:** `#D29922`
  - **Info/Link:** `#58A6FF` (Electric Blue)

## Typography

This design system uses a dual-font strategy to separate UI navigation from technical content:
- **Inter:** The primary sans-serif for all interface elements, providing a modern and neutral legibility.
- **JetBrains Mono:** The monospace engine for code snippets, file paths, and terminal payloads.

**Implementation Details:**
- **Handoff Packets:** Use `code-mono` for all data payloads to maintain character alignment.
- **File References:** Use `code-mono-bold` with the `#58A6FF` (Electric Blue) color for `@path/to/file#LxCy` references.
- **Status Badges:** Use `label-caps` for internal states like `INLINE` or `REFERENCE`.

## Layout & Spacing

The layout model is **Contextual & Utility-Driven**, focusing on high-density information delivery.

- **Extension Popup:** Fixed width of `220px`. Content is vertically stacked with `8px` to `12px` gaps.
- **Grid:** No formal grid is used; instead, a strict 4px spacing rhythm ensures alignment. Elements use a standard `14px` inset padding from container edges.
- **Handoff Structure:** Modular linear hierarchy. Each section (`Active Editor`, `Workspace`, `Diagnostics`) is separated by double newlines in markdown or `24px` (xl) vertical spacing in the UI.
- **Responsiveness:** Primarily optimized for sidebar/popup widths and full-screen IDE editors.

## Elevation & Depth

Depth is conveyed through **Tonal Layering** and **Low-Contrast Outlines**.

- **Canvas (`#0D1117`):** The bottom-most layer.
- **Surface Layer (`#161B22`):** Used for secondary panels and modal popups.
- **Interactive Layers (`#21262D`):** Used for buttons and hovered states.
- **Borders:** Instead of heavy shadows, use `1px solid #30363D` (Subtle Slate) to define element boundaries.
- **Toasts:** Use a subtle, diffused shadow (`box-shadow: 0 2px 8px rgba(0,0,0,0.4)`) to elevate transient notifications above the technical UI.

## Shapes

The shape language is **Soft-Square**.

- **Default (`rounded-sm`):** 4px. Used for code blocks and input fields.
- **Standard (`rounded`):** 6px. Used for buttons, popup containers, and toast notifications.
- **Badges (`rounded-full`):** 9999px. Used for status indicators and chip elements.

This tight rounding preserves the "IDE-native" feel, where sharp corners are common but soft edges provide a modern touch.

## Components

### Buttons
- **Primary:** Surface background (`#21262D`), 1px border (`#8B949E`), left-aligned text. Hover state shifts background to `#30363D`.
- **Action:** Vibrant Terminal Green (`#3FB950`) border or text for "Send" or "Confirm" actions.

### Code Blocks
- **Fenced Blocks:** Triple-backtick containers with a `#161B22` background and `#30363D` border.
- **Metadata:** File references positioned directly above the block in Electric Blue mono text.

### Status Badges
- Compact pills with `label-caps` text.
- Colors: `success` (Terminal Green), `warning` (Amber), `error` (Red), or `neutral` (Slate).

### Input Fields
- Dark background (`#0D1117`), 1px slate border, Inter 14px text.
- Active state: 1px Electric Blue (`#58A6FF`) border.

### Toast Notifications
- Floating at the bottom-right. Secondary background (`#24292F`), 6px radius, containing a status icon and concise body text.