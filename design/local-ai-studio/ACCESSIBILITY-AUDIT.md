# Accessibility audit

Date: 2026-10-03  
Scope: React/Vite reference in this directory. The production application is the Angular app under `../../web`; this audit does not establish production accessibility.

## Outcome

Several source-level issues were corrected and checked in Chromium: decorative Material Symbols no longer pollute accessible names, and the command palette's arrow navigation advances one command per keypress. The context-tag action is now a named button, and segmented/toggle controls expose their selected state. This is a partial audit, not a 100% accessibility approval.

## Evidence and changes

| Area | Evidence | Result |
| --- | --- | --- |
| Accessible names | Chromium's accessibility tree initially exposed icon ligature text in names (for example, `settings_input_component Runtime Manager`). | Added `aria-hidden="true"` to 106 decorative Material Symbols spans across the prototype. The refreshed tree reports clean names such as `Runtime Manager`, `Chat`, and `Copy`. |
| Keyboard: command palette | Opened with Ctrl+K. Before correction, one ArrowDown moved selection from `Open Chat` to `Models (Local Library)`, demonstrating a duplicate event handler. | Removed the redundant handler. Retest: one ArrowDown selects `Open Read-only Agent`; Enter navigates to Agent. Tab keeps focus in the palette combobox; Escape closes the dialog and restores focus to the invoking Search button. |
| Keyboard: context chip | Source inspection found a clickable `span` for the close glyph, with no keyboard semantics. | Replaced it with a button named `Remove context tag`; Chromium's accessibility tree exposes it as a button. |
| Selected states | Chat view, inspector, placement, split-strategy, and log-filter choices were buttons whose selected state was only visual. | Added `aria-pressed` state. Chromium exposes the active view and inspector choices with selected values, and changes the inspector toggle from 0 to 1 when activated. |
| Landmarks and names | Chromium accessibility tree for the default Chat view exposed the skip link, named Primary navigation landmark, main landmark, named controls, and page headings. | Present in the shell and sampled screen. Other screen trees were not reviewed one by one. |
| Header at 1280×720 | Rendered screenshot showed the breadcrumb/search group and right-side runtime controls overlapping. | Header widths and breakpoints were adjusted; a follow-up screenshot at 1280×720 shows the search, model selector, Load Model, and inspector controls separated. Runtime and system status pills move to 2xl widths. |
| Build/type checks | `npm run lint` and `npm run build` from `design/local-ai-studio/`. | Both pass after the changes. Vite prints a non-blocking `__dirname` config-loader warning. |

## Coverage limits

- Browser verification used the Codex in-app Chromium accessibility tree at `http://127.0.0.1:3000/`; its screenshot was 1280×720. Attempts to narrow the window or change browser zoom were not available through this browser surface (Ctrl++ had no observable effect), so no compact-width or zoom result is claimed. It is browser accessibility-tree evidence, not an independent screen-reader session.
- Orca is present at `/usr/bin/orca`, but it was not launched or operated. No screen-reader pass is claimed.
- Responsive behavior was inspected in source (Tailwind breakpoints, mobile sidebar and responsive screen grids), but the available browser control did not expose viewport resizing. Exact 390px, 768px, and 1440px layout checks remain unverified.
- The runtime browser check covered the Chat view, the shared shell, and the command palette. It did not exercise all prototype screens, every control, text enlargement, high-contrast settings, or reduced-motion behavior.
- `DESIGN.md` now records source calculations for opaque token pairs and selected overlay/focus cases. This audit did not independently verify every rendered component, disabled opacity, gradient, font-size exception, or browser-composited foreground/background pair.

## Remaining work before full accessibility sign-off

Run an AT session with Orca (or another supported screen reader) through the shared shell, command palette, mobile navigation, and each screen; validate responsive layout at 390px, 768px, and 1440px in an adjustable browser; then verify rendered text/control contrast and reduced-motion behavior. Re-audit after any UI changes.
