// ══════════════════════════════════════════════════════════════════════════
//  CREDITS — data-source attribution required by the providers' licences.
//  Wording taken from the providers' own licence pages (checked 2026-11-10):
//    ECMWF  apps.ecmwf.int/datasets/licences/general/      (CC BY 4.0 + Terms of Use)
//    DWD    dwd.de/EN/service/legal_notice/templates_dwd_as_source.html (CC BY 4.0)
//    Météo-France  data.gouv.fr "Paquets Arpège 0,25°"      (Licence Ouverte 2.0)
//    ECCC   eccc-msc.github.io/open-data/licence/readme_en/ (Data Server End-use Licence)
//    NOAA   weather.gov/disclaimer                          (public domain)
//  Keyed by the `model` field of a dataset in manifest.json. A model without
//  an entry shows a plain "DATA: <model>" line.
//  Loaded before app.js; updateCredits() is called from initApp() (map.js),
//  i.e. after every dataset switch.
// ══════════════════════════════════════════════════════════════════════════
const CREDITS = {
  IFS: {
    short: 'ECMWF',
    provider: 'European Centre for Medium-Range Weather Forecasts (ECMWF)',
    product: 'IFS open data, 0.25°',
    statement: 'This service is based on data and products of the European Centre for Medium-Range Weather Forecasts (ECMWF).',
    source: {text: 'www.ecmwf.int', href: 'https://www.ecmwf.int/'},
    licence: {text: 'This ECMWF data is published under a Creative Commons Attribution 4.0 International (CC BY 4.0).',
              href: 'https://creativecommons.org/licenses/by/4.0/'},
    disclaimer: 'ECMWF does not accept any liability whatsoever for any error or omission in the data, their availability, or for any loss or damage arising from their use.',
  },
  ICON: {
    short: 'Deutscher Wetterdienst',
    provider: 'Deutscher Wetterdienst (DWD)',
    product: 'ICON global',
    statement: 'Based on data from Deutscher Wetterdienst, gridded data reproduced graphically.',
    source: {text: 'www.dwd.de', href: 'https://www.dwd.de/'},
    licence: {text: 'Creative Commons Attribution 4.0 International (CC BY 4.0).',
              href: 'https://creativecommons.org/licenses/by/4.0/'},
  },
  ARPEGE: {
    short: 'Météo-France',
    provider: 'Météo-France',
    product: 'ARPEGE, 0.25°',
    statement: 'Source: Météo-France. Original data: "Paquets Arpège - Résolution 0,25°"; the date of the data is the model run shown in the top bar.',
    source: {text: 'data.gouv.fr — Paquets Arpège 0,25°', href: 'https://www.data.gouv.fr/datasets/paquets-arpege-resolution-0-25deg'},
    licence: {text: 'Licence Ouverte / Open Licence version 2.0.',
              href: 'https://www.etalab.gouv.fr/licence-ouverte-open-licence'},
  },
  GEM: {
    short: 'Environment and Climate Change Canada',
    provider: 'Environment and Climate Change Canada (ECCC)',
    product: 'GDPS (GEM global), 15 km',
    statement: 'Data Source: Environment and Climate Change Canada.',
    source: {text: 'MSC Open Data', href: 'https://eccc-msc.github.io/open-data/'},
    licence: {text: 'Data Server End-use Licence of Environment and Climate Change Canada.',
              href: 'https://eccc-msc.github.io/open-data/licence/readme_en/'},
  },
  GFS: {
    short: 'NOAA/NCEP',
    provider: 'NOAA / National Centers for Environmental Prediction (NCEP)',
    product: 'GFS, 0.25°',
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

// Short always-visible credit of the driver that is on the map right now.
function creditLineText(model){
  const c = creditFor(model);
  return 'DATA: ' + (c ? c.short : (model || '—'));
}

function _esc(s){
  return String(s).replace(/[&<>"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]));
}

function _creditHtml(model){
  const c = CREDITS[model];
  let h = '<div class="cr-item"><div class="cr-name">' + _esc(model) + ' — ' + _esc(c.provider) + '</div>';
  h += '<div class="cr-prod">' + _esc(c.product) + '</div>';
  h += '<div class="cr-text">' + _esc(c.statement) + '</div>';
  h += '<div class="cr-text">Source: <a href="' + c.source.href + '" target="_blank" rel="noopener">' + _esc(c.source.text) + '</a></div>';
  h += '<div class="cr-text">Licence: <a href="' + c.licence.href + '" target="_blank" rel="noopener">' + _esc(c.licence.text) + '</a></div>';
  if(c.disclaimer) h += '<div class="cr-text">Disclaimer: ' + _esc(c.disclaimer) + '</div>';
  return h + '</div>';
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
function updateCredits(){
  const model = (typeof currentDataset !== 'undefined' && currentDataset) ? currentDataset.model : null;
  const link = document.getElementById('m-src');
  if(link) link.textContent = creditLineText(model);
  const c = creditFor(model);
  if(typeof map !== 'undefined' && map && map.attributionControl && c){
    map.attributionControl.setPrefix(_esc(c.statement) + ' <a href="' + c.licence.href +
      '" target="_blank" rel="noopener">Licence</a>');
  }
}

document.addEventListener('DOMContentLoaded', buildCreditsPanel);
document.addEventListener('keydown', e => { if(e.key === 'Escape') toggleCredits(false); });
