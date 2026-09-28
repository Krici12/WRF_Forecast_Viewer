# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

A static, single-page WRF/GFS weather forecast viewer. There is no build system, package manager, or test suite — `index.html` is a self-contained vanilla-JS/Leaflet app, and the rest of the repo is the forecast data it reads.

This repo is **not** where forecasts are generated, and — since the cPanel migration — it is **not** where forecast data is published either. A pipeline on Metacentrum HPC (repo `wrf-forecast`) computes the WRF run, postprocesses it into JSON chunks + `manifest.json`, stages them under `web-stage/`, and that `data/` + `manifest.json` tree is uploaded to the **cPanel** host's `public_html/` (currently by hand — the Metacentrum→cPanel link is not live yet). This repo holds the **frontend app** (`index.html`/`css`/`js`/`logo`); the `data/` files committed here are samples/placeholders, not the live feed. GitHub Pages is no longer used.

## Previewing locally

Opening `index.html` directly via `file://` will fail — its `fetch('manifest.json')` calls need an HTTP origin. Serve it locally instead:

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

There's no linter or test command; verify UI changes by loading the page in a browser and checking the map renders, the time slider/playback works, and hovering the map shows the tooltip.

## Deploying

The site is hosted on the university **cPanel** host only (GitHub Pages retired). Two independent concerns, kept separate on purpose:

1. **Frontend app** (this repo: `index.html`/`css`/`js`/`logo`) — deployed by hand from a machine with cPanel access, via `rclone` (the cPanel host has no `rsync` binary). **Exclude `data/**` and `manifest.json`** so a frontend deploy never clobbers the live forecast data the HPC uploads.

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

## Data flow & file format

1. The HPC pipeline produces, per cycle: N chunk files named `forecast_<TAG2>_d<DOMAIN>_<CHUNK_START_ISO>.json` for WRF (6-hour chunks, e.g. `forecast_GFS_AA_20260815-18_d02_2026-08-17T00.json`) and `forecast_<TAG2>_orig_<CHUNK_START_ISO>.json` for the raw-driver "original" (~25 km) view, organized on the host into `data/<dataset_id>/` folders — 8 datasets since 2026-09-28: `gfs_wrf`, `arpege_wrf`, `icon_wrf`, `gem_wrf` (3 km WRF) and `gfs_original`, `arpege_original`, `icon_original`, `gem_original` (drivers sampled onto the same 0.25° 71×42 crop). Plus `manifest.json` listing the datasets. (`last_run.txt` is no longer used — triggering is cron on skirit.)
2. Each chunk JSON has `grid` (flattened `lat`/`lon`/`hgt` arrays), `metadata` (`run_time`, `domain`, `dx_m`, `nx`, `ny`), and `timesteps[]` (each with `time` plus flattened row-major `temp_c`/`precip_mm` arrays). Precip is **`mm/h` in every dataset** — the original stream de-accumulates the raw GRIB and divides by its 3 h step so it is directly comparable to WRF. `z700_m` was removed from the pipeline entirely (the pressure layer stays disabled client-side).
3. `index.html` on load fetches `manifest.json`, then fetches first chunk **sequentially**, initializes map immediately (progressive loading), then continues fetching remaining chunks in background while updating slider/ticks dynamically. No drag-drop fallback — removed.
4. Rendering: values are painted onto an offscreen `<canvas>` per timestep using linear-interpolated color ramps (`TEMP_STOPS`/`PREC_STOPS`), then blitted onto the Leaflet map as an `imageOverlay`. A marching-squares isoline implementation exists for pressure (`z700_m`) but is currently fully disabled — `renderIsolinesSVG()` is a no-op, the pressure layer button is disabled, and `z700_m` is deleted from every timestep right after load.

## GitHub Actions workflow (removed)

The legacy `.github/workflows/gfs_trigger.yml` — a dead SSH-trigger-to-HPC that referenced long-deleted `scripts/check_gfs.py` / `extract_run.py` / `config.env` — has been **removed** as part of the cPanel migration. Triggering is cron on skirit (`trigger_gfs.sh` / `trigger_arpege.sh` / `trigger_icon.sh` / `trigger_gem.sh`) in the `wrf-forecast` repo. Don't re-add a GitHub Actions trigger.

## Architektura: rozdělení do modulů — HOTOVO (ověřeno funkční 2026-08-18, aktualizováno 2026-08-18)

Původní jednodílný `index.html` (895 řádků) je rozdělen na HTML + CSS + 7 JS modulů. Mapa, přehrávání, slider, vrstvy, klávesnice i tooltip fungují beze změny chování; `index.html` má nyní ~130 řádků (loader odstraněn).

