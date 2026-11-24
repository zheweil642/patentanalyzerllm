import { normalizeDataset, rankDocuments, buildEvidence, METHOD } from './similarity.js';
const $ = (id) => document.getElementById(id);
const key = 'patent-review-library-v1';
let docs = [],
  results = [];
const selected = new Set();
let savedSnapshot,
  unreadable = false;
function node(tag, text) {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  return e;
}
function message(text) {
  $('libraryMessage').textContent = text;
}
function download(data, name, raw = false) {
  const url = URL.createObjectURL(
    new Blob([raw ? data : JSON.stringify(data, null, 2)], { type: 'application/json' }),
  );
  const a = node('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function invalidate() {
  results = [];
  selected.clear();
  $('similarResults').replaceChildren();
  $('transferEvidence').disabled = true;
}
function render() {
  $('libraryCount').textContent = `${docs.length} 篇文件 · 僅儲存在此瀏覽器`;
  const list = $('libraryList');
  list.replaceChildren();
  for (const doc of docs) {
    const row = node('div');
    row.className = 'library-row';
    row.append(
      node(
        'span',
        `${doc.demo ? '【虛構示範】' : ''}${doc.id} · ${doc.title} · ${doc.publicationDate || '日期未知'}`,
      ),
    );
    const remove = node('button', '移除');
    remove.type = 'button';
    remove.className = 'textbutton';
    remove.onclick = () => {
      try {
        save(docs.filter((d) => d.id !== doc.id));
        message('已移除文件。');
      } catch (e) {
        message(e.message);
      }
    };
    row.append(remove);
    list.append(row);
  }
}
function save(next) {
  const validated = normalizeDataset(next);
  const serialized = JSON.stringify(validated);
  if (localStorage.getItem(key) !== savedSnapshot)
    throw new Error('資料集已在其他分頁變更，請重新整理後再操作。');
  try {
    if (unreadable && savedSnapshot !== null)
      localStorage.setItem(key + '-recovery-' + Date.now(), savedSnapshot);
    localStorage.setItem(key, serialized);
    savedSnapshot = serialized;
    unreadable = false;
  } catch {
    throw new Error('瀏覽器儲存空間不足或被停用，資料尚未儲存。請先匯出備份或減少資料。');
  }
  docs = validated;
  invalidate();
  render();
}
function merge(incoming) {
  const existing = new Set(docs.map((d) => d.id));
  if (incoming.some((d) => existing.has(d.id)))
    throw new Error('資料包含已有案號，請先移除舊資料再匯入。');
  save([...docs, ...incoming]);
}
try {
  savedSnapshot = localStorage.getItem(key);
  docs = savedSnapshot === null ? [] : normalizeDataset(JSON.parse(savedSnapshot));
} catch {
  unreadable = true;
  message('已存資料無法讀取。可先用「匯出資料集」保存原始內容，再從備份匯入。');
}
render();
$('libraryForm').onsubmit = (e) => {
  e.preventDefault();
  try {
    merge(
      normalizeDataset([
        {
          id: $('docId').value,
          title: $('docTitle').value,
          publicationDate: $('docDate').value,
          source: $('docSource').value,
          text: $('docText').value,
        },
      ]),
    );
    $('libraryForm').reset();
    message('文件已儲存，可用於相似度搜尋。');
  } catch (e) {
    message(e.message);
  }
};
$('importLibrary').onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    if (file.size > 8 * 1024 * 1024) throw new Error('檔案請小於 8 MB。');
    merge(normalizeDataset(JSON.parse(await file.text())));
    message('匯入完成。');
  } catch (e) {
    message(e instanceof SyntaxError ? 'JSON 格式錯誤，請參考下載的範本。' : e.message);
  } finally {
    e.target.value = '';
  }
};
$('exportLibrary').onclick = () =>
  unreadable && typeof savedSnapshot === 'string'
    ? download(savedSnapshot, '專利資料集-原始備份.json', true)
    : download(docs, '專利資料集.json');
$('originalLibrary').onclick = async () => {
  try {
    const response = await fetch('/battery-patents.json');
    if (!response.ok) throw new Error('原文資料讀取失敗，請確認網站已重新啟動。');
    const incoming = normalizeDataset(await response.json());
    const ids = new Set(incoming.map((d) => d.id));
    save([...docs.filter((d) => !ids.has(d.id)), ...incoming]);
    message(
      '已載入兩篇真實專利的完整 Claim 1 英文原文，並更新同案號的舊摘要。這是節錄，不是整份專利全文。',
    );
  } catch (e) {
    message(e.message);
  }
};
$('libraryTemplate').onclick = async () => {
  try {
    const r = await fetch('/battery-patents.json');
    if (!r.ok) throw new Error('範本讀取失敗。');
    download(normalizeDataset(await r.json()), '專利資料集範本-真實原文.json');
  } catch (e) {
    message(e.message);
  }
};
$('useReviewQuery').onclick = () => {
  $('similarQuery').value = [$('title').value, $('claims').value, $('description').value]
    .filter(Boolean)
    .join('\n');
  $('similarDate').value = $('filingDate').value;
  invalidate();
  message('已帶入目前發明內容與日期，請按搜尋。');
};
for (const id of ['similarQuery', 'similarDate'])
  $(id).addEventListener('input', () => {
    invalidate();
    message('查詢已變更，請重新搜尋。');
  });
