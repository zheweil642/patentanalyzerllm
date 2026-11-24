import { normalizePublication } from '/patent-parser.js';
const $ = (id) => document.getElementById(id);
const names = { qwen: '本機 Qwen' };
const state = {
  local: false,
  signedIn: false,
  providers: [],
  searchReady: false,
  report: null,
  revision: 0,
  busy: false,
};
let toastTimer;
function toast(msg) {
  $('toast').textContent = msg;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($('toast').hidden = true), 8000);
}
function el(tag, text, cls) {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (cls) e.className = cls;
  return e;
}
async function api(path, data, blob = false) {
  const r = await fetch('/api/' + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!r.ok) {
    let error;
    try {
      error = (await r.json()).error;
    } catch {}
    throw new Error(error || '服務暫時無法回應，請稍後再試。');
  }
  if (r.headers.get('content-type')?.includes('application/x-ndjson')) {
    const reader = r.body.getReader(),
      decoder = new TextDecoder();
    let pending = '',
      result;
    function consume(line) {
      if (!line.trim()) return;
      const event = JSON.parse(line);
      if (event.type === 'error') throw new Error(event.error);
      if (event.type === 'result') result = event.report;
      if (event.type === 'progress')
        $('analyze').textContent =
          event.phase + ' ' + event.label + '（' + event.completed + '/' + event.total + '）';
    }
    try {
      while (true) {
        const { done, value } = await reader.read();
        pending += decoder.decode(value, { stream: !done });
        const lines = pending.split('\n');
        pending = lines.pop();
        lines.forEach(consume);
        if (done) break;
      }
      consume(pending);
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    if (!result) throw new Error('分析連線中斷，未取得完整報告。');
    return result;
  }
  return blob ? r.blob() : r.json();
}
const headings = {
  library: [
    '資料集與相似度搜尋',
    '從相近技術，找到比較依據。',
    '搜尋你匯入的專利文字，將原文證據帶入本機 Qwen 初評。',
  ],
  review: [
    '專利初步審查',
    '讓每個判斷，都有依據。',
    '整理你的發明內容，以本機 Qwen 逐項檢視專利要件。',
  ],
  search: [
    '專利與文件查詢',
    '從案號，找到原始文件。',
    '查詢 Google Patents 收錄的台灣專利與 PDF。',
  ],
  guide: ['審查依據', '先理解要件，再形成判斷。', '了解本次初評範圍、法規依據與資料限制。'],
};
for (const button of document.querySelectorAll('[data-tab]'))
  button.addEventListener('click', () => {
    const tab = button.dataset.tab;
    document.querySelectorAll('.view').forEach((e) => (e.hidden = e.id !== tab));
    document.querySelectorAll('.nav').forEach((e) => e.classList.toggle('active', e === button));
    [$('breadcrumb').textContent, $('pageTitle').textContent, $('pageSubtitle').textContent] =
      headings[tab];
  });
function connection() {
  const selected = state.providers.find((p) => p.id === $('provider').value);
  $('modelName').textContent = selected?.model || '尚未啟用';
  $('connectionText').textContent = selected?.ready ? '服務已設定 · 可送出分析' : '此服務尚未啟用';
  $('providerNote').textContent = '分析文字由這台電腦的 Ollama／Qwen 處理，無需 API 金鑰。';
  if (state.busy) return;
  $('analyze').disabled = !state.signedIn || !selected?.ready;
  $('analyze').textContent = !state.signedIn
    ? '登入後開始審查'
    : !selected?.ready
      ? '等待服務啟用'
      : '開始 AI 初步審查';
}
async function refreshStatus() {
  try {
    const r = await fetch('/api/status');
    if (!r.ok) throw new Error();
    const d = await r.json();
    Object.assign(state, {
      local: d.local,
      signedIn: d.signedIn,
      providers: d.providers,
      searchReady: d.searchReady,
    });
    $('accountState').textContent = d.local
      ? '本機管理者'
      : d.signedIn
        ? '已登入 · 不限次數'
        : '登入即可使用';
    $('signIn').hidden = d.signedIn;
    $('signOut').hidden = !d.signedIn || d.local;
    const selected = d.providers.find((p) => p.id === $('provider').value);
    if (!selected?.ready) {
      const ready = d.providers.find((p) => p.ready);
      if (ready) $('provider').value = ready.id;
    }
    $('serviceNotice').textContent =
      d.localMessage ||
      (d.providers.some((p) => p.ready)
        ? '使用者不需提供 API 金鑰，目前不限制使用次數。'
        : '網站已開放瀏覽；本機 Qwen 分析尚待管理者啟用。你不需要申請或填寫 API 金鑰。');

    connection();
    if (d.local) setTimeout(refreshStatus, 15000);
  } catch {
    $('serviceNotice').textContent = '服務狀態暫時無法取得，請重新整理頁面。';
    $('accountState').textContent = '連線暫時中斷';
    $('analyze').disabled = true;
  }
}

function changed() {
  state.revision++;
  $('count').textContent =
    ['claims', 'description', 'priorArt']
      .map((x) => $(x).value.length)
      .reduce((a, b) => a + b, 0)
      .toLocaleString() + ' 字 / 上限 60,000 字';
  if (state.report) {
    state.report = null;
    $('report').hidden = true;
  }
}
for (const id of ['title', 'filingDate', 'claims', 'description', 'priorArt', 'descriptionScope'])
  $(id).addEventListener('input', changed);
$('example').onclick = async () => {
  if (['title', 'claims', 'description', 'priorArt'].some((id) => $(id).value.trim())) {
    toast('請先保留並清空目前內容，再填入真實專利。');
    return;
  }
  try {
    const response = await fetch('/battery-patents.json');
    if (!response.ok) throw new Error('無法讀取真實專利資料。');
    const doc = (await response.json()).find((d) => d.id === 'US20220069382A1');
    if (!doc?.example) throw new Error('真實案例資料不完整，請重新整理。');
    // Recheck after fetch so late responses never overwrite newly entered text.
    if (['title', 'claims', 'description', 'priorArt'].some((id) => $(id).value.trim())) return;
    $('title').value = doc.id + '｜' + doc.title;
    $('filingDate').value = doc.example.filingDate;
    $('claims').value = doc.example.claims;
    $('description').value = doc.example.description;
    $('descriptionScope').value = 'excerpt';
    changed();
    toast(
      '已填入真實專利 Claim 1 與說明書 [0016]、[0023]、[0030]、[0032] 原文，涵蓋感測、關係圖與最低轉速；仍為節錄，未含圖式。',
    );
  } catch (e) {
    toast(e.message);
  }
};
$('reviewForm').onsubmit = async (e) => {
  e.preventDefault();
  if (state.busy) return;
  if (!state.signedIn) {
    toast('請先使用頁面上方的 ChatGPT 登入。');
    return;
  }
  const p = $('provider').value;
  if (!state.providers.find((x) => x.id === p)?.ready) {
    toast('此 AI 服務尚未啟用。');
    return;
  }
  const data = { stream: true, provider: p, descriptionScope: $('descriptionScope').value };
  for (const id of ['title', 'claims', 'description', 'priorArt', 'filingDate'])
    data[id] = $(id).value;
  const revision = state.revision;
  const b = $('analyze');
  state.busy = true;
  b.disabled = true;
  b.textContent = '正在逐項分析…';
  $('report').hidden = true;
  state.report = null;
  try {
    const report = await api('review', data);
    if (revision !== state.revision) {
      toast('分析期間內容已修改，請重新審查最新內容。');
      return;
    }
    state.report = {
      ...report,
      title: data.title,
      input: {
        claims: data.claims,
        description: data.description,
        descriptionScope: data.descriptionScope,
        priorArt: data.priorArt,
        filingDate: data.filingDate,
      },
    };
    renderReport();
    $('report').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) {
    toast(e.message);
  } finally {
    state.busy = false;
    connection();
  }
};
const statusNames = { potential: '初步未見疑點', risk: '需釐清風險', unknown: '資料不足' };
const relationNames = {
  matched: '模型判為對應',
  different: '模型判為有差異',
  not_found: '此節錄未找到',
  unknown: '待核對',
};
function relationLabel(row) {
  if (row.stage === 'comparison_incomplete') return '模型回覆不完整';
  if (row.stage === 'failed') return '本組分析未完成';
  return relationNames[row.relation];
}
function renderReport() {
  const r = state.report,
    body = $('reportBody');
  body.replaceChildren();
  const summary = el('div', undefined, 'summarybox');
  summary.append(
    el('strong', r.summary),
    el(
      'p',
      names[r.provider] +
        ' / ' +
        r.model +
        ' · ' +
        new Date(r.createdAt).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }) +
        '（台北時間）',
    ),
  );
  body.append(summary, el('p', r.limitations, 'helper'), el('p', r.workflow || '', 'helper'));
  if (r.warnings?.length) body.append(el('p', r.warnings.join('\n'), 'notice source-text'));
  body.append(el('h3', '逐項技術特徵與引證對照'), el('p', r.comparisonScope || '', 'helper'));
  if (!r.comparisons?.length)
    body.append(el('p', '尚無引證對照。請提供相關文件原文，再進行比較。', 'notice'));
  for (const row of [...(r.comparisons || []), ...(r.support || [])]) {
    if (row === r.support?.[0])
      body.append(
        el('h3', '請求項與說明書對應'),
        el('p', '引句存在只表示來源可核對，仍需人工確認完整支持。', 'helper'),
      );
    const card = el('details', undefined, 'reportitem');
    card.open = true;
    const heading = el('summary');
    heading.append(
      el('span', row.featureId + ' × ' + row.sourceId),
      el(
        'span',
        relationLabel(row),
        'status ' + (row.quoteVerified && row.relation === 'matched' ? 'potential' : 'unknown'),
      ),
    );
    const dl = el('dl');
    for (const [label, value] of [
      ['你的技術特徵', row.feature],
      ['引證文件', row.sourceTitle],
      ['引證原文', row.quote || '沒有通過原文核對的引句。'],
      ['引句位置', row.passageId || '未取得'],
      ['引句檢查', row.check],
      ['模型比較理由', row.reason],
      ['仍缺少的證據', row.gap],
    ])
      dl.append(el('dt', label), el('dd', value));
    card.append(heading, dl);
    body.append(card);
  }
  if (r.input?.priorArt) {
    const sources = el('details');
    sources.append(
      el('summary', '核對本次送交模型的引證原文'),
      el('p', r.input.priorArt, 'source-text'),
    );
    body.append(sources);
  }
  for (const item of r.items) {
    const d = el('details', undefined, 'reportitem');
    d.open = true;
    const s = el('summary');
    const left = el('span', item.name);
    left.append(el('small', item.article));
    s.append(
      left,
      el(
        'span',
        item.modelIssue || item.scopeLabel || statusNames[item.status],
        'status ' + item.status,
      ),
    );
    const dl = el('dl');
    for (const [label, key] of [
      ['判斷理由', 'reason'],
      ['證據與缺口', 'evidence'],
      ['建議下一步', 'next'],
    ])
      dl.append(el('dt', label), el('dd', item[key]));
    d.append(s, dl);
    if (item.inputQuote)
      d.append(
        el(
          'p',
          '本次輸入原句（已核對文字存在，語意仍待確認）：' + item.inputQuote,
          'notice source-text',
        ),
      );
    if (item.excerptObservation)
      d.append(
        el('p', '模型對節錄的觀察（待核對，非完整文件結論）：' + item.excerptObservation, 'notice'),
      );
    body.append(d);
  }
  const link = el('a', '法規來源 · 專利法（核對日期 ' + r.lawChecked + '）');
  link.href = r.law;
  link.target = '_blank';
  link.rel = 'noreferrer';
  body.append(link);
  $('report').hidden = false;
}
function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = el('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
$('export').onclick = () => {
  const r = state.report;
  if (!r) return;
  let text =
    '# 專利初步審查報告\n\n' +
    (r.title || '未命名發明') +
    '\n\n模型：' +
    names[r.provider] +
    ' / ' +
    r.model +
    '\n時間：' +
    r.createdAt +
    '\n\n' +
    r.summary +
    '\n\n' +
    r.limitations +
    '\n';
  for (const i of r.items)
    text +=
      '\n## ' +
      i.name +
      '（' +
      i.article +
      '）\n\n' +
      (i.modelIssue || i.scopeLabel || statusNames[i.status]) +
      '\n\n理由：' +
      i.reason +
      '\n證據：' +
      i.evidence +
      '\n下一步：' +
      i.next +
      (i.inputQuote ? '\n已核對輸入原句：' + i.inputQuote : '') +
      (i.excerptObservation ? '\n節錄觀察（待核對）：' + i.excerptObservation : '') +
      '\n';
  text +=
    '\n## 逐項特徵對照\n\n' + (r.comparisonScope || '') + '\n' + (r.warnings || []).join('\n');
  for (const row of [...(r.comparisons || []), ...(r.support || [])])
    text +=
      '\n\n### ' +
      row.featureId +
      ' × ' +
      row.sourceId +
      '\n特徵：' +
      row.feature +
      '\n文件：' +
      row.sourceTitle +
      '\n比較：' +
      relationLabel(row) +
      '\n引句：' +
      (row.quote || '未核對') +
      '\n檢查：' +
      row.check +
      '\n理由：' +
      row.reason +
      '\n缺口：' +
      row.gap;
  text +=
    '\n法規來源：' +
    r.law +
    '\n法規核對日：' +
    r.lawChecked +
    '\n\n## 本次輸入\n\n' +
    JSON.stringify(r.input, null, 2);
  download(new Blob([text], { type: 'text/markdown;charset=utf-8' }), '專利初評報告.md');
};
function updateSearchLink() {
  const number = $('number').value.trim();
  $('searchForm').action = 'https://patents.google.com/';
  $('number').name = 'q';
  try {
    $('searchForm').action =
      'https://patents.google.com/patent/' + normalizePublication(number) + '/zh';
    $('number').removeAttribute('name');
  } catch {}
}
$('number').addEventListener('input', updateSearchLink);
$('searchForm').onsubmit = (e) => {
  if (!$('number').value.trim()) {
    e.preventDefault();
    toast('請輸入專利號。');
    return;
  }
  updateSearchLink();
};
const laws = [
  ['發明適格性', '第21、24條', '檢視是否屬於技術創作，以及是否涉及不予專利的標的。'],
  ['產業利用性', '第22條第1項', '檢視技術是否能在產業上製造或使用。'],
  ['新穎性', '第22、23條', '比對時間與技術內容；需要先前技術及申請／優先權日。'],
  ['進步性', '第22條第2項', '評估通常知識者是否容易完成；需要引證及技術差異分析。'],
  ['充分揭露與可據以實現', '第26條第1項', '檢視說明書是否足以讓通常知識者實現發明。'],
  ['請求項明確性與支持', '第26條第2項', '檢視保護範圍、用語與說明書支持。'],
  ['單一性', '第33條', '檢視多項發明是否具有單一廣義發明概念。'],
];
for (const [name, article, desc] of laws) {
  const row = el('div', undefined, 'lawrow');
  const left = el('div', name);
  left.append(el('small', article));
  row.append(left, el('span', desc));
  $('lawRows').append(row);
}
refreshStatus();

updateSearchLink();
