# Native behavior, safety and Fluent design

## Loading and external actions

- **Image / ImageGallery:** use user/tool-provided absolute HTTPS URLs. Full URLs appear before an explicit click-to-load; images never auto-fetch. `ImageGallery` accepts 1–12 images, with an 8 MB limit per image, and opens a full-size native viewer from its preview. Do not invent an image-search fallback.
- **Video / Audio:** absolute HTTPS URLs without credentials, including redirects. The user clicks to load into a native MediaPlayerElement; there is no autoplay. Native transport controls and system-supported codecs apply, with a 128 MB limit. Playback pauses when the card unloads.
- **Map:** the location list appears first; clicking **加载地图** (load map) fetches HTTPS map tiles. Pan/zoom, selectable markers and fit-to-markers are native. Tile failure leaves the location list usable and provider attribution remains visible.
- **SearchImage:** a native search card with a confirmed external search link; it does not automatically search or download photos.
- **YouTube:** provide a known video ID or an HTTPS youtube.com/youtu.be URL. The full watch URL appears first, and a thumbnail loads only after a click. The watch button or thumbnail opens FluentCode's existing **in-app browser**, not a WebView or embedded video player inside the card.
- **@OpenUrl / Link:** display the full absolute HTTP(S) URL and ask the user to confirm before opening it. Do not use `file:`, `javascript:`, `data:`, shell URLs or credentials.
- **@ToAssistant:** the click sends through FluentCode's normal guarded composer. If the assistant is busy, the message is queued. Current form state accompanies the request; do not imply that clicking has already completed a task or bypasses permissions.

Cards cannot run commands or edit files. Native image/map/media loaders and confirmed links are the supported external surfaces, not general-purpose network access by the card program. `Svg` draws native shapes without loading external resources; `Code` only displays/copies code.

## Maps and coordinates

Always provide **WGS-84** latitude and longitude: `MapMarker(label, lat, lng, category?, icon?)`. Latitude is between −90 and 90, longitude between −180 and 180. Do not preconvert to GCJ-02 or BD-09; the renderer converts coordinates for the selected provider.

The user's Settings select OSM (default), AMap (with GCJ-02 conversion), TianDiTu (key required) or custom HTTPS XYZ tiles; Baidu is disabled. `Map(..., true, ...)` joins markers in their given order. This is a visual route line, **not** road routing, travel-time calculation or turn-by-turn navigation. Bind `selected` to a string variable to show or use the selected marker's label.

## Compact Fluent cards

- Keep the transcript compact: one clear title, a small number of useful sections, and a concise footer explaining the interaction or data source. Avoid nested decorative panels and oversized blank space.
- Use native theme colors rather than hard-coded palettes. `Card`, `Col`, `Row`, `Box` and `Grid` provide structure; gap/padding values count in 4 px steps. Metrics are usually `Card([Caption(...), Title(...)])`, not a made-up component.
- `Button` and `IconButton` sizes `sm`, `md`, `lg` are **32 / 40 / 48 px**. Leave size unset for adaptive sizing. Short calculator labels (1–2 characters) adapt to 0.8× column width, clamped to 40–56 px; an explicit size always wins. Buttons fill Grid cells and button-only Rows.
- Use `Grid`'s minimum child width to reduce columns in narrow cards, and `Row` wrapping where appropriate. Favor clear labels over dense controls; give `IconButton` an accessibility label.
- Tables respect the card padding. Supply column titles and matching cells in positional order; numeric columns align right. Let the native sortable/resizable table handle its own layout instead of adding negative margins or extra fake columns.
- Charts accept row objects and named series. Limit series to what helps the comparison (maximum 8). Percent data is expressed as 45, not 0.45; currency uses an ISO code such as USD or EUR.
- Put visible text in the user's language, including labels, choices, loading context, units and footers. Keep assistant-submission messages short and in that language too.

Use controls to support the user's requested interaction. Plain prose and code belong in ordinary chat even though `Text`, `Markdown` and `Code` can accompany an actual card.
