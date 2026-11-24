import {
  normalizePublication,
  parsePatent,
  safePdfURL,
  searchPatent,
  importSavedPatent,
} from './patents.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { handle, validateReport, criteria } from './api.mjs';
import { normalizeDataset, rankDocuments, buildEvidence } from './public/similarity.js';
import { comparisonInput, validateComparisons, reportSchema } from './evidence.mjs';
test('claim line wrapping never creates a standalone conjunction feature', async () => {
  const docs = JSON.parse(await readFile('public/battery-patents.json', 'utf8'));
  const input = comparisonInput({ claims: docs[1].example.claims, priorArt: 'source text' });
  assert.equal(input.features.length, 4);
  assert.ok(input.features[0].text.includes('determining power discharge'));
  assert.ok(input.features[3].text.includes('and\n'));
  assert.ok(!input.features.some((f) => /^and$/i.test(f.text)));
  const schema = reportSchema(input, criteria);
  assert.deepEqual(schema.properties.comparisons.required, ['F1_D1', 'F2_D1', 'F3_D1', 'F4_D1']);
  const rows = validateComparisons(
    { F1_D1: { relation: 'matched', quote: 'source text', reason: 'test', gap: 'test' } },
    input,
  );
  assert.equal(rows[0].quoteVerified, true);
  assert.equal(rows[1].relation, 'unknown');
});

