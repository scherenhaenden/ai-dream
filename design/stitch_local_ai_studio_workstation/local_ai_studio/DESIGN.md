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
  outline: '#9ca3af'
  scrim: '#000000'
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
  on-warning: '#201200'
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
  2xl: 1rem
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

The YAML front matter at the top of this file is the canonical color-token source. The React reference exposes those values as Tailwind theme variables in `src/index.css`; use the corresponding `--color-*` variable in styles rather than copying a hex value. The prose below describes token roles, not a second palette.

### Token roles
- **Canvas:** `surface` / `background`; lowest inset surfaces: `surface-container-lowest` and `surface-container-low`.
- **Panels and cards:** `surface-container` through `surface-container-highest`; `surface-bright` is the brightest neutral surface.
- **Primary text:** `on-surface`; secondary text: `on-surface-variant`.
- **Structure:** `outline` for stronger boundaries and `outline-variant` for quiet dividers.
- **Primary interaction:** `primary` with `on-primary`; containers use `primary-container` with `on-primary-container`. `surface-tint` is the tonal overlay accent.
- **Secondary accent:** use `secondary` with `on-secondary` for secondary compute and selection states. Use `tertiary` for success/healthy status, `warning` with `on-warning` for caution, and the error family for destructive/error states.
- **Fixed and inverse tokens:** use only for components that specifically require a stable light/dark scheme; do not substitute them for the standard surface/text pairs.

Use `scrim` with an explicit opacity for overlays. Do not claim WCAG conformance from palette names alone. Contrast depends on the actual foreground/background pair, opacity, font size, and rendered state; verify each used pair before making an accessibility claim.

### Verified opaque color pairs

Ratios below are calculated from the YAML hex values using the WCAG 2.x sRGB relative-luminance formula. The dark-surface minimum is the lowest contrast against `surface-container-lowest`, `surface-container-low`, `surface`, `surface-container`, `surface-container-high`, `surface-container-highest`, and `surface-bright`. `surface-dim` and `background` duplicate `surface`; `surface-variant` duplicates `surface-container-highest`. These are solid-color checks with no opacity, gradients, or overlays.

| Foreground role | Tested backgrounds | Minimum contrast | Minimum pair |
|---|---|---:|---|
| `on-surface` | Dark surfaces listed above | **8.96:1** | `surface-bright` |
| `on-surface-variant` | Dark surfaces listed above | **6.80:1** | `surface-bright` |
| `outline` | Dark surfaces listed above | **4.56:1** | `surface-bright` |
| `primary` | Dark surfaces listed above | **6.78:1** | `surface-bright` |
| `secondary` | Dark surfaces listed above | **6.79:1** | `surface-bright` |
| `tertiary` | Dark surfaces listed above | **6.78:1** | `surface-bright` |
| `warning` | Dark surfaces listed above | **5.39:1** | `surface-bright` |
| `error` | Dark surfaces listed above | **6.82:1** | `surface-bright` |

| Foreground label | Accent background | Contrast |
|---|---|---:|
| `on-primary` | `primary` | **7.69:1** |
| `on-primary-container` | `primary-container` | **4.54:1** |
| `on-secondary` | `secondary` | **7.72:1** |
| `on-secondary-container` | `secondary-container` | **4.57:1** |
| `on-tertiary` | `tertiary` | **7.73:1** |
| `on-tertiary-container` | `tertiary-container` | **4.54:1** |
| `on-warning` | `warning` | **8.52:1** |
| `on-error` | `error` | **7.72:1** |
| `on-error-container` | `error-container` | **7.24:1** |

All listed foreground roles and accent-label pairs are at least 4.5:1 against the tested opaque colors. These calculations do not establish blanket WCAG conformance: translucent utility variants, gradients, focus states, icons, typography, and rendered components need their own checks.

### Alpha, focus, and decorative-state audit (source-level)

The following additional checks use sRGB alpha compositing followed by the WCAG 2.x relative-luminance formula. They cover the explicit source colors and surface tokens in this reference; they are not a browser screenshot audit.

