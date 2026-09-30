---
name: Local AI Studio
colors:
  surface: '#0e131d'
  surface-dim: '#0e131d'
  surface-bright: '#343944'
  surface-container-lowest: '#090e18'
  surface-container-low: '#171c26'
  surface-container: '#1b202a'
  surface-container-high: '#252a35'
  surface-container-highest: '#303540'
  on-surface: '#dee2f1'
  on-surface-variant: '#c2c6d6'
  inverse-surface: '#dee2f1'
  inverse-on-surface: '#2b303b'
  outline: '#8c909f'
  outline-variant: '#424754'
  surface-tint: '#adc6ff'
  primary: '#adc6ff'
  on-primary: '#002e6a'
  primary-container: '#4d8eff'
  on-primary-container: '#00285d'
  inverse-primary: '#005ac2'
  secondary: '#c0c1ff'
  on-secondary: '#1000a9'
  secondary-container: '#3131c0'
  on-secondary-container: '#b0b2ff'
  tertiary: '#4edea3'
  warning: '#f59e0b'
  on-tertiary: '#003824'
  tertiary-container: '#00a572'
  on-tertiary-container: '#00311f'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#d8e2ff'
  primary-fixed-dim: '#adc6ff'
  on-primary-fixed: '#001a42'
  on-primary-fixed-variant: '#004395'
  secondary-fixed: '#e1e0ff'
  secondary-fixed-dim: '#c0c1ff'
  on-secondary-fixed: '#07006c'
  on-secondary-fixed-variant: '#2f2ebe'
  tertiary-fixed: '#6ffbbe'
  tertiary-fixed-dim: '#4edea3'
  on-tertiary-fixed: '#002113'
  on-tertiary-fixed-variant: '#005236'
  background: '#0e131d'
  on-background: '#dee2f1'
  surface-variant: '#303540'
  scrim: '#000000'
typography:
  headline-lg:
    fontFamily: Inter
    fontSize: 1.5rem
    fontWeight: '600'
    lineHeight: 1.875rem
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Inter
    fontSize: 1.25rem
    fontWeight: '600'
    lineHeight: 1.625rem
    letterSpacing: -0.015em
  headline-sm:
    fontFamily: Inter
    fontSize: 1rem
    fontWeight: '600'
    lineHeight: 1.375rem
    letterSpacing: -0.01em
  body-lg:
    fontFamily: Inter
    fontSize: 0.875rem
    fontWeight: '400'
    lineHeight: 1.375rem
    letterSpacing: 0em
  body-md:
    fontFamily: Inter
    fontSize: 0.8125rem
    fontWeight: '400'
    lineHeight: 1.25rem
    letterSpacing: 0em
  body-sm:
    fontFamily: Inter
    fontSize: 0.75rem
    fontWeight: '400'
    lineHeight: 1.125rem
    letterSpacing: 0.005em
  label-code-lg:
    fontFamily: JetBrains Mono
    fontSize: 0.875rem
    fontWeight: '500'
    lineHeight: 1.25rem
    letterSpacing: -0.01em
  label-code-md:
    fontFamily: JetBrains Mono
    fontSize: 0.75rem
    fontWeight: '500'
    lineHeight: 1rem
    letterSpacing: 0em
  label-code-sm:
    fontFamily: JetBrains Mono
    fontSize: 0.6875rem
    fontWeight: '500'
    lineHeight: 0.875rem
    letterSpacing: 0.01em
  metric-display:
    fontFamily: JetBrains Mono
    fontSize: 1.125rem
    fontWeight: '700'
    lineHeight: 1.25rem
    letterSpacing: -0.03em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  gutter: 0.5rem
  gutter-compact: 0.25rem
  margin: 0.75rem
  margin-dense: 0.5rem
  space-xs: 0.125rem
  space-sm: 0.25rem
  space-md: 0.5rem
  space-lg: 0.75rem
  space-xl: 1rem
---

## Brand & Style