const searchDocs = normalizeDataset([
  {
    id: 'A',
    title: '電池散熱控制',
    publicationDate: '2020-01-01',
    text: '電池模組溫度感測器控制風扇轉速，溫度過高時提高風扇轉速並進行散熱。',
  },
  {
    id: 'B',
    title: '雨水過濾容器',
    publicationDate: '2019-01-01',
    text: '雨水經過砂石過濾層後流入儲水槽，水位超過溢流管口時排出多餘水量。',
  },
  {
    id: 'C',
    title: '電池散熱控制',
    publicationDate: '2025-01-01',
    text: '電池模組溫度感測器控制風扇轉速，溫度過高時提高風扇轉速並進行散熱。',
  },
  {
    id: 'D',
    title: '電池散熱控制',
    text: '電池模組溫度感測器控制風扇轉速，溫度過高時提高風扇轉速並進行散熱。',
  },
]);
test('similarity ranks relevant text and excludes unknown, same-day and later publications', () => {
  const results = rankDocuments('電池模組溫度感測器控制風扇轉速', searchDocs, '2025-01-01');
  assert.equal(results[0].doc.id, 'A');
  assert.ok(results[0].score > 0 && results[0].score <= 1);
  assert.ok(!results.some((r) => ['C', 'D'].includes(r.doc.id)));
  assert.deepEqual(rankDocuments('xyzxyz', searchDocs), []);
  assert.deepEqual(rankDocuments('電池散熱', searchDocs, '2010-01-01'), []);
  assert.equal(rankDocuments('電池散熱', searchDocs).length, 3);
});
test('dataset rejects duplicate identities, invalid dates and executable source URLs', () => {
  assert.throws(() => normalizeDataset([searchDocs[0], searchDocs[0]]), /重複/);
  assert.throws(
    () => normalizeDataset([{ ...searchDocs[0], publicationDate: '2025-02-30' }]),
    /日期/,
  );
  assert.throws(
    () => normalizeDataset([{ ...searchDocs[0], source: 'javascript:alert(1)' }]),
    /HTTP/,
  );
});
test('evidence preserves source text and labels demo documents without silent truncation', () => {
  const evidence = buildEvidence([{ doc: { ...searchDocs[0], demo: true } }]);
  assert.ok(evidence.includes(searchDocs[0].text));
  assert.match(evidence, /\[D1\]/);
  const report = validateReport(JSON.stringify(fixture), {
    priorArt: evidence,
    filingDate: '2024-01-01',
  });
  assert.equal(report.items.find((i) => i.id === 'novelty').status, 'unknown');
  assert.throws(
    () => buildEvidence([{ doc: { ...searchDocs[0], text: '字'.repeat(30000) } }]),
    /超過/,
  );
});
const fixture = {
  items: criteria.map(([id]) => ({
    id,
    status: 'potential',
    reason: '初步理由',
    evidence: '提供的技術文字',
    next: '進一步核對',
  })),
};
test('all shipped user examples use real publications and original claim text', async () => {
  const docs = JSON.parse(await readFile('public/battery-patents.json', 'utf8'));
  assert.deepEqual(
    docs.map((d) => d.id),
    ['US20150380781A1', 'US20220069382A1'],
  );
  for (const doc of docs) {
    assert.equal(doc.demo, false);
    assert.match(doc.source, /^https:\/\/patents.google.com\/patent\/US/);
    assert.match(doc.text, /1\. A /);
  }
  const target = docs[1];
  assert.equal(target.example.filingDate, '2020-09-02');
  assert.ok(target.text.includes(target.example.claims));
  assert.match(target.example.description, /^\[0016\] According to one aspect/);
  const ranked = rankDocuments(
    target.example.claims,
    normalizeDataset(docs),
    target.example.filingDate,
  );
  assert.deepEqual(
    ranked.map((r) => r.doc.id),
    ['US20150380781A1'],
  );
  const html = await readFile('public/index.html', 'utf8');
  assert.doesNotMatch(html, /id="demoLibrary"/);
  assert.match(html, /填入真實專利案例/);
});
const body = {
  title: 'test',
  claims: 'a'.repeat(30),
  description: 'b'.repeat(30),
  model: 'attacker-model',
  apiKey: 'attacker-key',
};
test('excerpt disclosure is scoped separately from model risk and full input', () => {
  const data = structuredClone(fixture);
  data.items.find((i) => i.id === 'disclosure').status = 'risk';
  data.items.find((i) => i.id === 'disclosure').reason = '這段沒有說明感測方式。';
  const excerpt = validateReport(JSON.stringify(data), { descriptionScope: 'excerpt' }).items.find(
    (i) => i.id === 'disclosure',
  );
  assert.equal(excerpt.status, 'unknown');
  assert.equal(excerpt.excerptObservation, '這段沒有說明感測方式。');
  assert.match(excerpt.scopeLabel, /節錄/);
  const full = validateReport(JSON.stringify(data), { descriptionScope: 'full' }).items.find(
    (i) => i.id === 'disclosure',
  );
  assert.equal(full.status, 'risk');
  assert.equal(full.scopeLabel, undefined);
});
test('Article 26 answer about novelty and Article 21 is rejected as off-topic', () => {
  const wrong = structuredClone(fixture);
  wrong.items.find((i) => i.id === 'claims').reason =
    '此為技術性方法，符合第21條自然法則要求。但因未提供在先技術資料，無法確認新穎性與進步性。';
  const r = validateReport(JSON.stringify(wrong), {
    claims: '溫度及風扇控制',
    description: '說明書',
    priorArt: '',
  });
  const claims = r.items.find((i) => i.id === 'claims');
  assert.equal(claims.modelIssue, '模型回覆偏題');
  assert.equal(claims.status, 'unknown');
  wrong.items.find((i) => i.id === 'claims').reason =
    '請求項用語明確，說明書支持其範圍；新穎性另行檢視。';
  assert.equal(
    validateReport(JSON.stringify(wrong), {}).items.find((i) => i.id === 'claims').modelIssue,
    undefined,
  );
});
test('empty prior art and incomplete model items do not reject the whole report', () => {
  const input = { claims: '電池溫度感測及風扇控制', priorArt: '', filingDate: '' };
  const keyed = {
    items: Object.fromEntries(fixture.items.map(({ id, ...rest }) => [id, rest])),
    comparisons: {},
  };
  const complete = validateReport(JSON.stringify(keyed), input);
  assert.equal(complete.items.length, 7);
  assert.equal(complete.items.find((i) => i.id === 'novelty').status, 'unknown');
  keyed.items.subject.reason = '';
  delete keyed.items.unity;
  const partial = validateReport(JSON.stringify(keyed), input);
  assert.equal(partial.items.find((i) => i.id === 'subject').status, 'unknown');
  assert.equal(partial.items.find((i) => i.id === 'unity').status, 'unknown');
  assert.equal(partial.items.find((i) => i.id === 'industry').status, 'potential');
  const duplicates = validateReport(
    JSON.stringify({ items: [fixture.items[0], fixture.items[0]] }),
    input,
  );
  assert.equal(duplicates.items[0].status, 'unknown');
});
test('comparison rejects invented quotes and citations from the wrong source', () => {
  const input = comparisonInput({
    claims: '使用溫度感測器控制風扇；低溫時維持原轉速。',
    priorArt:
      '[D1] 文件甲\n公開日期：2020-01-01\n使用者匯入的內容（可能不是完整原文）：\nA fan supplies cooling airflow.\n[D2] 文件乙\n公開日期：2021-01-01\n使用者匯入的內容（可能不是完整原文）：\nA sensor measures battery temperature.',
  });
  const rows = validateComparisons(
    [
      {
        featureId: 'F1',
        sourceId: 'D1',
        relation: 'matched',
        quote: 'A sensor measures battery temperature.',
        reason: '錯誤來源',
      },
      {
        featureId: 'F2',
        sourceId: 'D2',
        relation: 'matched',
        quote: 'A sensor measures battery temperature.',
        reason: '模型判讀仍須人工確認',
      },
    ],
    input,
  );
  assert.equal(rows.length, 4);
  assert.equal(rows[0].quoteVerified, false);
  assert.equal(rows[0].relation, 'unknown');
  assert.equal(rows[0].quote, '');
  assert.equal(rows[3].quoteVerified, true);
  assert.equal(rows[1].relation, 'unknown');
});
test('duplicate source labels are rejected and summary-only conclusions remain unknown', () => {
  assert.throws(
    () => comparisonInput({ claims: '文字', priorArt: '[D1] 甲\n原文\n[D1] 乙\n原文' }),
    /重複/,
  );
  const r = validateReport(JSON.stringify(fixture), {
    claims: '技術特徵',
    priorArt: '中文整理摘要：電池散熱控制。',
    filingDate: '2024-01-01',
  });
  assert.equal(r.items.find((i) => i.id === 'novelty').status, 'unknown');
  assert.ok(r.warnings.length);
});
const env = {
  OPENAI_API_KEY: 'owner-key',
  OPENAI_MODEL: 'owner-model',
  ANTHROPIC_API_KEY: 'owner-key',
  CLAUDE_MODEL: 'owner-model',
  GEMINI_API_KEY: 'owner-key',
  GEMINI_MODEL: 'owner-model',
  QWEN_API_KEY: 'owner-key',
  QWEN_MODEL: 'owner-model',
  QWEN_BASE_URL: 'https://qwen.example/v1',
};
function request(path, data, login = true, origin = 'https://site.example') {
  return new Request('https://site.example/api/' + path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin,
      ...(login
        ? {
            'oai-authenticated-user-id': 'user-1',
            'oai-authenticated-user-email': 'user@example.test',
          }
        : {}),
    },
    body: JSON.stringify(data),
  });
}
test('normalizes official case identifiers', () => {
  assert.equal(normalizePublication('TW I642307'), 'TWI642307B');
  assert.throws(() => normalizePublication('https://evil.example'));
});
test('all operational endpoints reject anonymous visitors before external requests', async () => {
  for (const path of ['search', 'document', 'review', 'models'])
    assert.equal((await handle(request(path, body, false), env)).status, 401);
});
test('cross-origin write rejected', async () => {
  assert.equal(
    (await handle(request('review', body, true, 'https://evil.example'), env)).status,
    403,
  );
});
test('public status contains readiness, never keys or endpoint URLs', async () => {
  const r = await handle(new Request('https://site.example/api/status'), env);
  const raw = await r.text();
  assert.doesNotMatch(raw, /owner-key|owner-pass|qwen.example|user@example/);
  const d = JSON.parse(raw);
  assert.equal(d.signedIn, false);
  assert.equal(d.unlimited, true);
  assert.deepEqual(
    d.providers.map((p) => p.id),
    ['qwen'],
  );
  assert.equal(d.searchReady, true);
  assert.equal(d.searchSource, 'Google Patents');
});
test('body-provided credentials cannot enable services', async () => {
  assert.equal((await handle(request('review', { ...body, provider: 'qwen' }), {})).status, 503);
});
test('old document proxy no longer available', async () => {
  assert.equal(
    (await handle(request('document', { url: 'https://evil.example/file' }), env)).status,
    404,
  );
});
test('Qwen uses local owner settings and rejects cloud providers', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (url, opts) => {
    calls++;
    assert.equal(url, 'http://127.0.0.1:11434/api/chat');
    assert.equal(opts.headers.Authorization, undefined);
    assert.equal(JSON.parse(opts.body).model, 'owner-model');
    assert.equal(JSON.parse(opts.body).options.num_ctx, 24576);
    return Response.json({
      message: { content: JSON.stringify(fixture) },
    });
  };
  try {
    for (let i = 0; i < 12; i++)
      assert.equal(
        (
          await handle(request('review', { ...body, provider: 'qwen' }), {
            ...env,
            LOCAL_MODE: 'true',
          })
        ).status,
        200,
      );
    for (const provider of ['openai', 'claude', 'gemini'])
      assert.equal((await handle(request('review', { ...body, provider }), env)).status, 400);
    assert.equal(calls, 84);
  } finally {
    globalThis.fetch = original;
  }
});
test('interface exposes only Qwen', async () => {
  const html = await readFile('public/index.html', 'utf8');
  assert.doesNotMatch(html, /OpenAI|Claude|Gemini|<select id="provider"/);
  assert.match(html, /value="qwen"/);
});
test('local Qwen failure is reported without billing instructions', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response('', { status: 404 });
  try {
    const response = await handle(request('review', { ...body, provider: 'qwen' }), {
      ...env,
      LOCAL_MODE: 'true',
    });
    assert.equal(response.status, 200);
    const report = await response.json();
    assert.equal(report.support[0].stage, 'failed');
    assert.match(report.support[0].gap, /404/);
  } finally {
    globalThis.fetch = original;
  }
});
test('missing evidence never yields novelty/inventive approval', () => {
  const r = validateReport(JSON.stringify(fixture), { provider: 'qwen', model: 'test-model' });
  assert.equal(r.items.find((x) => x.id === 'novelty').status, 'unknown');
  assert.equal(r.items.find((x) => x.id === 'inventive').status, 'unknown');
  assert.throws(() => validateReport('invalid', {}));
});
test('visitor interface contains no credential fields or old settings code', async () => {
  const html = await readFile('public/index.html', 'utf8'),
    js = await readFile('public/app.js', 'utf8');
  assert.doesNotMatch(html, /type="password"|settingsDialog|id="model"/);
  assert.doesNotMatch(js, /state\.keys|credentials\(|apiKey:/);
  assert.match(html, /\/signin-with-chatgpt\?return_to=%2F/);
});

const patentHtml =
  '<meta content="TW:I642307:B" name="citation_patent_number"><meta name="DC.title" content="Sample &amp; Device"><meta name="DC.date" scheme="dateSubmitted" content="2015-12-18"><meta name="citation_pdf_url" content="https://patentimages.storage.googleapis.com/a/TWI642307B.pdf"><section itemprop="abstract"><h2>Abstract</h2><p>摘要</p></section><section itemprop="description"><invention-title>測試裝置</invention-title><div>說明書 &lt;內容&gt;</div></section><section itemprop="claims"><div num="1">第一項</div><div num="2">第二項</div></section>';
test('publication normalization distinguishes application numbers', () => {
  assert.equal(normalizePublication('TW201637458A'), 'TW201637458A');
  assert.equal(normalizePublication('201637458'), 'TW201637458A');
  assert.throws(() => normalizePublication('104142817'));
  assert.throws(() => normalizePublication('https://evil.example'));
});
test('parser verifies exact identity and preserves claim numbers', () => {
  const d = parsePatent(patentHtml, 'TWI642307B');
  assert.equal(d.info.title, '測試裝置');
  assert.match(d.claims, /1. 第一項/);
  assert.match(d.claims, /2. 第二項/);
  assert.match(d.description, /<內容>/);
  assert.equal(d.files.length, 1);
  assert.throws(() => parsePatent(patentHtml, 'TWI000000B'));
});
test('PDF links require trusted host and matching publication', () => {
  assert.equal(safePdfURL('https://evil.example/TWI642307B.pdf', 'TWI642307B'), null);
  assert.equal(
    safePdfURL('https://patentimages.storage.googleapis.com/a/TWI999999B.pdf', 'TWI642307B'),
    null,
  );
  assert.equal(
    safePdfURL('https://patentimages.storage.googleapis.com/a/TWI642307B.pdf?x=1', 'TWI642307B'),
    null,
  );
});
test('Google lookup works without TIPO credentials and handles source failures', async () => {
  const original = globalThis.fetch;
  try {
    let called;
    globalThis.fetch = async (url, opts) => {
      called = url;
      assert.equal(opts.redirect, 'manual');
      return new Response(patentHtml, { headers: { 'content-type': 'text/html' } });
    };
    const r = await handle(request('search', { number: 'I642307' }), {});
    assert.equal(r.status, 410);
    assert.equal(called, undefined);
    globalThis.fetch = async () => new Response('', { status: 429 });
    await assert.rejects(searchPatent('I642307'), /暫時無法直接讀取/);
    globalThis.fetch = async () => new Response('', { status: 404 });
    await assert.rejects(searchPatent('I642307'), /不表示專利不存在/);
  } finally {
    globalThis.fetch = original;
  }
});

test('saved HTML imports locally and checks publication identity', () => {
  const d = importSavedPatent(patentHtml, 'I642307');
  assert.equal(d.imported, true);
  assert.equal(d.info.publication, 'TWI642307B');
  assert.throws(() => importSavedPatent(patentHtml, 'I000000'));
  assert.throws(() => importSavedPatent('<html>not a patent</html>'));
});
test('saved scripts are excluded from extracted patent text', () => {
  const d = importSavedPatent(
    patentHtml.replace('第一項', '第一項<script>window.bad=true</script>'),
  );
  assert.doesNotMatch(d.claims, /window.bad/);
});
test('source 503 is distinguishable from missing patent', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response('', { status: 503 });
  try {
    await assert.rejects(searchPatent('I642307'), /503/);
  } finally {
    globalThis.fetch = original;
  }
});