| Rendered case | Compositing/check | Result |
|---|---|---:|
| Fixed header (`surface-container-lowest/90`) | Composite over each of the seven dark surface tokens; check the header's `on-surface`, `on-surface-variant`, `outline`, `primary`, and `tertiary` text colors against the resulting header surface | **Minimum 6.50:1** (`outline` over header composited on `surface-bright`) |
| Mobile navigation scrim (`scrim/60`) | Black scrim over dark surface tokens; no text is placed on the scrim | Decorative/dimming layer only |
| Command palette scrim (`scrim/75`) | Black scrim over dark surface tokens; palette content is on an opaque `surface` panel | Decorative/dimming layer only |
| Focus outline (`primary`) | Solid primary outline against the tested dark surface-token set | **Minimum 6.78:1** (`surface-bright`) |
| Focus halo (`primary` at 20%) | `color-mix()` shadow around controls | Decorative halo; the solid 2px outline provides the focus indicator and is the contrast result above |
| Hardware topology/SVG chart fills and connector gradients | SVG paths, dots, and chart areas use alpha/gradients; no text is painted into those SVG fills | Decorative/data marks; nearby text labels retain their own foreground/background pairs |
| Tools screen disabled label (`on-surface-variant/60`) | 60% foreground over `surface-container-high` | **4.06:1 before correction**; CSS now resolves this class to opaque `on-surface-variant`, which is **8.45:1** on that surface and at least **6.80:1** across the dark surface set |

The React stylesheet contains one alpha-colored text utility, for the disabled Tools refresh label; `index.css` now makes that label opaque so its disabled state is communicated by the native disabled attribute rather than reduced text contrast. Background alpha utilities remain in use for overlays, chips, and nested surfaces. Their underlying parent can vary by screen, so this audit does not claim a universal ratio for every possible composition. Whole-element opacity used on disabled controls is likewise not included in the text-pair figures; inactive-control styling and disabled reference panels still need rendered review. Gradients, SVG decoration, text over images, anti-aliasing, font-size/weight exceptions, and browser-specific color rendering are not certified by these source calculations.

## Typography

The typographic hierarchy distinguishes operational interface controls from telemetry and code artifacts. `index.html` loads Inter and JetBrains Mono from Google Fonts; the CSS variables provide system/monospace fallbacks if that request is unavailable. The current reference therefore depends on network access for the named fonts; no local font files are included.

- **Interface Shell (`Inter`):** Delivers clean geometry and high readability in tight, dense arrangements such as property grids, tree views, context menus, and global app bars.
- **Data & Telemetry Engine (`JetBrains Mono`):** Applied to prompt inputs, token matrices, memory addresses, latency figures (tokens/sec, TTFT), and keybinding annotations. Tabular figures (`tnum`) should be enabled for changing numeric readouts to prevent layout shift.
- **Scale Compactness:** Use the YAML `typography` scale as the source of truth. Avoid local font-size or line-height values that conflict with those roles.

## Layout & Spacing

The layout philosophy follows a **Dense Dock-and-Split Pane Grid** engineered for multi-monitor workstations and wide viewport configurations.

### Grid & Panel Rhythms
- **Base Grid Unit:** 4px micro-grid. All paddings, pane dividers, status bars, and icon frames increment on multiples of `0.25rem` (4px).
- **Application shell:** A fixed 18rem primary-navigation sidebar at desktop widths, a 3.5rem header, a flexible screen-content region, and a 1.5rem status footer. Individual screens may add their own columns or inspectors; there is no app-wide splitter/docking manager.

### Viewport Behaviors
- **Responsive breakpoints:** Screen content uses Tailwind `sm`, `md`, `lg`, and `xl` utilities to reflow grids and controls. Individual screens may retain wide or fixed-width panels, so check each screen at the target width.
- **Below `lg`:** The primary navigation is an off-canvas drawer opened from the header, with a backdrop while open. Header and footer span the viewport.
- **At `lg` and wider:** The sidebar remains visible at 18rem wide; the header and footer reserve that same left offset. Screen-specific columns reflow according to their own responsive classes.
- There is no separate ultrawide layout or global rule that turns every inspector/terminal into a drawer; those behaviors are not implemented consistently across screens.

## Elevation & Depth

This design system avoids heavy drop shadows and faux real-world lighting in favor of **Tonal Layering with Low-Contrast Precision Borders**. Depth establishes hierarchy without visual blur or perimeter bleed.

1. **Level 0 (Root Bedplate):** `surface` / `background`.
2. **Level 1 (Dock Panels):** `surface-container-low` or `surface-container`, separated with `outline-variant`.
3. **Level 2 (In-Panel Containers & Cards):** `surface-container-high`, separated with `outline-variant`.
4. **Level 3 (Overlay Menus & Context Flyouts):** `surface-container-highest`; use restrained elevation and an `outline` boundary.
5. **Level 4 (Modal Command Palette / Model Switcher):** `surface-container-highest` over a scrim; use `primary` for the focus accent.

## Shapes

The YAML `rounded` scale mirrors the Tailwind radius utilities used by the reference (`rounded-sm` through `rounded-2xl`, plus `rounded-full`). Source inspection found `rounded-lg` to be the most common panel/control radius (122 uses), followed by `rounded-md` (54), `rounded-xl` (37), and `rounded-2xl` (1, command palette). Smaller radius guidance below describes compact telemetry elements; it is not a claim that all dock panels currently use the smallest radius.