### Struktura
```
index.html            ← HTML + STATE + COLORMAPS (TEMP_STOPS/PREC_STOPS) + toggleIsolines (mrtvá) + propojení modulů (~130 řádků)
css/style.css         ← veškeré CSS (260)
data/                 ← složková struktura pro datasety
  gfs_wrf/            ← GFS + WRF chunks (forecast_*_d02_*.json)
  arpege_wrf/         ← ARPEGE + WRF chunks (forecast_*_d02_*.json)
  icon_wrf/           ← ICON + WRF chunks (od 2026-09-28)
  gem_wrf/            ← GEM + WRF chunks (od 2026-09-28)
  gfs_original/       ← GFS ~25 km chunks (forecast_*_orig_*.json, stejný cyklus jako gfs_wrf)
  arpege_original/    ← ARPEGE ~25 km chunks (forecast_*_orig_*.json, stejný cyklus jako arpege_wrf)
  icon_original/      ← ICON (13 km ikosaedrická síť remapovaná na 0.25°) ~25 km chunks
  gem_original/       ← GEM (0.15°) vzorkovaný na stejnou 0.25° síť ~25 km chunks
  czechia_boundary.geojson  ← Hranice ČR pro overlay (zatím nepoužito)
logo/                 ← Loga a branding
  CZU_logo_cerna.png  ← Logo univerzity (pro overlay v pravém dolním rohu)
js/
  colors.js           ← lerp, colorAt, getColor (28)
  data.js             ← tryLoadManifest, autoLoadFromManifest (progresivní), switchDataset (140+)
  datasets.js         ← initDatasetSwitcher, updateDatasetSwitcher (45)
  layers.js           ← initBoundaryLayer, initLogoOverlay, toggleBoundary (hranice ČR + logo) (85)
  map.js              ← initApp, getGridBounds, render (+ mrtvé marchingSquares/smooth/renderIsolinesSVG) (210+)
  controls.js         ← setStep, toCEST, go, togglePlay, cycleSpeed, setVar, updateLegend, buildTicks, updateSliderMax (140+)
  tooltip.js          ← onHover (60)
  app.js              ← keyboard listener (15)
```

### Pořadí `<script>` v index.html — KRITICKÉ, zachovat
`leaflet CDN → colors → data → datasets → map → controls → tooltip → hlavní <script> (STATE/COLORMAPS/toggleIsolines) → app.js (poslední)`.

Důvod: všechny moduly **sdílejí globální stav z hlavního `<script>` bloku** a odkazují na sebe navzájem. Nepoužívají ES moduly (`type="module"`), ale **klasické globální funkce** — každý modul je `<script src="...">` načtený jako globál a volá ostatní **až za běhu**, takže stačí, aby definice existovaly dřív, než se daná funkce skutečně zavolá. `app.js` je záměrně **poslední** (za hlavním blokem), protože registruje keyboard listener volající funkce všech modulů.

### Sdílený stav (zůstává v hlavním `<script>` bloku v index.html)
Globální `let`: `allTimesteps`, `gridData`, `metadata`, `map`, `imgOv`, `isoSvg`, `offCanvas`, `step`, `varName`, `showIso`, `playing`, `playTmr`, `spdIdx`. Konstanty: `SPEEDS`, `TEMP_STOPS`, `PREC_STOPS` (poslední dvě používá i `updateLegend` v controls.js). Mrtvá funkce `toggleIsolines` tu také zůstává (viz níže).

Další globály z data.js: `currentDataset`, `currentManifest`.

### Zápisky k modulům
- **data.js** volá `initApp()` (map.js) po načtení PRVNÍHO chunku (progresivní načítání); čte/píše `allTimesteps`, `gridData`, `metadata`. Obsahuje `switchDataset(datasetId)` pro přepínání mezi datasety a `buildFilePath()` pro skládání cest z `path_prefix`.
- **datasets.js** — `initDatasetSwitcher(manifest)` buduje select element dynamicky z `manifest.datasets`; `updateDatasetSwitcher()` refreshne po změně datasetu.
- **map.js** — `initApp` (spouští ho data.js po prvním chunku) vytváří `map`/`offCanvas`/`imgOv`/`isoSvg` a volá `buildTicks`/`setStep(0)`/`updateLegend`/`onHover`; `render` píše na `offCanvas`/`imgOv` a volá `getColor` (colors.js) + `renderIsolinesSVG`.
- **controls.js** čte/píše `step`/`varName`/`playing`/`playTmr`/`spdIdx` a `TEMP_STOPS`/`PREC_STOPS`; volá `render()` (map.js). Obsahuje `updateSliderMax()` pro progresivní aktualizaci slideru.
- **tooltip.js** (`onHover`) čte `allTimesteps`/`gridData`/`step`/`map`; registruje ji `initApp` jako `mousemove` handler.
- **app.js** (keyboard) odkazuje na `allTimesteps` + `go`/`togglePlay`/`setVar`/`toggleIsolines`.