$('similarForm').onsubmit = (e) => {
  e.preventDefault();
  invalidate();
  try {
    if (!docs.length) throw new Error('請先新增或匯入專利資料。');
    if ($('similarQuery').value.trim().length < 20) throw new Error('請輸入至少 20 字的發明內容。');
    results = rankDocuments($('similarQuery').value, docs, $('similarDate').value).slice(0, 10);
    message(
      `找到 ${results.length} 筆有文字重疊的結果（最多 10 筆）。${$('similarDate').value ? '僅納入公開日早於基準日的文件；日期未知、同日與較晚文件已排除。' : '未填基準日：結果尚未經日期篩選，不代表先前技術。'}`,
    );
    for (const [i, r] of results.entries()) {
      const card = node('article');
      card.className = 'similar-card';
      const label = node('label');
      const check = node('input');
      check.type = 'checkbox';
      check.onchange = () => {
        check.checked ? selected.add(i) : selected.delete(i);
        $('transferEvidence').disabled = !selected.size;
      };
      label.append(
        check,
        node('strong', `${i + 1}. ${r.doc.demo ? '【虛構示範】' : ''}${r.doc.title}`),
      );
      card.append(
        label,
        node(
          'p',
          `${r.doc.id} · 公開日 ${r.doc.publicationDate || '未知'} · 相似度 ${r.score.toFixed(3)}（0～1）`,
        ),
        node('p', `重疊詞：${r.terms.join('、')}`),
      );
      if (r.doc.source) {
        const link = node('a', '開啟來源核對');
        link.href = r.doc.source;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        card.append(link);
      }
      const detail = node('details');
      detail.append(node('summary', '檢視匯入的原文'));
      const text = node('p', r.doc.text);
      text.className = 'source-text';
      detail.append(text);
      card.append(detail);
      $('similarResults').append(card);
    }
  } catch (e) {
    message(e.message);
  }
};
$('transferEvidence').onclick = () => {
  try {
    const previous = $('replaceEvidence').checked ? '' : $('priorArt').value.trim();
    const markers = [...previous.matchAll(/^\[D(\d+)\]/gm)];
    const base =
      previous && !markers.length
        ? '[D1] 手動提供的引證\n使用者匯入的內容（可能不是完整原文）：\n' + previous
        : previous;
    const offset = markers.length ? Math.max(...markers.map((m) => Number(m[1]))) : base ? 1 : 0;
    if (!Number.isSafeInteger(offset + selected.size))
      throw new Error('引證編號太大，請先重新編號。');
    const evidence = buildEvidence(
      results.filter((_, i) => selected.has(i)),
      offset,
    );
    const combined = base ? base + '\n\n' + evidence : evidence;
    if (combined.length > 30000)
      throw new Error('加上目前先前技術內容將超過 30,000 字，請先整理原有內容。');
    $('priorArt').value = combined;
    $('priorArt').dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('[data-tab="review"]').click();
    $('priorArt').closest('details').open = true;
    $('priorArt').focus();
    message('已附加選取原文至初評表單，尚未執行 Qwen。');
  } catch (e) {
    message(e.message);
  }
};
$('similarMethod').textContent = METHOD;

// Archive only the three former built-in fictional documents; preserve user documents.
async function loadRealDefaults() {
  const retired = docs.filter((d) => d.demo && ['DEMO-001', 'DEMO-002', 'DEMO-003'].includes(d.id));
  if (unreadable || (savedSnapshot !== null && !retired.length)) return;
  const initialSnapshot = savedSnapshot;
  try {
    const response = await fetch('/battery-patents.json');
    if (!response.ok) throw new Error('真實範例讀取失敗，請按載入按鈕重試。');
    const defaults = normalizeDataset(await response.json());
    if (savedSnapshot !== initialSnapshot) return;
    const kept = docs.filter((d) => !retired.includes(d));
    const existing = new Set(kept.map((d) => d.id));
    if (retired.length) localStorage.setItem(key + '-retired-demo-backup', JSON.stringify(retired));
    save([...kept, ...defaults.filter((d) => !existing.has(d.id))]);
    message(
      retired.length
        ? '舊版虛構範例已封存，已保留你的資料並補入真實案例。'
        : '已載入兩篇真實專利原文。',
    );
  } catch (e) {
    message(e.message);
  }
}
loadRealDefaults();
