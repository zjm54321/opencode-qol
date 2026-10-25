# Official OpenCode logo assets

- Source: unchanged `packages/web/src/assets/logo-dark.svg` and `logo-light.svg`
  from anomalyco/opencode v2.1.4 (rev 68bc26b7da1990ce10ffecfbc1e09eb13aa5d824),
  copied as `opencode-qol-logo-dark.svg` and `opencode-qol-logo-light.svg`.
- The OpenCode name and wordmark belong to the OpenCode project.
- PNGs are transparent 1404×252 renderings of the official 234×42 SVGs.
  No additional lettering, padding, restyling or image generation is applied.
- `opencode-qol-logo.png` is an exact copy of the dark PNG. The existing filenames
  are retained for consumers; the images use only the official OpenCode wordmark.
- The TUI uses the unmodified upstream Logo component and home route. Only version
  displays retain the `-qol` suffix.

Regenerate from this directory:

```sh
nix shell nixpkgs#librsvg -c rsvg-convert -z 6 opencode-qol-logo-dark.svg -o opencode-qol-logo-dark.png
nix shell nixpkgs#librsvg -c rsvg-convert -z 6 opencode-qol-logo-light.svg -o opencode-qol-logo-light.png
cp opencode-qol-logo-dark.png opencode-qol-logo.png
```