This design system targets machine learning engineers, local LLM practitioners, and systems programmers who require maximum informational density, instantaneous visual feedback, and distraction-free operational control. The aesthetic merges contemporary developer ergonomics with industrial instrumentation: cold obsidian substrates, tactile structural dividers, razor-sharp telemetry readouts, and purposeful chromatic status indicators.

The design movement is **Technical Minimalist / Native High-Density IDE**:
- **Utilitarian Discipline:** Screen real estate is prioritized for execution graphs, context monitors, token streams, and parameter matrices.
- **Instrument-Grade Feedback:** Telemetry takes inspiration from avionics and high-performance computing clusters—precise linear meters, micro-badges, and monotonic numeric transitions.
- **Native Symbiosis:** Window frames, title bars, and segmented panels accommodate desktop conventions across Linux (GNOME/KDE), macOS (traffic-light integration, unified toolbars), and Windows 11 (Mica/Acrylic subtle border idioms).

## Colors

The YAML `colors` map in this document is the canonical palette contract. Component examples below refer to those semantic tokens; they must not introduce a second set of palette values. Contrast has not yet been measured across all text, controls, and states, so WCAG AA/AAA compliance is not certified. Measure rendered foreground/background pairs before making an accessibility compliance claim.

### Core Surfaces & Substrates
- **Base Canvas:** `surface` (`#0e131d`) — Root workspace canvas and shell background.
- **Lowest surface:** `surface-container-lowest` (`#090e18`) — Recessed backgrounds and scrollbar tracks.
- **Panel surfaces:** `surface-container-low` through `surface-container-highest` — Dock panels, cards, hover and selected states, in ascending elevation.
- **Structural borders:** `outline-variant` for quiet divisions and `outline` for stronger boundaries or focus where appropriate.

### Accents & Telemetry Roles
- **Primary technical accent:** `primary` and `primary-container` — Focus, primary actions, and active selections.
- **Secondary compute accent:** `secondary` and `secondary-container` — Secondary data series and compute visualization.
- **Success/online:** `tertiary` and `tertiary-container` — Healthy runtime and verified throughput states.
- **Warning/throttling:** `warning` — memory pressure, thermal throttling, and non-blocking warnings.
- **Critical/error:** `error` and `error-container` — Error and critical states.

### Typography & Content Neutrals
- Use `on-surface` for primary content and `on-surface-variant` for secondary content. Reserve disabled and decorative text for appropriately subdued variants only after their contrast is checked.

## Typography

The typographic hierarchy distinguishes operational interface controls from telemetry and code artifacts.

- **Interface Shell (`Inter`):** Delivers clean geometry and high readability in tight, dense arrangements such as property grids, tree views, context menus, and global app bars.
- **Data & Telemetry Engine (`JetBrains Mono`):** Applied to prompt inputs, token matrices, memory addresses, latency figures (tokens/sec, TTFT), and keybinding annotations. Tabular figures (`tnum`) should be enabled for changing numeric readouts to prevent layout shift.
- **Scale Compactness:** Use the YAML `typography` scale as the source of truth. Avoid local font-size or line-height values that conflict with those roles.

## Layout & Spacing

The layout philosophy follows a **Dense Dock-and-Split Pane Grid** engineered for multi-monitor workstations and wide viewport configurations.

### Grid & Panel Rhythms
- **Base Grid Unit:** `spacing.space-sm` (`0.25rem`) is the base 4px increment. Use the YAML spacing roles as the source of truth.
- **Docking Architecture:** Continuous vertical and horizontal splitters using 1px visible boundaries padded with 4px hit targets. Dock zones consist of:
  - Global Activity Bar (44px fixed width)
  - Collapsible Tree/Asset Sidebar (240px–360px variable width)
  - Central Editor/Chat Canvas (fluid flex container)
  - Telemetry & Inspector Tray (280px–420px variable width)
  - Bottom Terminal/Trace Console (200px–320px variable height, collapsible)