import { runEvidencePipeline, selectedEvidence, passages } from './pipeline.mjs';
test('pipeline rejects invented evidence and skips interpretation without a quote', async () => {
  const input = {
    features: [{ id: 'F1', text: 'fan speed' }],
    sources: [{ id: 'D1', text: 'The fan cools the battery.', title: 'source' }],
  };
  let calls = [];
  const result = await runEvidencePipeline(
    input,
    'The fan cools the battery.',
    async (_, payload) => {
      calls.push(payload);
      return { passageId: 'P1', quote: 'invented technical evidence' };
    },
  );
  assert.equal(calls.length, 2);
  assert.ok(calls.every((p) => p.task === 'extract'));
  assert.equal(result.comparisons.F1_D1.relation, 'unknown');
  assert.equal(result.support[0].quote, '');
  assert.equal(
    selectedEvidence(
      { passageId: 'P2', quote: 'The fan cools' },
      passages('The fan cools the battery.'),
    ),
    null,
  );
});
test('pipeline isolates each feature/source and verifies support before interpretation', async () => {
  const input = {
    features: [
      { id: 'F1', text: 'fan speed' },
      { id: 'F2', text: 'battery temperature' },
    ],
    sources: [{ id: 'D1', text: 'The fan cools the battery.', title: 'source' }],
  };
  let calls = [];
  const result = await runEvidencePipeline(
    input,
    'The fan cools the battery.',
    async (_, payload) => {
      calls.push(payload);
      return payload.task === 'extract'
        ? { passageId: 'P1', quote: 'The fan cools the battery.' }
        : { relation: 'different', reason: '未提及風扇轉速。', gap: 'missing' };
    },
  );
  assert.equal(calls.length, 8);
  assert.ok(calls.every((p) => p.feature.id && p.sourceId));
  assert.ok(result.support.every((r) => r.quote && r.relation === 'unknown'));
  assert.equal(result.comparisons.F1_D1.stage, 'compared');
});
test('review stream delivers progress then a complete conservative report', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({ message: { content: JSON.stringify({ passageId: '', quote: '' }) } });
  try {
    const response = await handle(request('review', { ...body, provider: 'qwen', stream: true }), {
      ...env,
      LOCAL_MODE: 'true',
    });
    assert.match(response.headers.get('content-type'), /ndjson/);
    const events = (await response.text()).trim().split('\n').map(JSON.parse);
    assert.equal(events[0].type, 'progress');
    assert.equal(events.at(-1).type, 'result');
    assert.equal(events.at(-1).report.support[0].quoteVerified, false);
    assert.equal(events.at(-1).report.items.find((i) => i.id === 'claims').status, 'unknown');
  } finally {
    globalThis.fetch = original;
  }
});

