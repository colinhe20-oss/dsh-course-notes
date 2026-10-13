/**
 * Stage D — external knowledge retrieval.
 *
 * The plugin only ever calls the Harness `web` service (`ctx.web.search` /
 * `ctx.web.fetch`).  Nothing here talks to the network directly, so provider
 * selection, credentials, rate limiting and auditing all stay owned by the
 * deployment, and the stage degrades to a clearly reported "not performed"
 * state when no provider is registered.
 *
 * Query generation is deliberately selective: a typical lecture has hundreds
 * of sentences but only a handful of genuinely uncertain or derivation-heavy
 * points.  Retrieval therefore targets
 *
 *   * formulas                — full derivations and worked numbers,
 *   * English terminology     — authoritative definitions,
 *   * low-coverage concepts   — background the slides omit,
 *   * examples/applications   — concrete use cases,
 *   * verification targets    — statements worth fact-checking,
 *
 * and never spends a query on a plain sentence of the material.
 */

import { normalizeWhitespace, hasCjk, neutralizeUntrustedText, uniqueBy } from './util.js';

export const RETRIEVAL_REASONS = Object.freeze({
  formula: '查找该公式的完整推导、变量含义与计算示例',
  terminology: '确认英文术语的权威定义与标准译法',
  concept: '补充课件未展开的背景知识',
  example: '寻找典型例题或应用案例',
  verification: '核查课件中可能不准确或易混淆的结论',
});

const PRIORITY_ORDER = { formula: 0, terminology: 1, verification: 2, concept: 3, example: 4 };

