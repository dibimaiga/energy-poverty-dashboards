/*
 * dash-lite: the small runtime these dashboards need to run as static pages.
 *
 * It provides the `dash` object the page scripts use:
 *   dash.data(id)        -> { status, data, columns, message }   (CSV rows arrive as text)
 *   dash.onData(fn)      -> runs fn now, then whenever data or the page width changes
 *   dash.calc(id, def)   -> a value computed from datasets (def.inputs, def.fn)
 *   dash.params()/setParams()/resetParams() -> page filters
 *   dash.colors          -> the eight categorical series colours (CSS variables)
 * and renders a "Data & sources" section listing every dataset, its source and a CSV link.
 *
 * Configure it before loading, with window.DASH_CONFIG = { lang, repo, params, datasets: { id: {...} } }.
 */
(function () {
  'use strict';

  var cfg = window.DASH_CONFIG || {};
  var datasets = cfg.datasets || {};
  var defaults = Object.assign({}, cfg.params || {});
  var params = Object.assign({}, defaults);
  var store = {};
  var calcs = {};
  var calcOrder = [];
  var cache = {};
  var listeners = [];

  var LABELS = {
    fr: {
      sources: 'Données et sources', calcs: 'Valeurs calculées dans la page', source: 'Source\u00a0: ',
      download: 'Télécharger les données (CSV)', updated: 'Données extraites le',
      foot: 'Analyse indépendante à partir de données publiques ; elle n’est ni affiliée à Prosperity, Not Poverty ni approuvée par l’organisation. Code, données et méthode : ',
      failed: 'Échec du chargement'
    },
    en: {
      sources: 'Data and sources', calcs: 'Values computed in the page', source: 'Source: ',
      download: 'Download the data (CSV)', updated: 'Data extracted on',
      foot: 'Independent analysis of public data; not affiliated with or endorsed by Prosperity, Not Poverty. Code, data and method: ',
      failed: 'Failed to load'
    }
  };
  var L = LABELS[cfg.lang] || LABELS.en;

  function parseCSV(text) {
    var rows = [], row = [], cur = '', inQuotes = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (inQuotes) {
        if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; }
        else if (c === '"') inQuotes = false;
        else cur += c;
      } else if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(cur); cur = ''; }
      else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
      else if (c !== '\r') cur += c;
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    var head = rows.shift() || [];
    if (head.length && head[0].charCodeAt(0) === 0xfeff) head[0] = head[0].slice(1);
    var out = [];
    rows.forEach(function (r) {
      if (r.length !== head.length) return;
      var o = {};
      head.forEach(function (h, j) { o[h] = r[j]; });
      out.push(o);
    });
    return { columns: head, rows: out };
  }

  function run(fn) {
    try { fn(); } catch (e) { if (window.console) console.error('[dashboard]', e); }
  }
  function fire() { listeners.forEach(run); }

  var pending = false;
  function schedule() {
    if (pending) return;
    pending = true;
    (window.requestAnimationFrame || window.setTimeout)(function () { pending = false; fire(); });
  }
  function changed() { cache = {}; schedule(); }

  Object.keys(datasets).forEach(function (id) {
    store[id] = { status: 'loading', data: [], columns: [] };
    fetch(datasets[id].url, { cache: 'no-cache' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + datasets[id].url);
        return r.text();
      })
      .then(function (text) {
        var p = parseCSV(text);
        store[id] = { status: 'ok', data: p.rows, columns: p.columns };
        changed();
      })
      .catch(function (e) {
        store[id] = { status: 'error', data: [], columns: [], message: String(e && e.message || e) };
        if (window.console) console.error('[dashboard] dataset ' + id + ':', e);
        changed();
      });
  });

  function resolve(id, stack) {
    if (store[id]) return store[id];
    if (!calcs[id]) return { status: 'missing', data: [], columns: [], message: 'Unknown source: ' + id };
    if (cache[id]) return cache[id];
    if (stack.indexOf(id) !== -1) return { status: 'error', data: [], columns: [], message: 'Circular calculation: ' + id };
    var def = calcs[id], inputs = [], status = 'ok', message = '';
    for (var i = 0; i < def.inputs.length; i++) {
      var r = resolve(def.inputs[i], stack.concat(id));
      if (r.status === 'error' || r.status === 'missing') { status = 'error'; message = def.inputs[i] + ': ' + (r.message || r.status); break; }
      if (r.status !== 'ok') status = 'loading';
      inputs.push(r.data);
    }
    var res;
    if (status !== 'ok') {
      res = { status: status, data: [], columns: [], message: message };
    } else {
      try {
        var value = def.fn.apply(null, inputs);
        var first = Array.isArray(value) ? value[0] : null;
        res = { status: 'ok', data: value, columns: first && typeof first === 'object' ? Object.keys(first) : [] };
      } catch (e) {
        if (window.console) console.error('[dashboard] calculation ' + id + ':', e);
        res = { status: 'error', data: [], columns: [], message: String(e && e.message || e) };
      }
    }
    if (res.status !== 'loading') cache[id] = res;
    return res;
  }

  window.dash = {
    data: function (id) {
      var r = resolve(id, []);
      return { status: r.status, data: r.data, columns: r.columns || [], message: r.message || '', refreshing: false, meta: [] };
    },
    onData: function (fn) { listeners.push(fn); run(fn); },
    calc: function (id, def) {
      if (!def || typeof def.fn !== 'function' || !Array.isArray(def.inputs)) throw new Error('Bad calculation: ' + id);
      if (!calcs[id]) calcOrder.push(id);
      calcs[id] = def;
      cache = {};
    },
    loader: function () {},
    colors: [1, 2, 3, 4, 5, 6, 7, 8].map(function (i) { return 'var(--cds-chart-categorical-' + i + ')'; }),
    refresh: function () {},
    params: function () { return Object.assign({}, params); },
    setParams: function (p) { Object.assign(params, p || {}); fire(); },
    resetParams: function () { params = Object.assign({}, defaults); fire(); },
    setLink: function (name) { try { history.replaceState(null, '', '#' + name); } catch (e) { /* ignore */ } }
  };

  // Redraw when the width changes (not the height: mobile browsers resize while scrolling).
  var lastWidth = window.innerWidth, resizeTimer = null;
  window.addEventListener('resize', function () {
    if (window.innerWidth === lastWidth) return;
    lastWidth = window.innerWidth;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(fire, 120);
  });

  function el(tag, text, attrs) {
    var n = document.createElement(tag);
    if (text) n.textContent = text;
    if (attrs) Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    return n;
  }
  function fmtDate(iso) {
    try {
      return new Date(iso + 'T12:00:00Z').toLocaleDateString(cfg.lang === 'fr' ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    } catch (e) { return iso; }
  }

  function renderSources() {
    var host = document.getElementById('dash-sources');
    if (!host) return;
    var sec = el('section', null, { 'class': 'ds-sources', id: 'sources' });
    sec.appendChild(el('h2', L.sources));
    var ul = el('ul');
    Object.keys(datasets).forEach(function (id) {
      var d = datasets[id];
      var li = el('li');
      li.appendChild(el('b', d.title));
      if (d.description) li.appendChild(document.createTextNode(' — ' + d.description));
      var links = el('span', null, { 'class': 'ds-links' });
      (d.sources || []).forEach(function (s, i) {
        links.appendChild(document.createTextNode(i === 0 ? L.source : ' · '));
        links.appendChild(el('a', s.label, { href: s.url, rel: 'noopener' }));
      });
      if (d.sources && d.sources.length) links.appendChild(document.createTextNode(' · '));
      links.appendChild(el('a', L.download, { href: d.url, download: '' }));
      if (d.extracted) links.appendChild(document.createTextNode(' · ' + L.updated + ' ' + fmtDate(d.extracted)));
      li.appendChild(links);
      ul.appendChild(li);
    });
    sec.appendChild(ul);
    if (calcOrder.length) {
      sec.appendChild(el('h3', L.calcs));
      var cl = el('ul');
      calcOrder.forEach(function (id) {
        var c = calcs[id];
        var li = el('li');
        li.appendChild(el('b', c.title || id));
        if (c.description) li.appendChild(document.createTextNode(' — ' + c.description));
        cl.appendChild(li);
      });
      sec.appendChild(cl);
    }
    var foot = el('p', L.foot, { 'class': 'ds-foot' });
    if (cfg.repo) foot.appendChild(el('a', cfg.repo.replace(/^https?:\/\//, ''), { href: cfg.repo, rel: 'noopener' }));
    sec.appendChild(foot);
    host.replaceChildren(sec);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', renderSources);
  else renderSources();
})();