test('bare matched label never becomes a verified interpretation', async () => {
  const result = await runEvidencePipeline(
    { features: [{ id: 'F1', text: 'fan speed' }], sources: [] },
    'The fan cools the battery.',
    async (_, p) =>
      p.task === 'extract'
        ? { passageId: 'P1', quote: 'The fan cools the battery.' }
        : { relation: 'matched', reason: 'matched', gap: '' },
  );
  assert.equal(result.support[0].relation, 'unknown');
  assert.equal(result.support[0].stage, 'comparison_incomplete');
  assert.ok(result.support[0].quote);
});

test('comparison repairs a label-only reason once and does not display raw gap labels', async () => {
  let attempts = 0;
  const result = await runEvidencePipeline(
    { features: [{ id: 'F1', text: 'fan speed' }], sources: [] },
    'The fan cools the battery.',
    async (_, p) => {
      if (p.task === 'extract') return { passageId: 'P1', quote: 'The fan cools the battery.' };
      attempts++;
      return attempts === 1
        ? { relation: 'matched', reason: 'matched', gap: 'matched' }
        : {
            relation: 'unknown',
            reason: '引句只記載風扇冷卻電池，無法確認轉速設定。',
            gap: 'matched',
          };
    },
  );
  assert.equal(attempts, 2);
  assert.equal(result.support[0].stage, 'compared');
  assert.equal(result.support[0].relation, 'unknown');
  assert.doesNotMatch(result.support[0].gap, /matched/);
});
test('English legal replies with Yes next steps are repaired or explicitly marked incomplete', async () => {
  const original = globalThis.fetch;
  const attempts = {};
  const bad = {
    status: 'unknown',
    reason: 'A technical method.',
    evidence: 'Battery cooling.',
    next: 'Yes',
  };
  const good = {
    inputQuote: body.claims,
    quoteId: 'C1',
    status: 'unknown',
    reason: '目前提供內容不足以確認本項判斷。',
    evidence: '需要進一步核對技術內容與適用範圍。',
    next: '請人工核對本項所需證據及適用範圍。',
  };
  globalThis.fetch = async (_, opts) => {
    const p = JSON.parse(JSON.parse(opts.body).messages[1].content);
    let value;
    if (p.task === 'extract') value = { passageId: '', quote: '' };
    else if (p.task === 'legal') {
      attempts[p.criterion] = (attempts[p.criterion] || 0) + 1;
      assert.equal(JSON.parse(opts.body).think, false);
      assert.ok(JSON.parse(opts.body).messages[0].content.includes('不是請求項編號'));
      assert.equal(p.claimsOriginal, body.claims);
      assert.ok(JSON.parse(opts.body).messages[0].content.includes('輸出 JSON 結構與欄位要求'));
      value = attempts[p.criterion] > 1 && p.criterion !== 'industry' ? good : bad;
    } else throw Error('unexpected task');
    return Response.json({ message: { content: JSON.stringify(value) } });
  };
  try {
    const response = await handle(request('review', { ...body, provider: 'qwen' }), {
      ...env,
      LOCAL_MODE: 'true',
    });
    const report = await response.json();
    assert.deepEqual(attempts, { subject: 2, industry: 2, unity: 2 });
    assert.equal(report.items.find((i) => i.id === 'subject').reason, good.reason);
    assert.equal(report.items.find((i) => i.id === 'industry').modelIssue, '模型回覆未通過核對');
    assert.ok(report.items.every((i) => i.next !== 'Yes'));
  } finally {
    globalThis.fetch = original;
  }
});

