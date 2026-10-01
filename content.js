(() => {
  'use strict';

  const CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff]/;
  const RESULT_TARGET = 'zh-CN';

  const state = {
    query: '',
    translation: '',
    results: [],
    translations: null,
    translated: false,
    split: false,
    fetching: false
  };

  let paneEl = null;
  let fabEl = null;
  let previewEl = null;
  let lastQuery = getQuery();
  let lastPath = location.pathname;
  let debounceTimer = null;

  function hasChinese(s) {
    return CJK_RE.test(s || '');
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[c]));
  }

  function escapeAttr(s) {
    return escapeHtml(s).replace(/`/g, '&#96;');
  }

  function detectEngine() {
    const h = location.hostname;
    if (/google\./.test(h)) return 'google';
    if (/so\.com$/.test(h)) return 'so';
    if (/baidu\.com$/.test(h)) return 'baidu';
    if (/bing\.com$/.test(h)) return 'bing';
    return null;
  }

  function getQuery() {
    try {
      const u = new URL(location.href);
      const engine = detectEngine();
      if (engine === 'baidu') {
        return u.searchParams.get('wd') || u.searchParams.get('word') || '';
      }
      return u.searchParams.get('q') || '';
    } catch {
      return '';
    }
  }

  function isSearchPage() {
    const p = location.pathname;
    const engine = detectEngine();
    if (engine === 'google') return /\/search/.test(p);
    if (engine === 'so') return p === '/s' || p === '/search';
    if (engine === 'baidu') return p === '/s';
    if (engine === 'bing') return /\/search/.test(p);
    return false;
  }

  function leftSelector() {
    const engine = detectEngine();
    if (engine === 'google') return '#center_col';
    if (engine === 'so') return '#main';
    if (engine === 'baidu') return '#content_left';
    if (engine === 'bing') return '#b_results';
    return null;
  }

  function searchBox() {
    return document.querySelector(
      'textarea[name="q"], input[name="q"], input[name="wd"], textarea[name="wd"], input#kw, textarea#kw, input#input'
    );
  }

  function sendMessage(msg) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (res) => {
          if (chrome.runtime.lastError) {
            resolve({ ok: false, error: chrome.runtime.lastError.message });
          } else {
            resolve(res);
          }
        });
      } catch (e) {
        resolve({ ok: false, error: String(e) });
      }
    });
  }

  async function getSettings() {
    const r = await sendMessage({ type: 'getSettings' });
    return (r && r.settings) || {};
  }

  async function translate(text, to) {
    const r = await sendMessage({ type: 'translate', text, to });
    if (r && r.ok) return r.text;
    throw new Error((r && r.error) || '翻译失败');
  }

  async function translateBatch(texts, to) {
    const r = await sendMessage({ type: 'translateBatch', texts, to });
    if (r && r.ok) return r.list;
    throw new Error((r && r.error) || '批量翻译失败');
  }

  function cleanUrl(href) {
    try {
      const u = new URL(href);
      if (/\/url$/.test(u.pathname) && u.searchParams.get('url')) {
        return new URL(u.searchParams.get('url')).href;
      }
      return u.href;
    } catch {
      return href;
    }
  }

  function parseGoogleHtml(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const results = [];
    const seen = new Set();
    for (const a of Array.from(doc.querySelectorAll('a[href^="http"]'))) {
      const h3 = a.querySelector('h3');
      if (!h3 || !h3.textContent.trim()) continue;
      const url = cleanUrl(a.href);
      if (seen.has(url)) continue;
      seen.add(url);
      let snippet = '';
      let node = a;
      for (let i = 0; i < 6 && node; i++) {
        node = node.parentElement;
        if (!node) break;
        const sn = node.querySelector('[data-sncf], .VwiC3b, .IsZvec');
        if (sn && sn.textContent.trim()) {
          snippet = sn.textContent.trim();
          break;
        }
      }
      let host = '';
      try {
        host = new URL(url).hostname.replace(/^www\./, '');
      } catch {}
      results.push({ title: h3.textContent.trim(), url, host, snippet });
      if (results.length >= 10) break;
    }
    return results;
  }

  function parseBingHtml(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const results = [];
    for (const b of Array.from(doc.querySelectorAll('li.b_algo'))) {
      const h2 = b.querySelector('h2');
      const a = b.querySelector('h2 a, a[href^="http"]');
      if (!h2 || !a || !h2.textContent.trim()) continue;
      let url;
      try {
        url = new URL(a.href).href;
      } catch {
        continue;
      }
      const sn = b.querySelector('.b_caption p, p');
      let host = '';
      try {
        host = new URL(url).hostname.replace(/^www\./, '');
      } catch {}
      results.push({
        title: h2.textContent.trim(),
        url,
        host,
        snippet: sn ? sn.textContent.trim() : ''
      });
      if (results.length >= 10) break;
    }
    return results;
  }

  async function fetchGoogleSameOrigin(query) {
    try {
      const u = new URL('/search', location.origin);
      u.searchParams.set('q', query);
      u.searchParams.set('hl', 'en');
      u.searchParams.set('gl', 'us');
      u.searchParams.set('num', '10');
      const resp = await fetch(u.toString(), { credentials: 'same-origin' });
      if (resp.ok) {
        const items = parseGoogleHtml(await resp.text());
        if (items.length) return items;
      }
    } catch {}
    return [];
  }

  async function fetchBingResults(query) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const r = await sendMessage({ type: 'fetchBing', query });
      if (r && r.ok) {
        const items = parseBingHtml(r.html);
        if (isRelevant(items, query)) return items;
      }
    }
    return [];
  }

  function isRelevant(items, query) {
    if (!items || !items.length) return false;
    const words = (query || '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 3);
    if (!words.length) return true;
    const text = items
      .map((i) => (i.title + ' ' + i.snippet).toLowerCase())
      .join(' ');
    return words.some(
      (w) => text.includes(w) || text.includes(w.slice(0, 4))
    );
  }

  async function fetchEnglishResults(query) {
    if (detectEngine() === 'google') {
      const items = await fetchGoogleSameOrigin(query);
      if (items.length) return items;
    }
    return fetchBingResults(query);
  }

  function headerTop() {
    const sel = leftSelector();
    const el = sel ? document.querySelector(sel) : null;
    if (el) return Math.max(64, Math.round(el.getBoundingClientRect().top));
    return 120;
  }

  function englishUrl(q) {
    if (detectEngine() === 'google') {
      const u = new URL('https://www.google.com/search');
      u.searchParams.set('q', q);
      u.searchParams.set('hl', 'en');
      return u.toString();
    }
    const u = new URL('https://www.bing.com/search');
    u.searchParams.set('q', q);
    u.searchParams.set('setlang', 'en');
    u.searchParams.set('mkt', 'en-US');
    return u.toString();
  }

  function ensurePane() {
    if (paneEl) return;
    paneEl = document.createElement('div');
    paneEl.id = 'bgsp-pane';
    paneEl.innerHTML =
      '<div class="bgsp-pane-head">' +
      '  <div class="bgsp-pane-title">🌐 中英双语搜索</div>' +
      '  <div class="bgsp-pane-query" id="bgsp-query"></div>' +
      '  <div class="bgsp-pane-actions">' +
      '    <button id="bgsp-tl" class="bgsp-chip">翻译英文结果</button>' +
      '    <button id="bgsp-full" class="bgsp-chip">⛶ 全屏</button>' +
      '  </div>' +
      '</div>' +
      '<div class="bgsp-pane-body" id="bgsp-results"></div>';
    document.body.appendChild(paneEl);
    paneEl.querySelector('#bgsp-full').addEventListener('click', enterFull);
    paneEl.querySelector('#bgsp-tl').addEventListener('click', toggleTranslate);
  }

  function syncPaneHeader() {
    if (!paneEl) return;
    paneEl.querySelector('#bgsp-query').innerHTML =
      '中文：' + escapeHtml(state.query) +
      '<span class="bgsp-arrow">→</span>英文：' + escapeHtml(state.translation);
    const tl = paneEl.querySelector('#bgsp-tl');
    tl.textContent = state.translated ? '翻译英文结果 ✓' : '翻译英文结果';
    tl.classList.toggle('active', state.translated);
  }

  function renderResults() {
    const box = paneEl && paneEl.querySelector('#bgsp-results');
    if (!box) return;
    if (state.fetching) {
      box.innerHTML = '<div class="bgsp-loading">正在获取英文结果…</div>';
      return;
    }
    if (!state.results.length) {
      box.innerHTML =
        '<div class="bgsp-empty">未能获取英文结果。<a href="' +
        escapeAttr(englishUrl(state.translation)) +
        '" target="_blank" rel="noopener">在新标签打开英文搜索</a></div>';
      return;
    }
    box.innerHTML = state.results
      .map((it, i) => {
        const tr = (state.translations && state.translations[i]) || null;
        return (
          '<a class="bgsp-result" href="' + escapeAttr(it.url) + '" target="_blank" rel="noopener">' +
          '<div class="bgsp-result-title">' + escapeHtml(it.title) + '</div>' +
          (tr && tr.title ? '<div class="bgsp-result-zh">' + escapeHtml(tr.title) + '</div>' : '') +
          '<div class="bgsp-result-host">' + escapeHtml(it.host) + '</div>' +
          '<div class="bgsp-result-snippet">' + escapeHtml(it.snippet) + '</div>' +
          (tr && tr.snippet ? '<div class="bgsp-result-zh">' + escapeHtml(tr.snippet) + '</div>' : '') +
          '</a>'
        );
      })
      .join('');
  }

  function setPaneTop() {
    const top = headerTop();
    if (paneEl) paneEl.style.top = top + 'px';
    if (fabEl) fabEl.style.top = (top + 8) + 'px';
  }

  function markLeft(active) {
    const sel = leftSelector();
    const el = sel ? document.querySelector(sel) : null;
    if (el) el.classList.toggle('bgsp-left', active);
  }

  function enterFull() {
    state.split = false;
    document.body.classList.remove('bgsp-split');
    markLeft(false);
    if (paneEl) {
      paneEl.remove();
      paneEl = null;
    }
    ensureFab();
  }

  function ensureFab() {
    if (fabEl) return;
    fabEl = document.createElement('button');
    fabEl.id = 'bgsp-fab';
    fabEl.textContent = '⇄ 分屏：查看英文结果';
    document.body.appendChild(fabEl);
    fabEl.addEventListener('click', async () => {
      await enterSplit(await getSettings());
    });
    setPaneTop();
  }

  async function applyTranslations() {
    if (!state.results.length) {
      state.translations = [];
      return;
    }
    const texts = [];
    state.results.forEach((it) => {
      texts.push(it.title);
      texts.push(it.snippet || '');
    });
    try {
      const list = await translateBatch(texts, RESULT_TARGET);
      state.translations = state.results.map((it, i) => ({
        title: list[i * 2] || '',
        snippet: list[i * 2 + 1] || ''
      }));
    } catch {
      state.translations = state.results.map(() => ({ title: '', snippet: '' }));
    }
  }

  async function toggleTranslate() {
    state.translated = !state.translated;
    syncPaneHeader();
    if (state.translated && state.results.length && !state.translations) {
      await applyTranslations();
    }
    renderResults();
  }

  async function enterSplit(settings) {
    state.split = true;
    document.body.classList.add('bgsp-split');
    markLeft(true);
    if (fabEl) {
      fabEl.remove();
      fabEl = null;
    }
    ensurePane();
    setPaneTop();
    syncPaneHeader();
    if (!state.results.length && !state.fetching) {
      state.fetching = true;
      renderResults();
      const items = await fetchEnglishResults(state.translation);
      state.fetching = false;
      state.results = items;
      if (state.translated && items.length) await applyTranslations();
    }
    renderResults();
  }

  function cleanup() {
    document.body.classList.remove('bgsp-split');
    markLeft(false);
    if (paneEl) {
      paneEl.remove();
      paneEl = null;
    }
    if (fabEl) {
      fabEl.remove();
      fabEl = null;
    }
    state.query = '';
    state.translation = '';
    state.results = [];
    state.translations = null;
    state.translated = false;
    state.split = false;
    state.fetching = false;
  }

  function ensurePreview() {
    if (previewEl) return;
    previewEl = document.createElement('div');
    previewEl.id = 'bgsp-preview';
    previewEl.style.display = 'none';
    document.body.appendChild(previewEl);
  }

  function showPreview(t) {
    ensurePreview();
    previewEl.innerHTML =
      '<span class="bgsp-preview-label">English:</span> ' + escapeHtml(t);
    previewEl.style.display = 'block';
  }

  function hidePreview() {
    if (previewEl) previewEl.style.display = 'none';
  }

  function attachHomepage() {
    const box = searchBox();
    if (!box || box.dataset.bgspBound) return;
    box.dataset.bgspBound = '1';
    box.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      const val = box.value.trim();
      if (!val || !hasChinese(val)) {
        hidePreview();
        return;
      }
      debounceTimer = setTimeout(async () => {
        try {
          showPreview(await translate(val, 'en'));
        } catch {
          hidePreview();
        }
      }, 500);
    });
  }

  async function run() {
    let settings = {};
    try {
      settings = await getSettings();
    } catch {
      return;
    }
    if (settings.autoTranslate === false) {
      cleanup();
      return;
    }
    if (isSearchPage()) {
      const q = getQuery();
      if (q && hasChinese(q)) {
        let t;
        try {
          t = await translate(q, settings.targetLang || 'en');
        } catch {
          return;
        }
        const isNew = state.query !== q;
        if (isNew) {
          state.results = [];
          state.translations = null;
          state.translated = !!settings.translateResults;
        }
        state.query = q;
        state.translation = t;
        if (settings.autoSplit !== false) {
          await enterSplit(settings);
        } else {
          enterFull();
        }
      } else {
        cleanup();
      }
    } else {
      hidePreview();
      attachHomepage();
    }
  }

  window.addEventListener('resize', setPaneTop);

  setInterval(() => {
    const q = getQuery();
    if (q !== lastQuery || location.pathname !== lastPath) {
      lastQuery = q;
      lastPath = location.pathname;
      cleanup();
      run();
    }
  }, 1000);

  run();
})();
