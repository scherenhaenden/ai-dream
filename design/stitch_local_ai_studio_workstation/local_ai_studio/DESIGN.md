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

The palette is engineered exclusively for sustained high-focus sessions in low-light environments. Contrast is maintained strictly within WCAG AA/AAA thresholds without inducing phosphor glare.

### Core Surfaces & Substrates
- **Base Canvas (Obsidian):** `#0B0E14` — Deep backdrop for root workspace canvases, window frames, and shell terminals.
- **Surface Panel (Slate Dark):** `#121721` — Structural docking panels, sidebars, activity bars, and collapsibles.
- **Surface Elevated (Slate Mid):** `#181F2C` — Cards, floating inspectors, tooltips, dialogs, and detached editor panes.
- **Surface Active / Hover:** `#1E2738` — Hover states, selected rows, and drop zones.
- **Structural Border:** `#232C3D` — Crisp 1px division between docks, panels, and toolstrips.
- **Structural Border Focus:** `#38455E` — Subtle activation outline for inactive focused zones.

### Accents & Telemetry Roles
- **Primary Technical Accent:** `#3B82F6` (Cyan-Blue) — Active cursors, focus rings, primary execution buttons, and branch badges.
- **Secondary Compute Accent:** `#6366F1` (Indigo) — Neural weights, tensor tensor-ops, pipeline routes, and model architecture visualizers.
- **Engine Emerald (Success/Online):** `#10B981` — Running inference engines, healthy memory states, and verified token throughput.
- **VRAM Amber (Warning/Throttling):** `#F59E0B` — Memory pressure, quant degradation, thermal throttle warnings, and non-blocking logs.
- **Thermal Rose (Critical/Error):** `#EF4444` — CUDA out-of-memory errors, kernel panics, failed assertions, and critical aborts.

### Typography & Content Neutrals
- **Text High-Contrast:** `#F8FAFC` — Primary code, telemetry numerals, active tab labels.
- **Text Standard:** `#CBD5E1` — Secondary UI labels, dock titles, inspector descriptors.
- **Text Muted:** `#64748B` — Line numbers, inactive breadcrumbs, keyboard shortcuts, disabled toggles.
- **Text Ghost:** `#475569` — Indentation guides, empty state diagrams, terminal timestamps.

## Typography

The typographic hierarchy distinguishes operational interface controls from telemetry and code artifacts.

- **Interface Shell (`Inter`):** Delivers clean geometry and high readability in tight, dense arrangements such as property grids, tree views, context menus, and global app bars.
- **Data & Telemetry Engine (`JetBrains Mono`):** Applied to prompt inputs, token matrices, memory addresses, latency figures (tokens/sec, TTFT), and keybinding annotations. Tabular figures (`tnum`) must remain permanently active across all monospaced outputs to prevent layout shift during high-frequency gauge updating.
- **Scale Compactness:** Unlike consumer interfaces, line heights are bound between `1.15` and `1.4` to preserve terminal and buffer viewport capacity without sacrificing vertical scanning accuracy.

## Layout & Spacing

The layout philosophy follows a **Dense Dock-and-Split Pane Grid** engineered for multi-monitor workstations and wide viewport configurations.

### Grid & Panel Rhythms
- **Base Grid Unit:** 4px micro-grid. All paddings, pane dividers, status bars, and icon frames increment on multiples of `0.25rem` (4px).
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

1. **Level 0 (Root Bedplate):** `#0B0E14` (Obsidian). Absolute floor level. Host window frame and background beneath draggable canvas tiles.
2. **Level 1 (Dock Panels):** `#121721` (Slate Panel). Bound by a 1px solid `#232C3D` border. Zero shadow. Houses file trees, code editors, and parameter lists.
3. **Level 2 (In-Panel Containers & Cards):** `#181F2C` (Slate Elevated). Delimits distinct parameter groups, inference log segments, and prompt containers. Enclosed with `#232C3D`.
4. **Level 3 (Overlay Menus & Context Flyouts):** `#1A2232` with an ambient technical shadow: `0 4px 16px -2px rgba(0, 0, 0, 0.65), 0 0 0 1px #2E3A52`. Provides absolute visual separation from underlying source code.
5. **Level 4 (Modal Command Palette / Model Switcher):** `#181F2C` elevated over a 40% `#000000` backdrop dim, with a 1px `#3B82F6` accent border highlight along the top edge to signify operational focus.

