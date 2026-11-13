// ══════════════════════════════════════════════════════════════════════════
//  CREDITS — data-source attribution required by the providers' licences.
//  Wording taken from the providers' own licence pages (checked 2026-11-10):
//    ECMWF  apps.ecmwf.int/datasets/licences/general/      (CC BY 4.0 + Terms of Use)
//    DWD    dwd.de/EN/service/legal_notice/templates_dwd_as_source.html (CC BY 4.0)
//    Météo-France  data.gouv.fr "Paquets Arpège 0,25°"      (Licence Ouverte 2.0)
//    ECCC   eccc-msc.github.io/open-data/licence/readme_en/ (Data Server End-use Licence)
//    NOAA   weather.gov/disclaimer                          (public domain)
//  Keyed by the `model` field of a dataset in manifest.json. A model without
//  an entry shows a plain "Data: <model>" line.
//
//  `badge` is the name tile shown next to each source in the About panel. It
//  is plain text on purpose, NOT the provider's logo (checked 2026-11-13):
//    NOAA    emblem "may not be used ... on products (including webpages) that
//            are not NOAA-sponsored without written consent"
//            (omao.noaa.gov/image-licensing-usage-info, noaa.gov/noaa-emblem-usage-and-licensing)
//    ECCC    the licence "does not grant you any right to use: the names,
//            crests, logos, or other official symbols" (section 4)
//    Météo-France  name and logo are trade marks; any use needs prior written
//            consent (meteofrance.fr/droits-de-reproduction, conditions générales de vente)
//    ECMWF   logo allowed only as a link to the ECMWF web sites (ecmwf.int/en/terms-use)
//    DWD     no rule found
//  A real logo may be added only with the provider's written consent.
//  `product` names the grid the same way everywhere: degrees and kilometres.
//  Loaded before app.js; updateCredits() is called from initApp() (map.js),
//  i.e. after every dataset switch.
// ══════════════════════════════════════════════════════════════════════════
const CREDITS = {
  IFS: {
    short: 'ECMWF',
    abbr: 'ECMWF',
    provider: 'European Centre for Medium-Range Weather Forecasts (ECMWF)',
    product: 'IFS open data, 0.25° (~25 km)',
    badge: {name: 'ECMWF', place: 'Europe'},
    statement: 'This service is based on data and products of the European Centre for Medium-Range Weather Forecasts (ECMWF).',
    source: {text: 'www.ecmwf.int', href: 'https://www.ecmwf.int/'},
    licence: {text: 'This ECMWF data is published under a Creative Commons Attribution 4.0 International (CC BY 4.0).',
              href: 'https://creativecommons.org/licenses/by/4.0/'},
    disclaimer: 'ECMWF does not accept any liability whatsoever for any error or omission in the data, their availability, or for any loss or damage arising from their use.',
  },
  ICON: {
    short: 'Deutscher Wetterdienst',
    abbr: 'DWD',
    provider: 'Deutscher Wetterdienst (DWD)',
    product: 'ICON global, 13 km icosahedral grid, shown here at 0.125° (~13 km)',
    badge: {name: 'DWD', place: 'Germany'},
    statement: 'Based on data from Deutscher Wetterdienst, gridded data reproduced graphically.',
    source: {text: 'www.dwd.de', href: 'https://www.dwd.de/'},
    licence: {text: 'Creative Commons Attribution 4.0 International (CC BY 4.0).',
              href: 'https://creativecommons.org/licenses/by/4.0/'},
  },
  ARPEGE: {
    short: 'Météo-France',
    abbr: 'Météo-France',
    provider: 'Météo-France',
    product: 'ARPEGE, 0.25° (~25 km)',
    badge: {name: 'Météo-France', place: 'France'},
    statement: 'Source: Météo-France. Original data: "Paquets Arpège - Résolution 0,25°"; the date of the data is the model run shown on this page.',
    source: {text: 'data.gouv.fr — Paquets Arpège 0,25°', href: 'https://www.data.gouv.fr/datasets/paquets-arpege-resolution-0-25deg'},
    licence: {text: 'Licence Ouverte / Open Licence version 2.0.',
              href: 'https://www.etalab.gouv.fr/licence-ouverte-open-licence'},
  },
  GEM: {
    short: 'Environment and Climate Change Canada',
    abbr: 'ECCC',
    provider: 'Environment and Climate Change Canada (ECCC)',
    product: 'GDPS (GEM global), 0.15° (~15 km)',
    badge: {name: 'ECCC', place: 'Canada'},
    statement: 'Data Source: Environment and Climate Change Canada.',
    source: {text: 'MSC Open Data', href: 'https://eccc-msc.github.io/open-data/'},
    licence: {text: 'Data Server End-use Licence of Environment and Climate Change Canada.',
              href: 'https://eccc-msc.github.io/open-data/licence/readme_en/'},
  },
  GFS: {
    short: 'NOAA/NCEP',
    abbr: 'NOAA',
    provider: 'NOAA / National Centers for Environmental Prediction (NCEP)',
    product: 'GFS, 0.25° (~25 km)',
    badge: {name: 'NOAA', place: 'United States'},
    statement: 'Data: NOAA/NCEP Global Forecast System (GFS).',
    source: {text: 'nomads.ncep.noaa.gov', href: 'https://nomads.ncep.noaa.gov/'},
    licence: {text: 'Public domain (U.S. Government work).',
              href: 'https://www.weather.gov/disclaimer'},
  },
};
const CREDITS_ORDER = ['GFS', 'ARPEGE', 'ICON', 'GEM', 'IFS'];