function pickEnglishTerm(point) {
  for (const term of point.terms ?? []) {
    if (term.en && term.en.length >= 3 && term.en.length <= 70) return term.en;
  }
  const match = String(point.titleFull ?? '').match(/[（(]([A-Za-z][A-Za-z0-9 .\-+/&']{3,70})[)）]/);
  return match ? normalizeWhitespace(match[1]) : '';
}

/**
 * Choose the human-readable name of a formula's topic.
 *
 * `point.title` is often the formula itself (`$$U = \frac{...}$$`), which is not
 * a searchable phrase.  Preferring the section title, then the chapter title,
 * and only then the point title keeps queries meaningful.  The chosen text is
 * stripped of markup by `cleanQuery` afterwards.
 */
function namesFormulaTopic(point) {
  const candidates = [point.section, point.chapterTitle, point.title];
  for (const candidate of candidates) {
    const value = normalizeWhitespace(candidate ?? '');
    if (value !== '') return value;
  }
  return '';
}

/** True when a topic name carries at least one searchable word. */
function isSearchableTopic(topic) {
  const letters = String(topic ?? '').replace(/[^A-Za-z\u3400-\u9fff]/g, '');
  return letters.length >= 4;
}

/**
 * Turn an arbitrary knowledge-point string into a usable search query.
 *
 * LaTeX and Markdown markup are stripped rather than searched: a query like
 * `$$U = \frac{T_{transmit}}{...}` is noise to a search engine (and gets
 * mangled in transit), so the *name* of the formula is what belongs in the
 * query.  Braces are removed explicitly because web providers treat `{` and
 * `}` as special characters.
 */
function cleanQuery(text) {
  return normalizeWhitespace(text)
    .replace(/\$\$?/g, ' ')
    .replace(/\\[a-zA-Z]+\s*/g, ' ')
    .replace(/[{}]/g, ' ')
    .replace(/[*_`>#|~^]/g, ' ')
    .replace(/[（(]\s*[)）]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
}

/** True when a candidate query carries no real searchable content. */
function isUselessQuery(query) {
  const letters = query.replace(/[^A-Za-z\u3400-\u9fff]/g, '');
  if (letters.length < 4) return true;
  if (/^[\s=+\-/*<>^_.,;:0-9]+$/.test(query)) return true;
  return false;
}

/**
 * Build the retrieval plan.
 * @param {object} knowledge   result of `extractKnowledge`
 * @param {object} options
 * @returns {{queries: object[], total: number}}
 */
export function buildRetrievalPlan(knowledge, options = {}) {
  const {
    maxSearches = 12,
    extraSearchKeywords = [],
    locale = 'auto',
    includeExamples = true,
  } = options;

  const wantsChinese = locale === 'zh' || (locale === 'auto' && knowledge.counts.glossary > 0);
  const queries = [];
  const push = (entry) => {
    const query = cleanQuery(entry.query);
    if (query.length < 3 || isUselessQuery(query)) return;
    queries.push({ ...entry, query });
  };

  for (const point of knowledge.keyPoints) {
    if (point.kind === 'formula' || point.mathLike) {
      const english = pickEnglishTerm(point);
      // A bare LaTeX block makes a useless query; the section or chapter title
      // is what actually names the formula's topic.
      const topic = namesFormulaTopic(point);
      if (english) {
        push({
          reason: 'formula',
          topic: topic.slice(0, 80),
          chapterIndex: point.chapterIndex,
          pointId: point.id,
          query: `${english} formula derivation explained`,
        });
      } else if (isSearchableTopic(topic)) {
        // With neither an English term nor a real topic name there is nothing
        // to search for — issuing the bare template would return noise.
        push({
          reason: 'formula',
          topic: topic.slice(0, 80),
          chapterIndex: point.chapterIndex,
          pointId: point.id,
          query: `${topic.slice(0, 60)} 公式 推导 变量含义`,
        });
      }
    }
  }

  const glossaryByOccurrence = [...knowledge.glossary].sort(
    (a, b) => b.occurrences - a.occurrences,
  );
  for (const term of glossaryByOccurrence) {
    if (term.en === '' || term.abbr === '') {
      push({
        reason: 'terminology',
        topic: term.zh || term.en,
        query: wantsChinese && term.zh
          ? `${term.zh} ${term.en} 定义 全称`
          : `${term.en} definition full name`,
      });
    }
  }

  for (const point of knowledge.keyPoints) {
    if (point.kind === 'comparison') {
      push({
        reason: 'verification',
        topic: point.title.slice(0, 80),
        chapterIndex: point.chapterIndex,
        pointId: point.id,
        query: `${point.title.slice(0, 60)} 区别 对比 准确`,
      });
    } else if (point.kind === 'theorem') {
      const english = pickEnglishTerm(point);
      push({
        reason: 'verification',
        topic: point.title.slice(0, 80),
        chapterIndex: point.chapterIndex,
        pointId: point.id,
        query: english
          ? `${english} conditions statement`
          : `${point.title.slice(0, 40)} 定理 条件 结论`,
      });
    } else if (point.kind === 'architecture') {
      const english = pickEnglishTerm(point);
      push({
        reason: 'concept',
        topic: point.title.slice(0, 80),
        chapterIndex: point.chapterIndex,
        pointId: point.id,
        query: english ? `${english} architecture explained` : `${point.title.slice(0, 40)} 原理 讲解`,
      });
    }
  }

  if (includeExamples) {
    for (const chapter of knowledge.chapters) {
      push({
        reason: 'example',
        topic: chapter.title,
        chapterIndex: chapter.index,
        query: `${chapter.title.slice(0, 50)} 例题 应用 案例`,
      });
    }
  }

  const withExtras = [];
  for (const entry of queries) {
    withExtras.push(entry);
    for (const keyword of extraSearchKeywords) {
      if (entry.reason === 'example' || entry.reason === 'concept') {
        withExtras.push({ ...entry, query: `${entry.query} ${keyword}` });
      }
    }
  }

  const deduped = uniqueBy(withExtras, (entry) => cleanQuery(entry.query).toLowerCase());
  deduped.sort((a, b) => {
    const pa = PRIORITY_ORDER[a.reason] ?? 9;
    const pb = PRIORITY_ORDER[b.reason] ?? 9;
    if (pa !== pb) return pa - pb;
    return (a.chapterIndex ?? 0) - (b.chapterIndex ?? 0);
  });

  return { queries: deduped.slice(0, Math.max(0, maxSearches)), total: deduped.length };
}

/** Extract readable text + links from a fetched response body. */
export function extractFetchText(result) {
  const body = result?.body;
  if (!body) return { text: '', kind: 'unknown' };
  if (body.kind === 'text') {
    return { text: neutralizeUntrustedText(body.content ?? ''), kind: 'text' };
  }
  const html = String(body.content ?? '');
  const withoutNoise = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article|pre|code)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, ' ');
  const entities = {
    '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"',
    '&#39;': "'", '&mdash;': '—', '&ndash;': '–', '&hellip;': '…',
  };
  const text = withoutNoise
    .replace(/&[a-z#0-9]+;/gi, (match) => entities[match.toLowerCase()] ?? ' ')
    .split('\n')
    .map((line) => normalizeWhitespace(line))
    .filter((line) => line !== '')
    .join('\n');
  return { text: neutralizeUntrustedText(text), kind: 'html' };
}

function classifySourceType(url, title = '') {
  const value = `${url} ${title}`.toLowerCase();
  if (/arxiv\.org|doi\.org|ieee\.org|acm\.org|springer|sciencedirect|nature\.com|science\.org|cnki\.net|wanfangdata/.test(value)) {
    return 'paper';
  }
  if (/\.edu(\/|$)|\.edu\.cn|\.ac\.uk|ocw\.mit|cs50|stanford|berkeley|tsinghua|zju\.edu/.test(value)) {
    return 'university';
  }
  if (/docs\.|documentation|developer\.|readthedocs|\.gov(\/|$)|w3\.org|ietf\.org|rfc-editor|iso\.org/.test(value)) {
    return 'official';
  }
  if (/github\.com|gitlab\.com|stackoverflow|stackexchange/.test(value)) {
    return 'code-community';
  }
  if (/wikipedia\.org|britannica|baike\.baidu/.test(value)) {
    return 'encyclopedia';
  }
  if (/csdn\.net|zhihu\.com|cnblogs\.com|jianshu|medium\.com|substack|juejin\.cn/.test(value)) {
    return 'blog';
  }
  return 'web';
}

const SOURCE_TRUST = {
  official: 5,
  university: 4,
  paper: 4,
  encyclopedia: 3,
  'code-community': 2,
  blog: 1,
  web: 1,
};

/**
 * Run the retrieval stage.
 *
 * @param {object} deps
 * @param {{search?: Function, fetch?: Function}} deps.web  ctx.web (or a stub)
 * @param {object} knowledge
 * @param {object} options
 * @param {object} logger
 */
export async function runRetrieval(deps, knowledge, options = {}, logger = null) {
  const {
    enableWebSearch = true,
    maxSearches = 12,
    maxFetches = 8,
    signal,
    searchTimeoutMs = 30000,
    fetchTimeoutMs = 30000,
  } = options;

  const report = {
    enabled: enableWebSearch,
    performed: false,
    reason: null,
    plan: { queries: [], total: 0 },
    results: [],
    fetchResults: [],
    sources: [],
    errors: [],
    skippedQueries: [],
  };

  const web = deps?.web;
  if (!enableWebSearch) {
    report.reason = 'disabled-by-config';
    return report;
  }
  if (!web || typeof web.search !== 'function') {
    report.reason = 'web-service-unavailable';
    return report;
  }

  const plan = buildRetrievalPlan(knowledge, { maxSearches, extraSearchKeywords: options.extraSearchKeywords });
  report.plan = plan;
  if (plan.queries.length === 0) {
    report.reason = 'no-query-needed';
    return report;
  }

  for (const entry of plan.queries.slice(0, Math.max(0, maxSearches))) {
    if (signal?.aborted) {
      report.errors.push({ query: entry.query, code: 'aborted', message: '检索被取消' });
      break;
    }
    try {
      const timeout = withTimeout(signal, searchTimeoutMs);
      const result = await web.search({ query: entry.query, maxResults: 5 }, timeout.signal);
      timeout.done();
      const sources = (result?.sources ?? []).map((source) => ({
        url: source.url,
        title: source.title ?? '',
        snippet: normalizeWhitespace(source.snippet ?? '').slice(0, 400),
        publishedAt: source.publishedAt ?? '',
        type: classifySourceType(source.url, source.title ?? ''),
      }));
      report.results.push({
        reason: entry.reason,
        reasonLabel: RETRIEVAL_REASONS[entry.reason] ?? entry.reason,
        topic: entry.topic,
        chapterIndex: entry.chapterIndex ?? null,
        pointId: entry.pointId ?? null,
        query: entry.query,
        answer: normalizeWhitespace(result?.content ?? '').slice(0, 2000),
        truncated: Boolean(result?.truncated),
        sources,
      });
      logger?.debug('search ok', { query: entry.query, results: sources.length });
    } catch (error) {
      report.errors.push({
        query: entry.query,
        code: error?.code ?? error?.name ?? 'SEARCH_FAILED',
        message: String(error?.message ?? error).slice(0, 400),
      });
      logger?.warn('search failed', { query: entry.query, error: String(error?.message ?? error) });
    }
  }
  report.performed = report.results.length > 0;

  // Only fetch the highest-trust sources, and only enough to add real detail.
  const candidates = [];
  for (const result of report.results) {
    for (const source of result.sources) {
      candidates.push({ ...source, reason: result.reason, topic: result.topic, query: result.query });
    }
  }
  const ranked = uniqueBy(
    candidates.sort((a, b) => (SOURCE_TRUST[b.type] ?? 0) - (SOURCE_TRUST[a.type] ?? 0)),
    (item) => item.url,
  ).filter((item) => (SOURCE_TRUST[item.type] ?? 0) >= 3);

  for (const candidate of ranked.slice(0, Math.max(0, maxFetches))) {
    if (signal?.aborted) break;
    if (typeof web.fetch !== 'function') break;
    try {
      const timeout = withTimeout(signal, fetchTimeoutMs);
      const result = await web.fetch({ url: candidate.url }, timeout.signal);
      timeout.done();
      const { text, kind } = extractFetchText(result);
      report.fetchResults.push({
        url: candidate.url,
        title: candidate.title,
        type: candidate.type,
        statusCode: result?.statusCode ?? 0,
        truncated: Boolean(result?.truncated),
        bodyKind: kind,
        text: text.slice(0, 12000),
        relatedTopic: candidate.topic,
        retrievReason: candidate.reason,
      });
    } catch (error) {
      report.errors.push({
        url: candidate.url,
        code: error?.code ?? 'FETCH_FAILED',
        message: String(error?.message ?? error).slice(0, 300),
      });
    }
  }

  report.sources = uniqueBy(
    [
      ...report.results.flatMap((result) => result.sources),
      ...report.fetchResults.map((item) => ({
        url: item.url,
        title: item.title,
        type: item.type,
        snippet: '',
      })),
    ],
    (item) => item.url,
  ).map((item, index) => ({ ...item, index: index + 1, trust: SOURCE_TRUST[item.type] ?? 1 }));

  return report;
}

/**
 * Describe the retrieval state for the model in one unambiguous line.  A run
 * that could not search must say so instead of quietly producing notes that
 * look externally verified.
 */
export function summariseRetrieval(report) {
  if (!report) return '外部检索未执行（无检索记录）。';
  if (!report.enabled) return '外部检索未执行：配置中已关闭（enableWebSearch=false）。';
  if (report.reason === 'web-service-unavailable') {
    return '外部检索未执行：当前 Harness 未注册可用的 web 检索服务（ctx.web 不可用）。';
  }
  if (report.reason === 'no-query-needed') {
    return '外部检索未执行：本次材料没有需要外部补充的知识点。';
  }
  if (!report.performed) {
    const first = report.errors[0];
    return `外部检索未完成：${report.errors.length} 次检索全部失败（首个错误：${first?.code ?? 'unknown'} ${first?.message ?? ''}）。`;
  }
  return `外部检索已完成：${report.results.length} 条查询成功，抓取 ${report.fetchResults.length} 个页面，可用来源 ${report.sources.length} 个；失败 ${report.errors.length} 条。`;
}

function withTimeout(parentSignal, timeoutMs) {
  const controller = new AbortController();
  const onAbort = () => controller.abort(parentSignal?.reason);
  if (parentSignal) {
    if (parentSignal.aborted) controller.abort(parentSignal.reason);
    else parentSignal.addEventListener('abort', onAbort, { once: true });
  }
  const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);
  return {
    signal: controller.signal,
    done: () => {
      clearTimeout(timer);
      if (parentSignal) parentSignal.removeEventListener('abort', onAbort);
    },
  };
}

export { classifySourceType, hasCjk };