## Shapes

The shape system employs an industrial, sharp-to-soft profile (`roundedness: 1`) to preserve structure and fit high-density desktop layouts.

- **Dock Panels & Viewport Splitters:** Strictly `0px` radius. Panel edges fuse seamlessly with adjacent docking panes and window borders.
- **Interactive Controls (Buttons, Inputs, Selectors):** `0.25rem` (4px). Offers gentle tactile separation while keeping the perimeter tight.
- **Status Pills & Telemetry Chips:** `0.25rem` (4px) with subtle 1px border. Curved pill forms (`9999px`) are prohibited to avoid wasting horizontal space.
- **Floating Overlays & Modals:** `0.375rem` (6px) maximum. Retains an engineered, machine-tooled finish.

## Components

### Buttons & Action Bars
- **Primary Compute Button:** Background `#3B82F6`, text `#FFFFFF`, font `Inter` 600, padding `4px 12px`, border radius `4px`. Hover: `#2563EB`. Active: `#1D4ED8`. Focus: `0 0 0 2px #0B0E14, 0 0 0 4px #3B82F6`.
- **Secondary Ghost Action:** Background transparent, text `#CBD5E1`, border `1px solid #232C3D`. Hover: `#181F2C`, border `#38455E`.
- **Destructive/Interrupt Action:** Background `#181F2C`, text `#EF4444`, border `1px solid rgba(239, 68, 68, 0.3)`. Hover: `#EF4444`, text `#FFFFFF`.

### Telemetry Meters & Hardware Gauges
- **VRAM / Compute Linear Progress Bar:** Height `6px`, background `#121721`, border `1px solid #232C3D`, border radius `2px`. Fill tracks dynamically:
  - Normal usage (<75%): `#10B981`
  - Critical load (75%–90%): `#F59E0B`
  - OOM Threshold (>90%): `#EF4444` with subtle pulse animation.
- **Numeric Stream Readout:** Monospaced `JetBrains Mono` 11px, high-contrast `#F8FAFC`, right-aligned, paired with a `#64748B` micro-label (e.g., `42.4 tok/s`, `11.8 / 16 GB`).

### Segmented Tabs & Switchers
- **Dock Tabs:** Contiguous 32px height bar. Active tab has background `#121721`, text `#F8FAFC`, top border `2px solid #3B82F6`, side borders `1px solid #232C3D`. Inactive tab has background `#0B0E14`, text `#64748B`, hover text `#CBD5E1`.
- **Segmented Control (Quantization / Sampler Selector):** Background `#0B0E14`, padding `2px`, border `1px solid #232C3D`, border radius `4px`. Active segment: `#181F2C`, text `#3B82F6`, border `1px solid #232C3D`.

### Input Fields & Technical Knobs
- **Parameter Inputs (Temperature, Top-P, Context Size):** Background `#0B0E14`, border `1px solid #232C3D`, text `#F8FAFC`, font `JetBrains Mono` 12px, padding `4px 8px`. Focus: border `#3B82F6`. Number spinners feature embedded stepper icons.
- **Code & Prompt Input Buffer:** Background `#121721`, border `1px solid #232C3D`, inset padding `8px 12px`, caret color `#3B82F6`, line numbers in `#475569`.

### Status Indicators & Chips
- **Node Status Indicator:** 6px circular pip. 
  - Ready: `#10B981` with faint `0 0 6px rgba(16, 185, 129, 0.4)` bloom.
  - Compiling/Warming: `#F59E0B` with 1Hz pulse.
  - Offline: `#64748B`.
- **Model Signature Tag:** Background `#181F2C`, border `1px solid #232C3D`, text `#CBD5E1`, font `JetBrains Mono` 11px, padding `2px 6px`, radius `3px`.

### Lists & Tree Views
- **Model Weight Tree & File View:** Line height `24px`. Inactive items `#CBD5E1`. Hover row: `#181F2C`. Selected row: `#1E2738`, left accent border `2px solid #3B82F6`. Expansion arrows have 12px bounding boxes with a 90-degree twist transition.