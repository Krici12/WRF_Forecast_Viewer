# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

A static, single-page WRF/GFS weather forecast viewer. There is no build system, package manager, or test suite — `index.html` is a self-contained vanilla-JS/Leaflet app, and the rest of the repo is the forecast data it reads.

This repo is **not** where forecasts are generated, and — since the cPanel migration — it is **not** where forecast data is published either. A pipeline on Metacentrum HPC (repo `wrf-forecast`) computes the WRF run, postprocesses it into JSON chunks + `manifest.json`, stages them under `web-stage/`, and that `data/` + `manifest.json` tree is uploaded to the **cPanel** host's `public_html/` automatically at the end of every postprocess job. This repo holds the **frontend app** (`index.html`/`css`/`js`/`logo`); the `data/` files committed here are samples/placeholders, not the live feed. GitHub Pages is no longer used.

## Previewing locally

Opening `index.html` directly via `file://` will fail — its `fetch('manifest.json')` calls need an HTTP origin. Serve it locally instead:

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

There's no linter or test command; verify UI changes by loading the page in a browser and checking the map renders, the time slider/playback works, and hovering the map shows the tooltip. For a scripted check with today's live data and screenshots at phone and desktop sizes use `tools/dev/test_server.py` and `tools/dev/check_page.py` (see their headers).

## Deploying

The site is hosted on the university **cPanel** host only (GitHub Pages retired). Two independent concerns, kept separate on purpose:

1. **Frontend app** (this repo: `index.html`/`css`/`js`) — deployed with `tools/deploy_frontend.sh` (since 2026-11-10; the old manual `rclone` way below is kept only as a fallback for a machine that has the `czuweb` remote):

```bash
bash tools/deploy_frontend.sh --dry-run   # list what would be uploaded
bash tools/deploy_frontend.sh             # upload + verify, then: git push origin main && git push -f origin frontend-live
```

   The script uploads only git-tracked files under `index.html`, `css/`, `js/` that changed since the git tag `frontend-live` (content of `HEAD`, `index.html` last), through skirit (the cPanel key lives on MetaCentrum at `$STRG/.ssh/id_cpanel_czu`). It never touches `data/`, `manifest.json`, `logo/`, `boundaries/`, `.htaccess`, `cgi-bin/`, `.well-known/` and deletes nothing. It refuses to upload when the live site differs from `frontend-live`, and moves the tag only after the uploaded files were downloaded again and matched `HEAD`. Bump the `?v=` cache-busters in `index.html` when a css/js file changes.

   Fallback (manual `rclone`, the cPanel host has no `rsync` binary). **Exclude `data/**` and `manifest.json`** so a frontend deploy never clobbers the live forecast data the HPC uploads.

```bash
rclone sync --progress \
  --exclude ".git/**" --exclude ".github/**" --exclude ".gitignore" \
  --exclude ".htaccess" --exclude ".ftpquota" \
  --exclude "cgi-bin/**" --exclude ".well-known/**" \
  --exclude "data/**" --exclude "manifest.json" \
  . czuweb:public_html
```