### Viewport Behaviors
- **Desktop Ultrawide / Multi-Window (>1440px):** Simultaneous three-column architecture with perpetual hardware telemetry strip visible in the bottom status bar.
- **Laptop / Compact Workstation (1024px–1439px):** Inspector and terminal docks shift to overlay drawer states or tabbed sub-decks.
- **Minimal / Tiling Window Managers (<1023px):** Automatic collapse of all sidebars into modal popovers; active editor pane retains 100% canvas volume.

## Elevation & Depth

This design system avoids heavy drop shadows and faux real-world lighting in favor of **Tonal Layering with Low-Contrast Precision Borders**. Depth establishes hierarchy without visual blur or perimeter bleed.

1. **Level 0 (Root):** `surface`.
2. **Level 1 (Dock panels):** `surface-container-low` or `surface-container` with a 1px `outline-variant` border.
3. **Level 2 (Cards):** `surface-container-high` or `surface-container-highest`.
4. **Level 3 (Overlays):** An elevated surface token and a restrained shadow; border uses `outline-variant`.
5. **Level 4 (Modal):** An elevated surface token with a focus treatment using `primary`. Verify the rendered focus indicator independently for visibility.

## Shapes

The shape system uses the YAML `rounded` scale as its only radius contract, preserving structure for high-density desktop layouts.

- **Dock panels & splitters:** `rounded.sm`.
- **Interactive controls:** `rounded.DEFAULT` or `rounded.md`.
- **Status chips:** `rounded.DEFAULT`; use `rounded.full` only where a pill shape is intentional.
- **Floating overlays & modals:** `rounded.lg` maximum.

## Components

### Buttons & Action Bars
- **Primary Compute Button:** Background `primary`, foreground `on-primary`, Inter at the `headline-sm` weight, spacing from `gutter`/`margin`, radius `rounded.DEFAULT`. Derive hover and active treatments from palette surfaces; do not invent new color literals. Focus uses `primary` with a visible outline.
- **Secondary Ghost Action:** Transparent background, `on-surface-variant` text, `outline-variant` border; hover uses `surface-container-high`.
- **Destructive/Interrupt Action:** Use `error` and `error-container` roles with an `outline-variant` boundary.

### Telemetry Meters & Hardware Gauges
- **VRAM / Compute Linear Progress Bar:** Use a compact meter on `surface-container-low`, with `outline-variant` boundary and radius `rounded.sm`. Map healthy state to `tertiary`, warning to `warning`, and critical state to `error`; thresholds are product policy and must be specified separately.
- **Numeric Stream Readout:** Use the `label-code-md` typography role, `on-surface` foreground, and right alignment; pair with `on-surface-variant` labels.

### Segmented Tabs & Switchers
- **Dock Tabs:** Use `surface-container-low` for the active tab and `surface` for inactive tabs. Text uses `on-surface` / `on-surface-variant`; active indicator uses `primary`, dividers use `outline-variant`.
- **Segmented Control (Quantization / Sampler Selector):** Use `surface` background, `gutter-compact` padding, `outline-variant` border and `rounded.DEFAULT`. Active segment uses `surface-container-high` and `primary` text.

### Input Fields & Technical Knobs
- **Parameter Inputs (Temperature, Top-P, Context Size):** Use `surface`, `outline-variant`, `on-surface`, and `label-code-md`; use spacing tokens for padding. Focus uses `primary` and a visible outline.
- **Code & Prompt Input Buffer:** Use `surface-container-low`, `outline-variant`, spacing tokens for inset padding, `primary` caret and `on-surface-variant` line numbers.

### Status Indicators & Chips
- **Node Status Indicator:** A small circular pip. Ready uses `tertiary`, warming uses `warning`, and offline uses `on-surface-variant`. State must also be conveyed by text or shape, not color alone.
- **Model Signature Tag:** Use `surface-container-high`, `outline-variant`, `on-surface-variant`, `label-code-md`, spacing tokens, and `rounded.DEFAULT`.

### Lists & Tree Views
- **Model Weight Tree & File View:** Use the `body-md` line-height role. Inactive items use `on-surface-variant`; hover uses `surface-container-high`; selected rows use `surface-container-highest` and a `primary` leading indicator. Expansion controls need an adequate interactive hit target.
