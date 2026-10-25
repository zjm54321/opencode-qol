# OpenCode QoL branding assets

## opencode-qol-logo.png (1933×371, RGBA, transparent)

- Base: the official OpenCode wordmark `packages/web/src/assets/logo-dark.svg`
  from anomalyco/opencode v2.1.4 (rev 68bc26b7da1990ce10ffecfbc1e09eb13aa5d824).
  The OpenCode name and wordmark belong to the OpenCode project; this edition
  mark does not replace or restyle it.
- Reference: that SVG rasterized with `rsvg-convert -z 6` on #131010 and padded.
- Generator: `tools.image_gen`, model `gpt-image-2.5-sunburst`,
  `transparent_background: true`, one reference image, default aspect/quality
  (calls with `aspect_ratio: "21:9", quality: "high"` returned HTTP 503 twice).
  Raw output: 2127×739, sha256 7f27285e9fe6d47fc1875397b35e54c4d20a33951a5067d07936f27782116d87.
- Prompt intent: keep the official lowercase blocky "opencode" exactly (open #B7B1B1,
  code #F1ECEC, counters #4B4646) and add only a smaller lowercase blocky "qol"
  in #B7B1B1 to the right, baseline-aligned, nothing else.
- Post-processing: crop to content with margin (`magick -crop 1933x371+97+194`), strip metadata.
  No pixels were redrawn.

## opencode-qol-logo-preview-dark.png (967×186)

The logo above flattened on #131010 and scaled 50%, for review only.

## tui-logo-render.txt

Character frames of the patched TUI `Logo` (home, `edition` on) captured with
`@opentui/solid` `testRender` at widths 16–120. Harness used @opentui 0.5.11
(upstream pins 0.6.8) with a theme stub; it is a layout check, not a screenshot.
The terminal logo is native text: the wordmark is the upstream block art and
`qol` is three muted lowercase characters, matching the PNG.