2. **Forecast data** (`data/<dataset_id>/` + `manifest.json`) — produced by the HPC pipeline into `web-stage/` and uploaded to `public_html/` **automatically** at the end of every `postprocess_job.sh` (`wrf-forecast`'s `scripts/common/publish_cpanel.sh`, SSH/SFTP to the help-desk IP `89.233.145.252` as `weatherforecastf`; `manifest.json` goes last, stale `data/*.json` are removed). Web builds of all models are serialized by `state/web_build.lock` on Metacentrum. Never deploy `data/` or `manifest.json` from this repo.

- `czuweb` is a preconfigured rclone SFTP remote (`~/.config/rclone/rclone.conf`) pointing at the `czu-web` SSH alias (`srv.cpanel-czu.cz`, domain `weather-forecast.fzp.czu.cz`).
- **Always keep the `.htaccess` / `.ftpquota` / `cgi-bin/**` / `.well-known/**` excludes.** `rclone sync` mirrors exactly and will delete anything on the remote that isn't in the local tree — those paths are cPanel/SSL-validation infrastructure, and dropping them breaks HTTPS redirects and future cert renewal. Always run with `--dry-run` first when changing the exclude list.

## Data-source credits (licence requirement)

`js/credits.js` holds the attribution each data provider's licence requires, keyed by the dataset's `model` in `manifest.json` (GFS, ARPEGE, ICON, GEM, IFS). The wording was copied from the providers' licence pages on 2026-11-10 (URLs in the file header); do not reword it. Three places show it: the `Data: <provider>` chip in the header (`#m-src`; phones show only the provider), the About panel it opens (`#credits`, all providers + base map + logos), and the always-visible credit line at the bottom of the control panel (`#credit-text`, the provider's full statement for the driver on the map, on phones too). In compact mode (see Layout) the full line is replaced by the one-line `#credit-short` ("Data: <provider> · Base map © Esri", opens the About panel), so a credit is on screen in every state. The Leaflet attribution line carries only the Esri tile credit and is hidden below 1240 px, where the panel would cover it (Esri is in the credit line). `updateCredits()` runs from `initApp()` after every dataset switch. A new driver needs a new `CREDITS` entry before its data go public; ECMWF (IFS) in particular requires the sentence "This service is based on data and products of the European Centre for Medium-Range Weather Forecasts (ECMWF)", the source, the CC BY 4.0 statement and the disclaimer.

## Layout (redesign 2026-11-11)

