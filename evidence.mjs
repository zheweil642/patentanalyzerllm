const text = (x) => (typeof x === 'string' ? x.trim() : '');
const compact = (x) => text(x).replace(/\s+/g, ' ');
export function validReviewDate(value) {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}
export function comparisonInput(body) {
  // Keep exact claim wording; these are punctuation-based segments, not an exhaustive legal decomposition.
  const pieces = text(body.claims)
    .split(/(?<=[；;。])|\n+/u)
    .map(text)
    .filter(Boolean);
  const segments = [];
  let pending = '';
  for (const piece of pieces) {
    const joined = pending ? pending + '\n' + piece : piece;
    if (
      /^(?:and|or|及|以及|或)[,，;；]?$/i.test(piece) ||
      /(?:comprising|包括|包含)\s*[:：]$/i.test(piece)
    ) {
      pending = joined;
    } else {
      segments.push(joined);
      pending = '';
    }
  }
  if (pending) {
    if (segments.length) segments[segments.length - 1] += '\n' + pending;
    else segments.push(pending);
  }
  const features = segments.map((feature, i) => ({ id: 'F' + (i + 1), text: feature }));
  const prior = text(body.priorArt);
  const markers = [...prior.matchAll(/^\[D(\d+)\][ \t]*(.*)$/gm)];
  const knownHeader =
    '以下為使用者匯入資料集中的候選文件，來源與日期尚未獨立核實。相似度僅供排序，不代表法律判斷。';
  const prefix = markers.length ? prior.slice(0, markers[0].index).trim() : '';
  if (prefix && prefix !== knownHeader)
    throw Object.assign(
      new Error('第一個引證編號前仍有文字，請將這些內容放入對應的 [D1] 文件內，避免漏讀。'),
      { status: 400 },
    );
  const sources = markers.length
    ? markers.map((m, i) => {
        const block = prior.slice(m.index, markers[i + 1]?.index ?? prior.length);
        const delimiter = /使用者匯入的內容（可能不是完整原文）：\s*/.exec(block);
        const content = delimiter
          ? block.slice(delimiter.index + delimiter[0].length).trim()
          : block.slice(m[0].length).trim();
        return {
          id: 'D' + m[1],
          title: m[2],
          date: block.match(/公開日期：([^\n]+)/)?.[1]?.trim() || '',
          text: content,
        };
      })
    : prior
      ? [{ id: 'D1', title: '手動提供的引證（日期與來源待核對）', date: '', text: prior }]
      : [];
  if (new Set(sources.map((s) => s.id)).size !== sources.length)
    throw Object.assign(new Error('引證編號重複，請清空先前技術後重新帶入文件。'), { status: 400 });
  if (features.length > 24 || sources.length > 4 || features.length * sources.length > 48)
    throw Object.assign(
      new Error(
        '本次逐項比對內容太多，請分批比較請求項及引證（每次最多 48 組特徵／文件配對）。未刪除或截斷你的內容。',
      ),
      { status: 400 },
    );
  return { features, sources };
}
export function validateComparisons(raw, input) {
  if (raw && !Array.isArray(raw) && typeof raw === 'object') {
    raw = Object.entries(raw).map(([key, value]) => {
      const [featureId, sourceId] = key.split('_');
      return { ...value, featureId, sourceId };
    });
  }
  const rows = [];
  for (const feature of input.features)
    for (const source of input.sources) {
      const matches = Array.isArray(raw)
        ? raw.filter((r) => r?.featureId === feature.id && r?.sourceId === source.id)
        : [];
      const r = matches.length === 1 ? matches[0] : null;
      const quote = text(r?.quote);
      const quoteVerified = quote.length >= 8 && compact(source.text).includes(compact(quote));
      let relation = ['matched', 'different', 'not_found', 'unknown'].includes(r?.relation)
        ? r.relation
        : 'unknown';
      let check = '模型未提供完整比對，需人工核對。';
      if (r) {
        if (quote && !quoteVerified) {
          relation = 'unknown';
          check = '引句未在指定文件找到，已改為待核對。';
        } else if (['matched', 'different'].includes(relation) && !quoteVerified) {
          relation = 'unknown';
          check = '缺少可核對引句，已改為待核對。';
        } else
          check = quoteVerified
            ? '引句已在此份輸入中找到；技術對應仍需人工確認。'
            : '未找到不代表整份專利未揭露，請補充原文。';
      }
      rows.push({
        featureId: feature.id,
        feature: feature.text,
        sourceId: source.id,
        sourceTitle: source.title,
        relation,
        quote: quoteVerified ? quote : '',
        quoteVerified,
        passageId: text(r?.passageId),
        stage: text(r?.stage),
        reason: text(r?.reason) || '模型未完成此組比較。',
        gap: text(r?.gap) || '請人工核對原文、上下文及特徵是否完整對應。',
        check,
      });
    }
  return rows;
}
export function reportSchema(input, criteria) {
  const string = { type: 'string' };
  const pairs = {};
  for (const f of input.features)
    for (const s of input.sources)
      pairs[f.id + '_' + s.id] = {
        type: 'object',
        additionalProperties: false,
        properties: {
          relation: { type: 'string', enum: ['matched', 'different', 'not_found', 'unknown'] },
          quote: string,
          reason: string,
          gap: string,
        },
        required: ['relation', 'quote', 'reason', 'gap'],
      };
  return {
    type: 'object',
    additionalProperties: false,
    required: ['items', 'comparisons'],
    properties: {
      items: {
        type: 'object',
        additionalProperties: false,
        required: criteria.map((c) => c[0]),
        properties: Object.fromEntries(
          criteria.map(([id]) => [
            id,
            {
              type: 'object',
              additionalProperties: false,
              required: ['status', 'reason', 'evidence', 'next'],
              properties: {
                status: { type: 'string', enum: ['potential', 'risk', 'unknown'] },
                reason: { type: 'string', minLength: 1 },
                evidence: { type: 'string', minLength: 1 },
                next: { type: 'string', minLength: 1 },
              },
            },
          ]),
        ),
      },
      comparisons: {
        type: 'object',
        additionalProperties: false,
        properties: pairs,
        required: Object.keys(pairs),
      },
    },
  };
}
export function qualityIssues(input, comparisons, body) {
  const issues = [];
  if (!input.sources.length) issues.push('未提供引證文件，無法建立先前技術對照。');
  if (input.sources.some((s) => /中文整理摘要|非原文|虛構示範/.test(s.text + s.title)))
    issues.push('引證含摘要或虛構資料，不能作為完整原文比對。');
  if (
    input.sources.some(
      (s) =>
        !validReviewDate(s.date) || !validReviewDate(body.filingDate) || s.date >= body.filingDate,
    )
  )
    issues.push('部分引證日期未確認或未早於基準日，需核對其可引用性。');
  if (
    comparisons.some(
      (r) => !r.quoteVerified || r.relation === 'unknown' || r.relation === 'not_found',
    )
  )
    issues.push('部分特徵缺少可核對的對應證據；不能由未找到推定具有新穎性或進步性。');
  return issues;
}
