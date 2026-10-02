(() => {
  'use strict';

  const CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff]/;

  const state = {
    query: '',
    translation: '',
    split: false
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

  function englishSearchUrl(q) {
    if (detectEngine() === 'google') {
      const u = new URL('/search', location.origin);
      u.searchParams.set('q', q);
      u.searchParams.set('hl', 'en');
      u.searchParams.set('gl', 'us');
      return u.toString();
    }
    const u = new URL('https://www.bing.com/search');
    u.searchParams.set('q', q);
    u.searchParams.set('setlang', 'en');
    u.searchParams.set('mkt', 'en-US');
    return u.toString();
  }

  function translatedSearchUrl(q) {
    // 谷歌自己的搜索结果页经谷歌翻译代理会触发“sorry”人机验证，改用必应结果页翻译，可稳定整页中文化。
    const bing = new URL('https://www.bing.com/search');
    bing.searchParams.set('q', q);
    bing.searchParams.set('setlang', 'en');
    bing.searchParams.set('mkt', 'en-US');
    return (
      'https://translate.google.com/translate?sl=auto&tl=zh-CN&u=' +
      encodeURIComponent(bing.toString())
    );
  }

  function headerTop() {
    const sel = leftSelector();
    const el = sel ? document.querySelector(sel) : null;
    if (el) return Math.max(64, Math.round(el.getBoundingClientRect().top));
    return 120;
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
      '    <button id="bgsp-translate" class="bgsp-chip">🌐 翻译整页</button>' +
      '    <button id="bgsp-newtab" class="bgsp-chip">↗ 新标签打开</button>' +
      '    <button id="bgsp-full" class="bgsp-chip">⛶ 全屏</button>' +
      '    <button id="bgsp-close" class="bgsp-chip">× 关闭</button>' +
      '  </div>' +
      '</div>' +
      '<iframe id="bgsp-frame" class="bgsp-frame" title="英文搜索结果"></iframe>';
    document.body.appendChild(paneEl);
    paneEl.querySelector('#bgsp-full').addEventListener('click', enterFull);
    paneEl.querySelector('#bgsp-close').addEventListener('click', dismissAll);
    paneEl.querySelector('#bgsp-translate').addEventListener('click', () => {
      window.open(translatedSearchUrl(state.translation), '_blank', 'noopener');
    });
    paneEl.querySelector('#bgsp-newtab').addEventListener('click', () => {
      window.open(englishSearchUrl(state.translation), '_blank', 'noopener');
    });
  }

  function syncPaneHeader() {
    if (!paneEl) return;
    paneEl.querySelector('#bgsp-query').innerHTML =
      '中文：' + escapeHtml(state.query) +
      '<span class="bgsp-arrow">→</span>英文：' + escapeHtml(state.translation);
    const frame = paneEl.querySelector('#bgsp-frame');
    const url = englishSearchUrl(state.translation);
    if (frame && frame.getAttribute('src') !== url) {
      frame.setAttribute('src', url);
    }
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

  function dismissAll() {
    state.split = false;
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
  }

  function ensureFab() {
    if (fabEl) return;
    fabEl = document.createElement('button');
    fabEl.id = 'bgsp-fab';
    fabEl.textContent = '⇄ 分屏：查看英文结果';
    document.body.appendChild(fabEl);
    fabEl.addEventListener('click', enterSplit);
    setPaneTop();
  }

  function enterSplit() {
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
    state.split = false;
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
        state.query = q;
        state.translation = t;
        if (settings.autoSplit !== false) {
          enterSplit();
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