- **Header `#topbar`** (full width, solid white): ČZU logo (link to https://www.fzp.czu.cz/en) and Chytrá krajina 2030+ logo (`.brand-kv`, link to https://www.chytra-krajina.cz) + title, dataset select, variable switch `#layers` (segmented, short labels on phones), credit chip (inline SVG "i" icon, centred by geometry). Two rows on phones (≤ 768 px). The header is solid white because `logo/logoKV.png` has an opaque white background.
- **Compact mode** (`body.compact`, `setCompact()` / `toggleCompact()` / `initCompact()` in controls.js): the chevron button `#compact-btn` in the bottom panel hides the header and everything in the panel except play, the time, the slider with its day ticks and the one-line credit. The button exists on phones (≤ 768 px) and in low windows (height ≤ 560 px), and always while compact mode is on. The choice is kept in `localStorage`; a window lower than 480 px (phone held sideways) starts compact unless the user chose otherwise.
- **Bottom panel `#controls`**: local time (Europe/Prague, CET/CEST by date) with a UTC / lead / step sub-line, playback buttons, slider, legend `#legend` (labels at their true positions), run info, credit line. Floating card on desktop, full-width sheet on phones.
- **Map fit**: `initApp()` measures the header and the panel and passes them to `fitBounds` as padding (`zoomSnap: 0.1`), so the domain fills the free area on any screen.
- **Dataset switch keeps the valid time**: `autoLoadFromManifest()` remembers the time on screen and jumps to the first step at or after it once it has loaded.
- **Lead time** is counted from `metadata.run_time`, not from the step index (the first step on the web is not always the run time).
- **Value box and pinned point** (tooltip.js): hovering shows the box at the cursor and a ring on the grid point the numbers come from, with the outline of its cell. A click or tap pins the point: ring and box stay, follow the map, the time slider and the dataset (`pinLL` survives `initApp()`). Click the same cell, the ✕ or Esc to release; a double click (zoom) leaves the pin alone. Rows: LAT, LON, ELEV, then TEMP, PRECIP. No box over map controls (zoom buttons).
- **ELEV** comes from one fixed terrain layer, `terrain` in data.js: the `hgt` of the 3 km WRF grid, used for every dataset. The driver ("original") grids carry `hgt = 0` everywhere, which is why ELEV used to read 0 there. For an original dataset the value is the WRF terrain at the centre of the coarse cell, not the driver's own orography (the pipeline does not export it).
- **Grid in memory** (`loadGrid()` in data.js): one grid object per dataset for the page visit; all WRF datasets share one object (the five `grid.json` are byte-identical, 3.1 MB, the server does not compress), so it downloads once. `loadSeq` stops a dataset load that was overtaken by a newer switch.
- **Dataset switch keeps the map view** (centre and zoom), like it keeps the time; `fitBounds` runs on the first load only.
- **Zoom**: Leaflet's wheel zoom is off; `initSmoothZoom()` in map.js moves a goal zoom on every wheel event and the map glides to it with the cursor point fixed (240 px of scroll per level, pinch = wheel + ctrlKey 50 px per level, Safari gesture events on a Mac). It uses Leaflet internals `_moveStart` / `_move` / `_moveEnd` (Leaflet is pinned to 1.9.4). Zoom range 3–13.
- **Precipitation scale** (`PREC_STOPS` in index.html): nothing below 0.1 mm/h, then light blue, blue, green, yellow, orange, red, magenta at 0.1, 0.5, 1, 2, 5, 10, 20, 50 mm/h; overlay opacity 0.92 for precipitation, 0.65 for temperature. The precipitation legend gives every stop the same width (a linear bar would squeeze 0.1–2 mm/h into its first 4 %).
- **Stale-page guard** (inline script in `index.html`): the server sends no `Cache-Control`, so the page asks for its own `Last-Modified` and reloads once when the copy in the browser is older. The server's `.htaccess` is not ours to edit.
- Every script the redesign touched has a `?v=` cache-buster; bump it whenever the file changes.

## Work log 2026-11-10 / 11 (start here next time)

Done in a session run from the `wrf-forecast` project while adding the IFS driver:

1. **Data-source credits** (2026-11-10, commit `6403b94`): `js/credits.js` with the licence wording of NOAA, Météo-France, DWD, ECCC and ECMWF; the About panel; `tools/deploy_frontend.sh`.
2. **Redesign** (2026-11-11, commit `725270b`), after the user saw the phone page and called it poor, then gave a free hand: header bar, single bottom panel, phone layout, always-visible provider statement, map fitted to the free area. Details in "Layout" above.
3. **Bugs fixed on the way**: local time was hard-coded UTC+2 and labelled CEST all year (now real Europe/Prague time); after a dataset switch the time label stayed on the old dataset (the switch now keeps the valid time); lead time was the step index (now counted from the run).
4. **Stale pages**: the user's phone showed a days-old copy because the server sends no `Cache-Control` for `index.html`. The cPanel `.htaccess` carries a note from university IT not to overwrite it, so it was left alone; `index.html` has a reload guard instead.

**How the page is checked** (no test runner in this repo): `tools/dev/test_server.py` serves this checkout with live data, `tools/dev/check_page.py` drives a headless Chrome, prints element rectangles and texts and saves screenshots (usage in the file headers). Its `LOADED.reg` number is the registration check (see "Georeferencing"). Screenshots go to the `image-reader` subagent, the main model cannot see them. Sizes used: 390x700, 360x640, 844x390, 1440x900.

## Work log 2026-11-11, second session (user's list of ten points)

The user praised the redesign and sent ten requests; all were done in one pass:

1. Click shows where the data come from: ring on the grid point + cell outline, the point stays pinned.
2. Chytrá krajina 2030+ logo in the header next to ČZU; the copy in the map corner (`#logo-container`) was removed.
3. ELEV = 0: cause was `hgt = 0` in every "original" `grid.json`; fixed with the fixed terrain layer. ELEV moved under LAT/LON.
4. Both logos are links (header and About panel).
5. Touchpad zoom: own smooth zoom handler.
6. No value box over the zoom buttons.
7. Projection: the raster is now resampled exactly onto the Mercator map (see "Georeferencing"); variant A of 2026-08-20 is gone.
8. Compact mode button for phones.
9. New precipitation colours and legend.
10. Info chip: SVG icon instead of a serif letter in a CSS circle.

Also fixed on the way: a dataset switch during loading mixed the time steps of two datasets (`loadSeq`); the view jumped back to the whole domain on every dataset switch; "-0.0 °C".

Open items, all the user's call:
- ELEV of the "original" datasets is the 3 km WRF terrain at the cell centre. The drivers' own orography would need an export in `wrf-forecast` (`hgt` in the original `grid.json`).
- `Cache-Control: no-cache` for `index.html` in `.htaccess` would be the clean fix for stale pages; needs the user (or IT) to agree to touch that file.
- On phones the About panel's close button covers the end of a text line while scrolling.
- The server sends `grid.json` (3.1 MB) uncompressed; gzip in `.htaccess` or a smaller grid file from the pipeline would speed up the first load.
- Two logo files show as deleted in the working tree (`logo/CZU_logo_cerna.png`, `logo/logoKV.png`). That was so before this work and was left alone; both still exist in git and on the server, and the page uses them.

## Data flow & file format

1. The HPC pipeline produces, per cycle: N chunk files named `forecast_<TAG2>_d<DOMAIN>_<CHUNK_START_ISO>.json` for WRF (6-hour chunks, e.g. `forecast_GFS_AA_20260815-18_d02_2026-08-17T00.json`) and `forecast_<TAG2>_orig_<CHUNK_START_ISO>.json` for the raw-driver "original" (~25 km) view, organized on the host into `data/<dataset_id>/` folders — 10 datasets since 2026-11-11 (8 from 2026-09-28): `gfs_wrf`, `arpege_wrf`, `icon_wrf`, `gem_wrf`, `ifs_wrf` (3 km WRF) and `gfs_original`, `arpege_original`, `icon_original`, `gem_original`, `ifs_original` (drivers sampled onto the same 0.25° 71×42 crop). Plus `manifest.json` listing the datasets. (`last_run.txt` is no longer used — triggering is cron on skirit.)
2. Each chunk JSON has `grid` (flattened `lat`/`lon`/`hgt` arrays), `metadata` (`run_time`, `domain`, `dx_m`, `nx`, `ny`), and `timesteps[]` (each with `time` plus flattened row-major `temp_c`/`precip_mm` arrays). Precip is **`mm/h` in every dataset** — the original stream de-accumulates the raw GRIB and divides by its 3 h step so it is directly comparable to WRF. `z700_m` was removed from the pipeline entirely (the pressure layer stays disabled client-side).
3. `index.html` on load fetches `manifest.json`, then fetches first chunk **sequentially**, initializes map immediately (progressive loading), then continues fetching remaining chunks in background while updating slider/ticks dynamically. No drag-drop fallback — removed.
4. Rendering: the overlay is a `<canvas>` placed on the Leaflet map (`CanvasOverlay` in map.js). For every canvas pixel a lookup table (`geom.warp`, js/geo.js) names the four grid points around it; the value is interpolated between them and coloured with the linear colour ramps `TEMP_STOPS`/`PREC_STOPS`, so the raster is exact on the Mercator base map (see "Georeferencing"). The grid itself comes from `data/<dataset_id>/grid.json` (`nx`, `ny`, `dx_m`, `lat`, `lon`, `hgt`), not from the chunks. A marching-squares isoline implementation exists for pressure (`z700_m`) but is fully disabled — `renderIsolinesSVG()` is a no-op and the pipeline no longer writes `z700_m`.

## GitHub Actions workflow (removed)

The legacy `.github/workflows/gfs_trigger.yml` — a dead SSH-trigger-to-HPC that referenced long-deleted `scripts/check_gfs.py` / `extract_run.py` / `config.env` — has been **removed** as part of the cPanel migration. Triggering is cron on skirit (`trigger_gfs.sh` / `trigger_arpege.sh` / `trigger_icon.sh` / `trigger_gem.sh` / `trigger_ifs.sh`) in the `wrf-forecast` repo. Don't re-add a GitHub Actions trigger.

## Architektura: rozdělení do modulů — HOTOVO (ověřeno funkční 2026-08-18, aktualizováno 2026-08-18)

Původní jednodílný `index.html` (895 řádků) je rozdělen na HTML + CSS + 7 JS modulů. Mapa, přehrávání, slider, vrstvy, klávesnice i tooltip fungují beze změny chování; `index.html` má nyní ~130 řádků (loader odstraněn).

### Struktura
```
index.html            ← HTML + STATE + COLORMAPS (TEMP_STOPS/PREC_STOPS) + toggleIsolines (mrtvá) + propojení modulů
css/style.css         ← veškeré CSS
data/                 ← složková struktura pro datasety
  gfs_wrf/            ← GFS + WRF chunks (forecast_*_d02_*.json)
  arpege_wrf/         ← ARPEGE + WRF chunks (forecast_*_d02_*.json)
  icon_wrf/           ← ICON + WRF chunks (od 2026-09-28)
  gem_wrf/            ← GEM + WRF chunks (od 2026-09-28)
  ifs_wrf/            ← IFS + WRF chunks (od 2026-11-11)
  gfs_original/       ← GFS ~25 km chunks (forecast_*_orig_*.json, stejný cyklus jako gfs_wrf)
  arpege_original/    ← ARPEGE ~25 km chunks (forecast_*_orig_*.json, stejný cyklus jako arpege_wrf)
  icon_original/      ← ICON (13 km ikosaedrická síť remapovaná na 0.25°) ~25 km chunks
  gem_original/       ← GEM (0.15°) vzorkovaný na stejnou 0.25° síť ~25 km chunks
  ifs_original/       ← IFS (ECMWF open data, 0.25°) ~25 km chunks (od 2026-11-11)
  czechia_boundary.geojson  ← Hranice ČR pro overlay (zatím nepoužito)
logo/                 ← Loga a branding
  CZU_logo_cerna.png  ← Logo univerzity (pro overlay v pravém dolním rohu)
js/
  colors.js           ← lerp, colorAt, getColor, makeShader (rychlá tabulka barev pro render)
  data.js             ← tryLoadManifest, autoLoadFromManifest (progresivní), switchDataset (140+)
  datasets.js         ← initDatasetSwitcher, updateDatasetSwitcher (45)
  layers.js           ← initBoundaryLayer, initLogoOverlay, toggleBoundary (hranice ČR + logo) (85)
  geo.js              ← makeLocator (síť ↔ zeměpisná poloha, Newtonova inverze), mercY/mercLat, buildWarp (tabulka pixel → 4 body sítě)
  map.js              ← initApp, gridGeomFor, CanvasOverlay, initSmoothZoom, render (+ mrtvé marchingSquares/smooth/renderIsolinesSVG)
  controls.js         ← setStep, pragueTime, subText, leadHours, fmtRun, sliderFill, go, togglePlay, cycleSpeed, setVar, updateLegend, setCompact/toggleCompact/initCompact, buildTicks, updateSliderMax
  tooltip.js          ← probe, elevAt, onHover, onMapClick, setPin/unpin/restorePin, refreshTip, placePinnedTip
  app.js              ← keyboard listener (15)
```

### Pořadí `<script>` v index.html — KRITICKÉ, zachovat
`leaflet CDN → colors → data → datasets → layers → boundaries → geo → map → controls → tooltip → credits → hlavní <script> (STATE/COLORMAPS/toggleIsolines) → app.js (poslední)`. `map.js` volá `L.ImageOverlay.extend` už při načtení, takže Leaflet musí být načten před ním.

Důvod: všechny moduly **sdílejí globální stav z hlavního `<script>` bloku** a odkazují na sebe navzájem. Nepoužívají ES moduly (`type="module"`), ale **klasické globální funkce** — každý modul je `<script src="...">` načtený jako globál a volá ostatní **až za běhu**, takže stačí, aby definice existovaly dřív, než se daná funkce skutečně zavolá. `app.js` je záměrně **poslední** (za hlavním blokem), protože registruje keyboard listener volající funkce všech modulů.

### Sdílený stav (zůstává v hlavním `<script>` bloku v index.html)
Globální `let`: `allTimesteps`, `gridData`, `metadata`, `map`, `imgOv`, `isoSvg`, `offCanvas`, `step`, `varName`, `showIso`, `playing`, `playTmr`, `spdIdx`. Konstanty: `SPEEDS`, `TEMP_STOPS`, `PREC_STOPS` (poslední dvě používá i `updateLegend` v controls.js). Mrtvá funkce `toggleIsolines` tu také zůstává (viz níže).

Další globály z data.js: `currentDataset`, `currentManifest`, `terrain` (pevná vrstva terénu), `loadSeq`. Z map.js: `geom` (lokátor, bounds a tabulka `warp` sítě na obrazovce). Z tooltip.js: `pinLL`, `pinInfo`.

### Zápisky k modulům
- **data.js** volá `initApp()` (map.js) po načtení PRVNÍHO chunku (progresivní načítání); čte/píše `allTimesteps`, `gridData`, `metadata`. Obsahuje `switchDataset(datasetId)` pro přepínání mezi datasety a `buildFilePath()` pro skládání cest z `path_prefix`.
- **datasets.js** — `initDatasetSwitcher(manifest)` buduje select element dynamicky z `manifest.datasets`; `updateDatasetSwitcher()` refreshne po změně datasetu.
- **map.js** — `initApp` (spouští ho data.js po načtení gridu) vytváří `map`/`offCanvas`/`imgOv`/`isoSvg`/`geom` a volá `buildTicks`/`setStep(0)`/`updateLegend`/`restorePin`; `offCanvas` je přímo element překryvné vrstvy (`CanvasOverlay`), `render` do něj maluje přes `putImageData` (žádné `toDataURL`), barvy bere z `makeShader` (colors.js) a polohu z `geom.warp` (geo.js).
- **controls.js** čte/píše `step`/`varName`/`playing`/`playTmr`/`spdIdx` a `TEMP_STOPS`/`PREC_STOPS`; volá `render()` (map.js). Obsahuje `updateSliderMax()` pro progresivní aktualizaci slideru.
- **tooltip.js** čte `allTimesteps`/`gridData`/`step`/`map`/`geom`/`terrain`; `initApp` registruje `onHover` (mousemove), `onMapClick` (click), `onMapDblClick`, `hideHover` (mouseout) a `placePinnedTip` (move/zoom). `setStep` volá `refreshTip`.
- **app.js** (keyboard) odkazuje na `allTimesteps` + `go`/`togglePlay`/`setVar`/`toggleIsolines`.

### Dataset switcher (nově 2026-08-18)
Manifest.json podporuje novou strukturu s polem `datasets`. Každý dataset má:
- `id`: unikátní identifikátor (gfs_wrf, arpege_wrf, icon_wrf, gem_wrf, ifs_wrf, gfs_original, arpege_original, icon_original, gem_original, ifs_original — pořadí v manifestu = pořadí v přepínači)
- `label`: zobrazovaný text
- `model`: "GFS", "ARPEGE", "ICON" nebo "GEM"
- `stage`: "wrf" nebo "original"
- `path_prefix`: cesta ke složce (např. "data/gfs_wrf")
- `grid`: {nx, ny, dx_m} — gridové parametry
- `files`: pole filenames (bez cesty — skládá se z `path_prefix` + filename)

`default_dataset` určuje který dataset se načte při startu. Dataset switcher v topbar se postará o UI — datasety bez files jsou zašedlé a neaktivní.

Zpětná kompatibilita: starý manifest bez `datasets` pole se automaticky obalí do defaultního `gfs_wrf` datasetu.

### Progresivní načítání (nově 2026-08-18)
- Mapa se inicializuje PO PRVNÍM CHUNKU — uživatel okamžitě vidí něco na mapě.
- Zbývající chunky se stahují na pozadí a průběžně se přidávají do `allTimesteps`.
- Slider max a ticks se aktualizují přes `updateSliderMax()` a `buildTicks()` při každém novém chunku.
- Loader (#prog) se skryje po první inicializaci mapy.

### Odstraněno (2026-08-18)
- Úvodní loader obrazovka (#loader) s drop-zone byla odstraněna.
- Drag-drop wiring (loadFiles, processJSONs) byl odstraněn z data.js.
- Nyní se mapa rovnou zobrazí s progress spinnerem uprostřed během načítání.

### Grafické vrstvy (nově 2026-08-18)
- **Hranice ČR**: Černá čárkovaná čára přes území ČR pro lepší orientaci na mapě. Vykresleno pomocí L.polyline s manuálně definovanými souřadnicemi hranic.
- **Loga**: ČZU (`.brand-logo`, CSS ořez průhledných okrajů souboru `logo/CZU_logo_cerna.png`) a Chytrá krajina 2030+ (`.brand-kv`) vedle sebe v hlavičce, obě jako odkazy; obě jsou i na konci panelu About.
- **Zarovnání rastru s mapou**: viz „Georeferencing" níže (`getGridBounds()`/`computeCrop()` už neexistují).

### Georeferencing — rastr se převzorkovává přesně do Mercatoru (2026-11-11)
Do 2026-11-11 se rastr položil na mapu jako `L.imageOverlay` ukotvený čtyřmi rohy a vnitřek se lineárně natáhl („varianta A" z 2026-08-20). To je správně jen pro síť, která je v Mercatoru obdélník. Síť WRF taková není: je to **Lambertova konformní síť** (jižní okraj pokrývá 7,3–21,8° v. d., severní 5,8–23,7° v. d.; starší zápis ji mylně nazýval „rotated pole"). Změřená chyba starého postupu (skutečná buňka vs. místo, kam ji Leaflet položil): Praha 6 km, střed západního a východního okraje 63 a 82 km, jižní rohy 120 a 150 km. Ani pravidelné lat/lon sítě „originálů" neseděly: Mercator není lineární v zeměpisné šířce a rastr se navíc kotvil na středy krajních buněk místo na jejich hrany.

Od 2026-11-11 (uživatel si opravu výslovně vyžádal a rozhodnutí nechal na mně):
- `geo.js makeLocator()` řeší inverzi (lat, lon) → (sloupec, řádek) numericky z polí `lat`/`lon` v `grid.json` (Newtonova iterace na bilineárním zobrazení buňky). Projekce se nikde nepředpokládá, takže funguje Lambert, rotovaná i pravidelná síť bez parametrů z `namelist.wps`.
- `buildWarp()` připraví pro plátno 768 px široké (lineární v délce a v Mercatorově souřadnici, přesně jak Leaflet natahuje overlay) tabulku: ke každému pixelu čtyři okolní body sítě a váhy. `render()` hodnotu bilineárně interpoluje a obarví. Okraj domény má vyhlazenou průhlednost (`cov`).
- Buňka má plochu: doména sahá půl kroku za krajní body sítě.
- Kontrola: `tools/dev/check_page.py` tiskne `LOADED.reg`, největší vzdálenost v buňkách mezi skutečnou polohou bodu sítě na obrazovce a bodem, ze kterého byl jeho pixel vykreslen. Naměřeno: WRF do 1 buňky (3 km) při oddálení a do 0,5 buňky při přiblížení, originály do 0,1 buňky.
- Jeden snímek trvá kolem 9 ms (dřív se každý snímek kódoval do PNG).

Orientace pole: grid je row-major `index = row * nx + col`, `row = 0` je jižní okraj (SW → SE), `row = ny-1` severní.

### Mrtvá izobarová funkcionalita — NEožívat
Tlak (`z700_m`) je zcela disabled: tlačítko vrstvy neexistuje, `renderIsolinesSVG()` je no-op a `toggleIsolines` je no-op (žije v hlavním bloku). `marchingSquares`/`smooth`/`renderIsolinesSVG` sedí v map.js jen pro úplnost. Nepoužívat, netrávit čas jejich oživováním.
