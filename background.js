const DEFAULT_SETTINGS = {
  autoTranslate: true,
  autoSplit: true,
  translateResults: false,
  provider: 'google',
  apiKey: '',
  targetLang: 'en'
};

async function getSettings() {
  const data = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  return { ...DEFAULT_SETTINGS, ...data };
}

chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  await chrome.storage.sync.set({ ...DEFAULT_SETTINGS, ...current });
});

function translateGoogle(text, to) {
  const url =
    'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=' +
    encodeURIComponent(to) +
    '&dt=t&dj=1&q=' +
    encodeURIComponent(text);
  return fetch(url).then(async (r) => {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const data = await r.json();
    if (data && Array.isArray(data.sentences)) {
      return data.sentences.map((s) => s.trans).join('');
    }
    if (Array.isArray(data) && Array.isArray(data[0])) {
      return data[0].map((seg) => seg[0]).join('');
    }
    throw new Error('Unexpected translate response');
  });
}

function translateMyMemory(text, to) {
  const url =
    'https://api.mymemory.translated.net/get?q=' +
    encodeURIComponent(text) +
    '&langpair=zh|' +
    encodeURIComponent(to);
  return fetch(url).then(async (r) => {
    const data = await r.json();
    if (data && data.responseStatus === 200) {
      return data.responseData.translatedText;
    }
    throw new Error((data && data.responseDetails) || 'MyMemory error');
  });
}

async function translateDeepL(text, to, apiKey) {
  if (!apiKey) throw new Error('请先在插件设置中填写 DeepL API Key');
  const body = new URLSearchParams({
    text,
    target_lang: (to || 'en').toUpperCase()
  });
  const res = await fetch('https://api-free.deepl.com/v2/translate', {
    method: 'POST',
    headers: {
      Authorization: 'DeepL-Auth-Key ' + apiKey,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: body.toString()
  });
  if (!res.ok) throw new Error('DeepL HTTP ' + res.status);
  const data = await res.json();
  const out = data.translations && data.translations[0] && data.translations[0].text;
  if (!out) throw new Error('DeepL empty result');
  return out;
}

async function translateOpenAI(text, to, apiKey) {
  if (!apiKey) throw new Error('请先在插件设置中填写 OpenAI API Key');
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + apiKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content:
            'You are a translator. Translate the user input into ' +
            (to || 'en') +
            '. Return only the translation, no extra text.'
        },
        { role: 'user', content: text }
      ],
      temperature: 0
    })
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error('OpenAI HTTP ' + res.status + ' ' + detail.slice(0, 200));
  }
  const data = await res.json();
  const out =
    data.choices &&
    data.choices[0] &&
    data.choices[0].message &&
    data.choices[0].message.content;
  if (!out) throw new Error('OpenAI empty result');
  return out.trim();
}

async function doTranslate(text, to, settings) {
  switch (settings.provider) {
    case 'mymemory':
      return translateMyMemory(text, to);
    case 'deepl':
      return translateDeepL(text, to, settings.apiKey);
    case 'openai':
      return translateOpenAI(text, to, settings.apiKey);
    default:
      return translateGoogle(text, to);
  }
}

function translateGoogleBatch(texts, to) {
  const params = new URLSearchParams({ client: 'gtx', sl: 'auto', tl: to, dt: 't', dj: '1' });
  for (const t of texts) params.append('q', t);
  return fetch('https://translate.googleapis.com/translate_a/single?' + params.toString()).then(async (r) => {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const data = await r.json();
    if (data && Array.isArray(data.sentences)) {
      return data.sentences.map((s) => s.trans || '');
    }
    throw new Error('unexpected batch response');
  });
}

async function doTranslateBatch(texts, to, settings) {
  if (!texts || !texts.length) return [];
  if (settings.provider === 'google') return translateGoogleBatch(texts, to);
  const out = new Array(texts.length);
  const chunk = 3;
  for (let i = 0; i < texts.length; i += chunk) {
    const slice = texts.slice(i, i + chunk);
    const parts = await Promise.all(
      slice.map((t) => doTranslate(t || '', to, settings).catch(() => ''))
    );
    for (let j = 0; j < parts.length; j++) out[i + j] = parts[j];
  }
  return out;
}

function fetchSearchHtml(query, lang) {
  const url =
    'https://www.google.com/search?q=' +
    encodeURIComponent(query) +
    '&hl=' +
    encodeURIComponent(lang) +
    '&gl=us&num=10';
  return fetch(url, {
    headers: { 'Accept-Language': lang + ';q=0.9,en;q=0.8' }
  }).then(async (r) => {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.text();
  });
}

function fetchBingHtml(query) {
  const url =
    'https://www.bing.com/search?q=' +
    encodeURIComponent(query) +
    '&setlang=en&mkt=en-US&count=10';
  return fetch(url, {
    headers: { 'Accept-Language': 'en-US,en;q=0.9' }
  }).then(async (r) => {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.text();
  });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (msg.type === 'getSettings') {
        return { settings: await getSettings() };
      }
      if (msg.type === 'translate') {
        const s = await getSettings();
        const text = await doTranslate(msg.text, msg.to || s.targetLang || 'en', s);
        return { ok: true, text };
      }
      if (msg.type === 'translateBatch') {
        const s = await getSettings();
        const list = await doTranslateBatch(msg.texts || [], msg.to || s.targetLang || 'en', s);
        return { ok: true, list };
      }
      if (msg.type === 'fetchEnglishResults') {
        const html = await fetchSearchHtml(msg.query, msg.lang || 'en');
        return { ok: true, html };
      }
      if (msg.type === 'fetchBing') {
        const html = await fetchBingHtml(msg.query);
        return { ok: true, html };
      }
      return { ok: false, error: 'unknown message type' };
    } catch (e) {
      return { ok: false, error: (e && e.message) || String(e) };
    }
  })().then(sendResponse);
  return true;
});