test('absence phrased as not involved or not present cannot establish difference', async () => {
  for (const reason of ['引句並未涉及最低轉速的判斷流程。', '上述特徵均未在引句中出現或被支持。']) {
    const result = await runEvidencePipeline(
      { features: [{ id: 'F1', text: 'minimum fan speed' }], sources: [] },
      'The fan cools the battery.',
      async (_, p) =>
        p.task === 'extract'
          ? { passageId: 'P1', quote: 'The fan cools the battery.' }
          : { relation: 'different', reason, gap: '請核對相關原文的完整上下文。' },
    );
    assert.equal(result.support[0].relation, 'unknown');
  }
});

test('review rejects impossible dates before invoking the model', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    throw Error('unexpected');
  };
  try {
    const r = await handle(
      request('review', { ...body, provider: 'qwen', filingDate: '2026-02-30' }),
      { ...env, LOCAL_MODE: 'true' },
    );
    assert.equal(r.status, 400);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = original;
  }
});
test('unlabelled source prefix is never silently discarded', () => {
  assert.throws(
    () =>
      comparisonInput({
        claims: 'example claim',
        priorArt: 'Important earlier text\n[D1] Patent\nSource text',
      }),
    /編號前/,
  );
});
test('embedded source separators preserve all content after first separator', () => {
  const content =
    'First original paragraph\n使用者匯入的內容（可能不是完整原文）：\nSecond original paragraph';
  const r = comparisonInput({
    claims: 'example claim',
    priorArt: '[D1] Patent\n使用者匯入的內容（可能不是完整原文）：\n' + content,
  });
  assert.equal(r.sources[0].text, content);
});
test('impossible publication dates are flagged even when all quotes match', () => {
  const b = {
    claims: 'a feature',
    filingDate: '2025-01-01',
    priorArt: '[D1] Patent\n公開日期：2024-02-30\noriginal source text',
  };
  const report = validateReport(
    JSON.stringify({
      ...fixture,
      comparisons: {
        F1_D1: { relation: 'matched', quote: 'original source text', reason: 'test', gap: 'test' },
      },
    }),
    b,
  );
  assert.ok(report.warnings.some((w) => w.includes('日期')));
});