### Dataset switcher (nově 2026-08-18)
Manifest.json podporuje novou strukturu s polem `datasets`. Každý dataset má:
- `id`: unikátní identifikátor (gfs_wrf, arpege_wrf, icon_wrf, gem_wrf, gfs_original, arpege_original, icon_original, gem_original — pořadí v manifestu = pořadí v přepínači)
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
- **Logo CZU**: Logo univerzity v pravém dolním rohu nad legendou (poloha: bottom: 150px, right: 14px). Průhledné (opacity: 0.85), zvětší se při hoveru.
- **Pixel alignment**: `getGridBounds()` nyní správně počítá bounds z úhlových bodů gridu (BL, BR, TL, TR) pro přesné zarovnání vizualizace s mapou.

### Natočená WRF síť vs. čistě lat/lon originály — proč okraje sedí hůř než střed (2026-08-20)
**Problém (záměrně ponechán = varianta A):** Na mapě jsou dva druhy rastru — 3 km WRF (`*_wrf`) a ~25 km „originál" (`*_original`). Oba se jako `L.imageOverlay` položí na mapu jen tím, že se ukotví **4 rohy obdélníku** (`setBounds`: BL/BR/TL/TR) a vnitřek se mezi nimi lineárně protáhne. To předpokládá, že grid je **rovnoběžkový** (lat/lon zarovnaný se severojižním/mezidélkovým směrem).

WRF grid takový **není**: je to **natočená síť (rotated pole), natočená o ~3° kolem osy lon ≈ 13°E** (střední Evropa). Změřeno z `gfs_wrf/grid.json` (384×384, 3 km):
- lat se v rámci jednoho řádku mění až o ~0.3° (není konstantní), lon v rámci sloupce až o ~1.5°;
- geometrický box domény je lat 44.55..55.18 / lon 5.76..23.69, ale jeho **rohy NEjsou rovnoběžkové** (např. TL=54.93N/5.76E vs. TR=54.80N/23.69E → horní hrana je šikmá).

**Orientace rastru v `render()` / pole pořadí:** grid je row-major `index = row * nx + col`; první řádek (`row=0`) je dolní levý okraj → dolní pravý (SW→SE), poslední řádek (`row=ny-1`) je horní (NW→NE). `render()` zrcadlí svisle (SW→NW), aby byl rastr na obrazovce správně.

**Důsledek — velikost odchylky (skutečná buňka vs. místo, kam ji Leaflet položí):**
| Poloha | Odchylka |
|---|---|
| střed (Česko / povodí Ohře) | ~27 km (téměř neznatelné) |
| sever (Polsko) | 47–74 km |
| jih (Itálie) | 172–213 km |

Proto Česko + Ohře (Sněžka, Praha) sedí „krásně" a okraje (Itálie/Polsko) ujíždějí. Je to **inherentní limit přístupu** rohově-ukotveného `imageOverlay`, NE chyba dat ani renderu. Stejná odchylka se týká jak WRF rastru vs. podkladu, tak 3 km vs. 25 km rastru mezi sebou (oba sedí jen v oblastech, kde se rozteč shoduje).

**Rozhodnutí (2026-08-20, potvrzeno uživatelem — varianta A):** Nechat být. Zájmové území (ČR + Ohře) leží blízko středu, kde odchylka mizí; okraje mimo zájem. **Neměnit** stávající implementaci, nepřidávat warping/afinní transformaci rastru.

**Kdyby se k tomu v budoucnu vracelo (jak by se to opravilo — varianta B):**
1. V `postprocess/` (repo `wrf-forecast`) **otočit/projektovat rastre do natočené WRF geometrie**: znát transformaci buňka↔lat/lon (rotated pole) WRF sítě a projektovat do ní jak 25 km originál, tak (volitelně) znovu rozvrhnout i samotný 3 km rastr → oba by seděly přesně na okrajích i ve středu.
2. Přesněji: místo 4-rohového `setBounds` by šel rastr **warpovat po buňkách** (per-cell affine/projektivní transformace) tak, aby seděl na Mercator podkladu — ale to je v tomto setupu bez knihovny pracné.
3. Alternativně zvýšit počet kotvicích bodů (dělený/denser `imageOverlay`), to ale jen zmenší odchylku, neodstraní ji.
Závěr: **skutečná náprava je registrace do natočené sítě v postprocessu (varianta B)**; do té doby platí varianta A.

### Mrtvá izobarová funkcionalita — NEožívat
Tlak (`z700_m`) je zcela disabled: tlačítko vrstvy je disabled, `renderIsolinesSVG()` je no-op a `toggleIsolines` je no-op (žije v hlavním bloku). `marchingSquares`/`smooth`/`renderIsolinesSVG` sedí v map.js jen pro úplnost. Nepoužívat, netrávit čas jejich oživováním.