function creditFor(model){
  return CREDITS[model] || null;
}

// Text of the header chip: the provider of the driver that is on the map.
function creditLineText(model){
  const c = creditFor(model);
  return 'Data: ' + (c ? c.abbr : (model || '—'));
}

function _esc(s){
  return String(s).replace(/[&<>"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]));
}

function _creditHtml(model){
  const c = CREDITS[model];
  const b = c.badge;
  let h = '<div class="cr-item has-badge">';
  if(b) h += '<a class="cr-badge" href="' + c.source.href + '" target="_blank" rel="noopener" title="' + _esc(c.provider) + '">' +
             '<span class="bn">' + _esc(b.name) + '</span><span class="bp">' + _esc(b.place) + '</span></a>';
  h += '<div class="cr-body"><div class="cr-name">' + _esc(model) + ' · ' + _esc(c.provider) + '</div>';
  h += '<div class="cr-prod">' + _esc(c.product) + '</div>';
  h += '<div class="cr-text">' + _esc(c.statement) + '</div>';
  h += '<div class="cr-text">Source: <a href="' + c.source.href + '" target="_blank" rel="noopener">' + _esc(c.source.text) + '</a></div>';
  h += '<div class="cr-text">Licence: <a href="' + c.licence.href + '" target="_blank" rel="noopener">' + _esc(c.licence.text.replace(/\.$/, '')) + '</a>.</div>';
  if(c.disclaimer) h += '<div class="cr-text">Disclaimer: ' + _esc(c.disclaimer) + '</div>';
  return h + '</div></div>';
}

function buildCreditsPanel(){
  const body = document.getElementById('credits-body');
  if(!body) return;
  body.innerHTML = CREDITS_ORDER.filter(m => CREDITS[m]).map(_creditHtml).join('');
}

function toggleCredits(show){
  const p = document.getElementById('credits');
  if(!p) return;
  const open = (typeof show === 'boolean') ? show : p.style.display !== 'block';
  p.style.display = open ? 'block' : 'none';
}

// Called by initApp() after the map exists (i.e. after every dataset switch).
// Fills the header chip and the always-visible credit line in the bottom panel
// with the provider's required statement.
function updateCredits(){
  const model = (typeof currentDataset !== 'undefined' && currentDataset) ? currentDataset.model : null;
  const link = document.getElementById('m-src');
  if(link){
    // "Data: " sits in its own span: phones show only the provider (css .chip-pre).
    const t = creditLineText(model);
    link.innerHTML = '<span class="chip-pre">Data: </span>' + _esc(t.replace(/^Data: /, ''));
  }
  const c = creditFor(model);
  const line = document.getElementById('credit-text');
  if(line) line.textContent = c ? c.statement : ('Data: ' + (model || '—') + '.');
  // One-line credit that stays on screen in compact mode (controls.js).
  const short = document.getElementById('credit-short-text');
  if(short) short.textContent = creditLineText(model);
}

document.addEventListener('DOMContentLoaded', buildCreditsPanel);
// Esc closes the About panel; with the panel closed it releases the pinned
// point on the map (js/tooltip.js).
document.addEventListener('keydown', e => {
  if(e.key !== 'Escape') return;
  const p = document.getElementById('credits');
  if(p && p.style.display === 'block') toggleCredits(false);
  else if(typeof unpin === 'function') unpin();
});