import { verifiedInputQuote } from './pipeline.mjs';
test('legal quotes must exist in one input field, not invented or stitched', () => {
  const input = {
    claims: 'The fan controls temperature.',
    description: 'A processing device selects speed.',
  };
  assert.equal(
    verifiedInputQuote({ inputQuote: 'The fan controls temperature.' }, input),
    'The fan controls temperature.',
  );
  assert.equal(verifiedInputQuote({ inputQuote: 'The fan uses a cooling liquid.' }, input), '');
  assert.equal(verifiedInputQuote({ inputQuote: 'temperature. A processing' }, input), '');
});
test('plausible Chinese legal answers with invented quotes stay unverified', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (_, opts) => {
    const p = JSON.parse(JSON.parse(opts.body).messages[1].content);
    return Response.json({
      message: {
        content: JSON.stringify(
          p.task === 'extract'
            ? { passageId: '', quote: '' }
            : {
                status: 'potential',
                reason: '這是完整中文說明但證據沒有通過核對。',
                evidence: '模型聲稱文件包含這個技術內容。',
                next: '請核對相關技術內容與原文依據。',
                inputQuote: 'This quotation was never supplied.',
              },
        ),
      },
    });
  };
  try {
    const r = await handle(request('review', { ...body, provider: 'qwen' }), {
      ...env,
      LOCAL_MODE: 'true',
    });
    const report = await r.json();
    for (const id of ['subject', 'industry', 'unity']) {
      const i = report.items.find((i) => i.id === id);
      assert.equal(i.status, 'unknown');
      assert.equal(i.inputQuote, undefined);
      assert.equal(i.modelIssue, '模型回覆未通過核對');
    }
  } finally {
    globalThis.fetch = original;
  }
});

