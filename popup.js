const DEFAULTS = {
  autoTranslate: true,
  autoSplit: true,
  translateResults: false,
  provider: 'google',
  apiKey: '',
  targetLang: 'en'
};

async function init() {
  const current = await chrome.storage.sync.get(DEFAULTS);
  const s = { ...DEFAULTS, ...current };
  document.getElementById('autoTranslate').checked = !!s.autoTranslate;
  document.getElementById('autoSplit').checked = !!s.autoSplit;
  document.getElementById('translateResults').checked = !!s.translateResults;
  document.getElementById('provider').value = s.provider;
  document.getElementById('apiKey').value = s.apiKey || '';
  document.getElementById('targetLang').value = s.targetLang || 'en';
  syncKeyRow();
}

function syncKeyRow() {
  const provider = document.getElementById('provider').value;
  document.getElementById('keyRow').hidden = !(provider === 'deepl' || provider === 'openai');
}

document.getElementById('provider').addEventListener('change', syncKeyRow);

document.getElementById('save').addEventListener('click', async () => {
  await chrome.storage.sync.set({
    autoTranslate: document.getElementById('autoTranslate').checked,
    autoSplit: document.getElementById('autoSplit').checked,
    translateResults: document.getElementById('translateResults').checked,
    provider: document.getElementById('provider').value,
    apiKey: document.getElementById('apiKey').value.trim(),
    targetLang: document.getElementById('targetLang').value.trim() || 'en'
  });
  const status = document.getElementById('status');
  status.textContent = '已保存 ✓';
  setTimeout(() => {
    status.textContent = '';
  }, 1500);
});

init();