- **Dock panels & cards:** commonly `rounded.lg`; compact nested containers use `rounded.md`.
- **Interactive controls:** `rounded.md` or `rounded.lg`, according to control size.
- **Status chips:** `rounded.DEFAULT` or `rounded.lg`; use `rounded.full` only where a pill shape is intentional.
- **Floating overlays & modals:** `rounded.xl`; the command palette currently uses `rounded.2xl` as a single larger exception.

## Source-alignment evidence and remaining review

This is a source-level comparison of the design specification with the React reference, not visual sign-off.

| Check | Evidence in the current reference | Remaining review |
|---|---|---|
| Color tokens | The 50 YAML color entries match the 50 `--color-*` values in `src/index.css`; the document front matter no longer repeats `warning` or `scrim`. The HTML body uses `bg-surface` and `text-on-surface` instead of duplicate hex literals. | Inspect rendered states in a browser, especially translucent borders/chips, disabled controls, SVG marks, and real foreground/background combinations. |
| Shape scale | YAML includes the Tailwind radius steps used by the reference. Source counts show 122 `rounded-lg`, 54 `rounded-md`, 37 `rounded-xl`, and one `rounded-2xl` use; the command palette is that exception. | Compare the Stitch reference images and rendered screens side by side; the source snapshot alone cannot confirm visual fidelity. |
| Typography | `index.html` imports Inter and JetBrains Mono from Google Fonts; CSS declares system and monospace fallbacks. | Check the loaded-font and offline states in-browser; no local font assets are present. |
| Responsive/elevation | `accessibility.css` defines shell behavior below 1024px and 640px, and the React shell uses 18rem navigation, 3.5rem header, and 1.5rem footer dimensions. | Capture representative screens at narrow, tablet, desktop, and ultrawide sizes; screen-specific grids and overlays still need visual inspection. |

## Components

### Buttons & Action Bars
- **Primary Compute Button:** Background `primary`, text `on-primary`, font `Inter` 600, padding `4px 12px`, radius `rounded.DEFAULT`. Hover and pressed states use tonal variants from the `primary` family.
- **Secondary Ghost Action:** Transparent background, text `on-surface-variant`, border `outline-variant`. Hover uses `surface-container-high` and `outline`.
- **Destructive/Interrupt Action:** Background `error-container`, text `on-error-container`, border `error`. Keep hover treatment within the `error` family.

### Telemetry Meters & Hardware Gauges
- **VRAM / Compute Linear Progress Bar:** Height `6px`, background `surface-container-low`, border `outline-variant`, radius `rounded.sm`. Use `tertiary` for healthy status, `warning` for caution, and `error` for critical status; always pair color with a text or icon status.
- **Numeric Stream Readout:** Monospaced `JetBrains Mono` 11px, `on-surface`, right-aligned, paired with `on-surface-variant` micro-label (e.g., `42.4 tok/s`, `11.8 / 16 GB`).

### Segmented Tabs & Switchers
- **Dock Tabs:** Contiguous 32px bar. Active tab uses `surface-container-low`, `on-surface`, a `primary` top border, and `outline-variant` side borders. Inactive tab uses `surface` and `on-surface-variant`; hover text uses `on-surface`.
- **Segmented Control (Quantization / Sampler Selector):** Background `surface`, padding `2px`, border `outline-variant`, radius `rounded.DEFAULT`. Active segment uses `surface-container-high`, `primary`, and `outline-variant`.

### Input Fields & Technical Knobs
- **Parameter Inputs (Temperature, Top-P, Context Size):** Background `surface`, border `outline-variant`, text `on-surface`, font `JetBrains Mono` 12px, padding `4px 8px`. Focus uses `primary`. Number spinners feature embedded stepper icons.
- **Code & Prompt Input Buffer:** Background `surface-container-low`, border `outline-variant`, inset padding `8px 12px`, caret color `primary`, line numbers in `on-surface-variant`.

### Status Indicators & Chips
- **Node Status Indicator:** 6px circular pip. 
  - Ready: `tertiary`.
  - Compiling/Warming: `warning`.
  - Offline: `on-surface-variant`.
- **Model Signature Tag:** Background `surface-container-high`, border `outline-variant`, text `on-surface-variant`, font `JetBrains Mono` 11px, padding `2px 6px`, radius `rounded.DEFAULT`.

### Lists & Tree Views
- **Model Weight Tree & File View:** Line height `24px`. Inactive items use `on-surface-variant`. Hover row uses `surface-container-high`; selected row uses `surface-container-highest` with a `primary` left accent border. Expansion arrows have 12px bounding boxes with a 90-degree twist transition.