test('missing evidence messages do not request an already supplied date', () => {
  const r = validateReport(JSON.stringify(fixture), {
    filingDate: '2020-09-02',
    claims: 'some supplied claim',
    description: 'some supplied description',
  });
  const item = r.items.find((i) => i.id === 'novelty');
  assert.doesNotMatch(item.next, /申請|優先權/);
  assert.match(item.evidence, /2020-09-02/);
});

import { clarifyFragmentReferences } from './pipeline.mjs';
test('system fragment identifiers are labelled as fragments rather than official claim numbers', () => {
  assert.equal(
    clarifyFragmentReferences('所有請求項C1至C4與說明書S1'),
    '所有請求項文字片段 C1至C4與說明書文字片段 S1',
  );
  assert.equal(clarifyFragmentReferences('請求項1及說明書[0016]'), '請求項1及說明書[0016]');
});
import vm from 'node:vm';
import * as libraryTools from './public/similarity.js';

async function isolatedLibrary(initial, { beforeDefaults } = {}) {
  const bundled = JSON.parse(await readFile('public/battery-patents.json', 'utf8'));
  const elements = new Map();
  function element() {
    return {
      value: '',
      children: [],
      events: {},
      append(...children) {
        this.children.push(...children);
      },
      replaceChildren(...children) {
        this.children = children;
      },
      addEventListener(name, fn) {
        this.events[name] = fn;
      },
      dispatchEvent() {},
      click() {},
      focus() {},
      closest() {
        return {};
      },
    };
  }
  function get(id) {
    if (!elements.has(id)) elements.set(id, element());
    return elements.get(id);
  }
  const key = 'patent-review-library-v1';
  const store = new Map(initial === null ? [] : [[key, initial]]);
  const localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  const source = (await readFile('public/library.js', 'utf8')).replace(/^import [^\n]+\n/, '');
  const fetch = async () => {
    if (beforeDefaults) beforeDefaults(store, key);
    return { ok: true, json: async () => bundled };
  };
  await vm.runInNewContext(source, {
    ...libraryTools,
    localStorage,
    fetch,
    Event,
    document: { getElementById: get, createElement: element, querySelector: () => element() },
  });
  return { get, store, key, bundled };
}
test('refresh preserves a customized library and intentionally empty library', async () => {
  const { bundled } = await isolatedLibrary(null);
  const custom = normalizeDataset([bundled[1]]);
  custom[0].text = bundled[1].example.description;
  for (const data of [custom, []]) {
    const saved = JSON.stringify(data);
    const { store, key } = await isolatedLibrary(saved);
    assert.equal(store.get(key), saved);
  }
});
test('an unreadable saved library is preserved on startup', async () => {
  const { store, key } = await isolatedLibrary('{');
  assert.equal(store.get(key), '{');
});
test('library transfer appends to manual and numbered evidence without changing earlier text', async () => {
  const { get, bundled } = await isolatedLibrary(null);
  get('similarQuery').value = bundled[1].example.claims;
  get('similarDate').value = bundled[1].example.filingDate;
  get('similarForm').onsubmit({ preventDefault() {} });
  const check = get('similarResults').children[0].children[0].children[0];
  check.checked = true;
  check.onchange();
  for (const previous of [bundled[1].example.description, buildEvidence([{ doc: bundled[1] }])]) {
    get('priorArt').value = previous;
    get('replaceEvidence').checked = false;
    get('transferEvidence').onclick();
    const parsed = comparisonInput({
      claims: bundled[1].example.claims,
      priorArt: get('priorArt').value,
    });
    assert.deepEqual(
      parsed.sources.map((s) => s.id),
      ['D1', 'D2'],
    );
    assert.equal(
      parsed.sources[0].text,
      previous === bundled[1].example.description ? previous : bundled[1].text,
    );
    assert.equal(parsed.sources[1].text, bundled[0].text);
  }
  get('similarDate').events.input();
  assert.equal(get('transferEvidence').disabled, true);
  assert.equal(get('similarResults').children.length, 0);
});
test('slow first-load seeding preserves a library saved by another tab', async () => {
  const { store, key } = await isolatedLibrary(null, {
    beforeDefaults: (store, key) => store.set(key, '[]'),
  });
  assert.equal(store.get(key), '[]');
});
test('legacy migration keeps edited real records and archives retired examples', async () => {
  const { bundled } = await isolatedLibrary(null);
  const custom = { ...bundled[1], text: bundled[1].example.description };
  const retired = { ...bundled[0], id: 'DEMO-001', demo: true };
  const { store, key } = await isolatedLibrary(JSON.stringify([custom, retired]));
  const saved = JSON.parse(store.get(key));
  assert.equal(saved.length, 2);
  assert.equal(saved.find((d) => d.id === custom.id).text, custom.text);
  assert.equal(JSON.parse(store.get(key + '-retired-demo-backup'))[0].id, retired.id);
});
