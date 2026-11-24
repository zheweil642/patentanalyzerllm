function patentError(message, status = 400) {
  throw Object.assign(new Error(message), { status });
}
export function normalizePublication(value) {
  let n = typeof value === 'string' ? value.trim().toUpperCase().replace(/[\s-]/g, '') : '';
  n = n.replace(/^TW/, '');
  if (/^I\d{6,9}(?:B\d?)?$/.test(n)) return 'TW' + n + (/B\d?$/.test(n) ? '' : 'B');
  if (/^(?:19|20)\d{7}(?:A\d?)?$/.test(n)) return 'TW' + n + (/A\d?$/.test(n) ? '' : 'A');
  patentError(
    '請輸入台灣發明公告號或公開號，例如 I642307、TWI642307B 或 TW201637458A。只有申請案號時，請使用下方 Google Patents 原站搜尋。',
  );
}
function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (all, key) => {
    if (key[0] === '#') {
      const n =
        key[1].toLowerCase() === 'x' ? parseInt(key.slice(2), 16) : parseInt(key.slice(1), 10);
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : all;
    }
    return (
      { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }[key.toLowerCase()] || all
    );
  });
}
function textOnly(html) {
  return decodeEntities(
    html
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
      .replace(/<h2\b[^>]*>[\s\S]*?<\/h2>/gi, '')
      .replace(/<div\b[^>]*\bnum=["'](\d+)["'][^>]*>/gi, '\n$1. ')
      .replace(/<\/(?:div|p|li|heading|invention-title)>|<br\s*\/?\s*>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
function attributes(tag) {
  const result = {};
  for (const m of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g))
    result[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3]);
  return result;
}
export function importSavedPatent(html, expected = '') {
  if (typeof html !== 'string' || new TextEncoder().encode(html).length > 8 * 1024 * 1024)
    patentError('檔案過大，請使用 8 MB 以下的專利 HTML 網頁。');
  const metadata = [...html.matchAll(/<meta\b[^>]*>/gi)].map((m) => attributes(m[0]));
  const number = metadata
    .find((m) => m.name === 'citation_patent_number')
    ?.content?.replace(/:/g, '');
  if (!number) patentError('這個檔案沒有 Google Patents 專利資料，請從專利詳細頁儲存 HTML 網頁。');
  const publication = normalizePublication(number);
  if (expected && normalizePublication(expected) !== publication)
    patentError('匯入檔案的專利號與目前輸入不相符。請核對號碼，或清空查詢欄後重新匯入。');
  const data = parsePatent(html, publication);
  data.imported = true;
  data.source = '匯入的 Google Patents 網頁';
  data.warning = '資料由你選取的 HTML 檔案匯入，未向原站驗證內容或更新日期。' + data.warning;
  return data;
}
function section(html, name) {
  const m = html.match(
    new RegExp(
      '<section\\b[^>]*itemprop=["\']' + name + '["\'][^>]*>([\\s\\S]*?)<\\/section>',
      'i',
    ),
  );
  return m ? textOnly(m[1]) : '';
}
export function safePdfURL(raw, publication) {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' &&
      u.hostname === 'patentimages.storage.googleapis.com' &&
      !u.port &&
      !u.username &&
      !u.password &&
      !u.search &&
      !u.hash &&
      u.pathname.endsWith('/' + publication + '.pdf')
      ? u.href
      : null;
  } catch {
    return null;
  }
}
export function parsePatent(html, publication) {
  const meta = [...html.matchAll(/<meta\b[^>]*>/gi)].map((m) => attributes(m[0]));
  const field = (name, scheme) =>
    meta.find((m) => m.name === name && (!scheme || m.scheme === scheme))?.content?.trim() || '';
  const actual = field('citation_patent_number').replace(/:/g, '');
  if (actual !== publication)
    patentError('來源頁面未回傳相符的專利號，無法確認結果。請開啟原站核對。', 502);
  const description = section(html, 'description'),
    claims = section(html, 'claims'),
    abstract = section(html, 'abstract');
  const chineseTitle = html.match(/<invention-title\b[^>]*>([\s\S]*?)<\/invention-title>/i);
  const title = chineseTitle ? textOnly(chineseTitle[1]) : field('DC.title');
  if (!title) patentError('來源頁面格式已變更，請改由原站查詢。', 502);
  const pdf = safePdfURL(field('citation_pdf_url'), publication);
  return {
    source: 'Google Patents',
    sourceUrl: 'https://patents.google.com/patent/' + publication + '/zh',
    retrievedAt: new Date().toISOString(),
    info: {
      title,
      publication,
      caseNo: field('citation_patent_application_number').replace(/:/g, ''),
      applicationDate: field('DC.date', 'dateSubmitted'),
      publicationDate: field('DC.date', 'issue'),
      applicants: meta
        .filter((m) => m.name === 'DC.contributor' && m.scheme === 'assignee')
        .map((m) => m.content),
    },
    abstract,
    description,
    claims,
    files: pdf ? [{ name: publication + '.pdf', url: pdf, date: field('DC.date', 'issue') }] : [],
    warning:
      '此為第三方收錄的公開專利資料，未核實法律狀態；不包含智財局全部收發文或審查卷宗。' +
      (!pdf ? ' 本頁未提供可確認的 PDF 連結。' : ''),
  };
}
export async function searchPatent(number) {
  const publication = normalizePublication(number);
  const url = 'https://patents.google.com/patent/' + publication + '/zh';
  let response;
  try {
    response = await fetch(url, {
      headers: { Accept: 'text/html' },
      redirect: 'manual',
      signal: AbortSignal.timeout(35000),
    });
  } catch {
    patentError('Google Patents 暫時無法連線，請使用原站搜尋入口。', 502);
  }
  if (response.status === 404)
    patentError(
      'Google Patents 尚未提供這個公開號／公告號的頁面。請核對號碼或使用原站搜尋；這不表示專利不存在。',
      404,
    );
  if (!response.ok)
    patentError(
      'Google Patents 暫時無法直接讀取（' + response.status + '）。請開啟原站查詢。',
      502,
    );
  if (!response.headers.get('content-type')?.includes('text/html'))
    patentError('來源未回傳專利網頁，請開啟原站查詢。', 502);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0,
    html = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 8 * 1024 * 1024) {
        await reader.cancel();
        patentError('專利頁面過大，請在 Google Patents 原站閱讀。', 413);
      }
      html += decoder.decode(value, { stream: true });
    }
    html += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  return parsePatent(html, publication);
}
