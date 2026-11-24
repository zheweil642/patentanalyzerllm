// Research-inspired baseline, not a reproduction of either cited paper.
export const METHOD = 'TF-IDF／餘弦相似度（中文雙字詞＋英文詞）v1';
export function validDate(value) {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}
export function normalizeDataset(input) {
  if (!Array.isArray(input) || input.length > 200)
    throw new Error('資料集須為 JSON 陣列，最多 200 篇。');
  const ids = new Set();
  return input.map((item, index) => {
    if (!item || typeof item !== 'object') throw new Error(`第 ${index + 1} 筆格式錯誤。`);
    const doc = {};
    for (const field of ['id', 'title', 'publicationDate', 'source', 'text']) {
      if (item[field] != null && typeof item[field] !== 'string')
        throw new Error(`第 ${index + 1} 筆 ${field} 須為文字。`);
      doc[field] = (item[field] || '').trim();
    }
    if (
      !doc.id ||
      doc.id.length > 80 ||
      !doc.title ||
      doc.title.length > 200 ||
      doc.text.length < 20 ||
      doc.text.length > 30000
    )
      throw new Error(`第 ${index + 1} 筆需有案號、標題及 20～30,000 字的內容。`);
    if (ids.has(doc.id)) throw new Error(`案號重複：${doc.id}`);
    ids.add(doc.id);
    if (doc.publicationDate && !validDate(doc.publicationDate))
      throw new Error(`日期無效：${doc.id}`);
    if (doc.source) {
      let url;
      try {
        url = new URL(doc.source);
      } catch {
        throw new Error(`來源網址無效：${doc.id}`);
      }
      if (
        !['https:', 'http:'].includes(url.protocol) ||
        url.username ||
        url.password ||
        doc.source.length > 2000
      )
        throw new Error(`來源須為一般 HTTP(S) 網址：${doc.id}`);
    }
    doc.demo = item.demo === true;
    return doc;
  });
}
export function tokens(text) {
  const chunks =
    String(text)
      .normalize('NFKC')
      .toLowerCase()
      .match(/[\p{Script=Han}]+|[a-z0-9]+/gu) || [];
  return chunks.flatMap((s) =>
    /\p{Script=Han}/u.test(s)
      ? Array.from({ length: Math.max(0, s.length - 1) }, (_, i) => s.slice(i, i + 2))
      : [s],
  );
}
function counts(text) {
  const map = new Map();
  for (const word of tokens(text)) map.set(word, (map.get(word) || 0) + 1);
  return map;
}
export function rankDocuments(query, docs, cutoff = '') {
  if (cutoff && !validDate(cutoff)) throw new Error('請提供有效的申請／優先權日。');
  const eligible = docs.filter(
    (d) => !cutoff || (validDate(d.publicationDate) && d.publicationDate < cutoff),
  );
  if (!eligible.length) return [];
  const vectors = eligible.map((d) => counts(d.title + '\n' + d.text));
  const df = new Map();
  for (const vector of vectors)
    for (const word of vector.keys()) df.set(word, (df.get(word) || 0) + 1);
  const weight = (vector) => {
    const weighted = new Map();
    let norm = 0;
    for (const [word, count] of vector) {
      const w =
        (1 + Math.log(count)) * (Math.log((eligible.length + 1) / ((df.get(word) || 0) + 1)) + 1);
      weighted.set(word, w);
      norm += w * w;
    }
    return { weighted, norm: Math.sqrt(norm) };
  };
  const q = weight(counts(query));
  return eligible
    .map((doc, i) => {
      const v = weight(vectors[i]);
      let dot = 0;
      const common = [];
      for (const [word, w] of q.weighted)
        if (v.weighted.has(word)) {
          dot += w * v.weighted.get(word);
          common.push([word, w * v.weighted.get(word)]);
        }
      const score = q.norm && v.norm ? Math.min(1, dot / (q.norm * v.norm)) : 0;
      return {
        doc,
        score,
        terms: common
          .sort((a, b) => b[1] - a[1])
          .slice(0, 8)
          .map((x) => x[0]),
      };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.doc.id.localeCompare(b.doc.id));
}
export function buildEvidence(results, offset = 0) {
  if (!results.length) throw new Error('請先勾選要帶入的文件。');
  const text =
    (offset === 0
      ? '以下為使用者匯入資料集中的候選文件，來源與日期尚未獨立核實。相似度僅供排序，不代表法律判斷。\n\n'
      : '') +
    results
      .map(
        ({ doc }, i) =>
          `[D${offset + i + 1}] ${doc.demo ? '【虛構示範，不得視為真實先前技術】' : ''}${doc.id}｜${doc.title}\n公開日期：${doc.publicationDate || '未知'}\n來源：${doc.source || '未提供'}\n使用者匯入的內容（可能不是完整原文）：\n${doc.text}`,
      )
      .join('\n\n');
  if (text.length > 30000)
    throw new Error('選取內容超過先前技術欄位的 30,000 字，請減少文件；系統不會自動截斷證據。');
  return text;
}
