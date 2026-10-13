/**
 * Stage D (part 2) — knowledge-point ↔ evidence mapping.
 *
 * `retrieve.js` produces *search results*: queries, source lists, fetched page
 * text.  This module turns that into *evidence*: the excerpts that belong to one
 * knowledge point, with enough provenance that a note can cite them truthfully.
 *
 * The distinction matters because the previous implementation passed the model a
 * list of titles and URLs.  A URL alone cannot support an explanation of a
 * derivation, so the model either wrote from memory (unverifiable) or invented
 * a citation.  Evidence with an excerpt can be quoted, checked and attributed.
 *
 * ## Rules encoded here
 *
 *   * **Only retrieved URLs exist.** {@link buildEvidenceIndex} builds its
 *     allowlist from the retrieval report itself.  Nothing can be cited that was
 *     not actually returned by `ctx.web`, so a fabricated URL cannot survive
 *     citation validation.
 *   * **Every excerpt is untrusted input.** Web pages and course files both go
 *     through `neutralizeUntrustedText`; an excerpt is data for the model to
 *     read, never an instruction for it to follow.
 *   * **No evidence is invented for an unrelated point.** A source is attached
 *     to a point only when the query that produced it was issued *for* that
 *     point, or when the topical overlap is above a real threshold.  Attaching
 *     a random high-trust page to every point is worse than attaching nothing,
 *     because it makes the source list look complete.
 */

import {
  normalizeWhitespace,
  neutralizeUntrustedText,
  neutraliseCostlyPromptText,
  uniqueBy,
  hasCjk,
} from './util.js';

/** Trust score assigned to each source type (mirrors retrieve.js). */
export const SOURCE_TRUST = Object.freeze({
  official: 5,
  university: 4,
  paper: 4,
  encyclopedia: 3,
  'code-community': 2,
  blog: 1,
  web: 1,
});

/** Default per-excerpt and per-point character budgets. */
export const EVIDENCE_LIMITS = Object.freeze({
  excerptChars: 900,
  lectureChars: 900,
  perPoint: 4,
  totalChars: 24000,
});

function label(kind) {
  return kind;
}

/**
 * Collapse a fetched page into the sentences most likely to answer a query.
 *
 * A whole page is far too long to attach to every knowledge point, and its first
 * 900 characters are usually navigation chrome.  Scoring *paragraphs* (not
 * sentences) keeps a line of a derivation or a definition together, which is
 * exactly the unit a study note needs to quote.
 */
export function selectRelevantExcerpt(text, query, maxChars = EVIDENCE_LIMITS.excerptChars) {
  const value = normalizeWhitespace(text ?? '');
  if (value === '') return '';
  if (value.length <= maxChars) return value;

  const paragraphs = value
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 40);
  if (paragraphs.length === 0) return value.slice(0, maxChars);

  const terms = queryTerms(query);
  const scored = paragraphs.map((paragraph, index) => {
    const lowered = paragraph.toLowerCase();
    let score = 0;
    for (const term of terms) {
      if (lowered.includes(term)) score += term.length >= 6 ? 3 : 2;
    }
    // A paragraph with real structure (a formula, a list, a definition marker)
    // is more likely to be the explanatory passage than prose filler.
    if (/[=≤≥∑∈]|公式|定义|推导|theorem|definition|derivation|algorithm/i.test(paragraph)) score += 1;
    // Mild positional prior: the opening of an article is usually its summary.
    if (index === 0) score += 1;
    return { paragraph, index, score };
  });

  const chosen = [];
  let used = 0;
  for (const item of scored.slice().sort((a, b) => b.score - a.score || a.index - b.index)) {
    if (used + item.paragraph.length > maxChars && chosen.length > 0) continue;
    chosen.push(item);
    used += item.paragraph.length + 2;
    if (used >= maxChars) break;
  }
  if (chosen.length === 0) return value.slice(0, maxChars);
  return chosen
    .sort((a, b) => a.index - b.index)
    .map((item) => item.paragraph)
    .join('\n\n')
    .slice(0, maxChars);
}

/** Split a query into comparable terms (lower case; CJK runs kept whole). */
export function queryTerms(query) {
  const value = String(query ?? '').toLowerCase();
  const terms = new Set();
  for (const word of value.match(/[a-z][a-z0-9_+#.-]{2,}/g) ?? []) terms.add(word);
  for (const run of value.match(/[\u3400-\u9fff]{2,}/g) ?? []) terms.add(run);
  return [...terms];
}

/**
 * Fraction of `query`'s terms that appear in `text`.  Used only to decide
 * whether a fetched page is about the same thing as the point it would be
 * attached to.
 */
export function topicalOverlap(query, text) {
  const terms = queryTerms(query);
  if (terms.length === 0) return 0;
  const lowered = String(text ?? '').toLowerCase();
  let hit = 0;
  for (const term of terms) if (lowered.includes(term)) hit += 1;
  return hit / terms.length;
}

/** Minimum overlap for a *fetched page* to attach to an unrelated point. */
const FETCH_OVERLAP_THRESHOLD = 0.34;

/** Stable per-point identity: chapter-qualified, because ids restart per chapter. */
export function pointKey(point) {
  const chapter = point.chapterKey ?? `Chapter_${String(point.chapterIndex ?? 0).padStart(2, '0')}`;
  return `${chapter}::${point.id}`;
}

/**
 * Build the retrieval → knowledge-point evidence mapping.
 *
 * @param {object} knowledge                    `extractKnowledge` result
 * @param {object} retrieval                    `runRetrieval` result
 * @param {object} [options]
 * @param {number} [options.excerptChars]
 * @param {number} [options.lectureChars]
 * @param {number} [options.perPoint]            max external sources per point
 * @param {number} [options.totalChars]          global budget for external excerpts
 * @param {string} [options.retrievedAt]         ISO timestamp recorded on each item
 * @returns {{byPoint: Map<string, object>, byId: Map<string, object>, sources: object[], stats: object}}
 */
export function buildEvidenceIndex(knowledge, retrieval, options = {}) {
  const limits = { ...EVIDENCE_LIMITS, ...options };
  const retrievedAt = options.retrievedAt ?? new Date().toISOString();
  const points = knowledge?.keyPoints ?? [];

  /** Search results indexed by the point id they were issued for. */
  const resultsByPointId = new Map();
  /** Fetched pages indexed by URL. */
  const fetchedByUrl = new Map();
  for (const fetch of retrieval?.fetchResults ?? []) {
    fetchedByUrl.set(fetch.url, fetch);
  }
  for (const result of retrieval?.results ?? []) {
    if (!result.pointId) continue;
    const list = resultsByPointId.get(result.pointId) ?? [];
    list.push(result);
    resultsByPointId.set(result.pointId, list);
  }

  /** URL → best title/type seen, for citation rendering. */
  const sourceCatalog = new Map();
  for (const source of retrieval?.sources ?? []) {
    sourceCatalog.set(source.url, {
      url: source.url,
      title: source.title ?? '',
      type: source.type ?? 'web',
      trust: source.trust ?? SOURCE_TRUST[source.type] ?? 1,
      index: source.index,
    });
  }

  const byPoint = new Map();
  const byId = new Map();
  let externalChars = 0;

  for (const point of points) {
    const key = pointKey(point);
    const lectureEvidence = [];
    const sourceText = normalizeWhitespace(point.sourceText ?? '');
    if (sourceText !== '') {
      lectureEvidence.push({
        kind: 'lecture',
        documentName: point.documentName ?? '',
        locator: point.locator ?? '',
        section: point.section ?? '',
        excerpt: neutralizeUntrustedText(sourceText.slice(0, limits.lectureChars)),
      });
    }

    const retrievedEvidence = [];
    const ownResults = resultsByPointId.get(point.id) ?? [];
    const queries = uniqueBy(
      ownResults.map((result) => result.query).filter(Boolean),
      (value) => value.toLowerCase(),
    );
    const topicText = `${point.title ?? ''} ${point.section ?? ''} ${sourceText.slice(0, 300)}`;

    /*
     * One entry per (kind, url).  Keying on the URL alone — as the first cut did
     * — silently dropped the *page excerpt* whenever the search provider had also
     * returned a summary for the same URL, which is precisely the case that
     * carries the derivation the model needs.  A summary, a snippet and a page
     * passage for one URL are complementary, not duplicates.
     */
    const consider = (candidate) => {
      if (retrievedEvidence.length >= limits.perPoint) return;
      if (retrievedEvidence.some((item) => item.url === candidate.url && item.kind === candidate.kind)) return;
      retrievedEvidence.push(candidate);
    };

    for (const result of ownResults) {
      // 1. The search provider's own summary answer is the densest evidence.
      if (result.answer && result.answer.length >= 80) {
        const url = result.sources?.[0]?.url ?? '';
        consider({
          kind: 'search-summary',
          url,
          title: result.sources?.[0]?.title ?? result.topic ?? '',
          excerpt: neutralizeUntrustedText(result.answer.slice(0, limits.excerptChars)),
          sourceType: result.sources?.[0]?.type ?? 'web',
          trust: SOURCE_TRUST[result.sources?.[0]?.type] ?? 1,
          query: result.query,
          reason: result.reason,
          retrievedAt,
        });
      }
      // 2. Snippets from the result list.
      for (const source of result.sources ?? []) {
        if (!source.snippet || source.snippet.length < 40) continue;
        consider({
          kind: 'snippet',
          url: source.url,
          title: source.title ?? '',
          excerpt: neutralizeUntrustedText(source.snippet.slice(0, limits.excerptChars)),
          sourceType: source.type ?? 'web',
          trust: SOURCE_TRUST[source.type] ?? 1,
          query: result.query,
          reason: result.reason,
          retrievedAt,
        });
      }
      // 3. Fetched page text, reduced to the paragraphs that answer the query.
      for (const source of result.sources ?? []) {
        const fetched = fetchedByUrl.get(source.url);
        if (!fetched?.text) continue;
        const excerpt = selectRelevantExcerpt(fetched.text, result.query, limits.excerptChars);
        if (excerpt.length < 80) continue;
        consider({
          kind: 'page',
          url: source.url,
          title: source.title ?? fetched.title ?? '',
          excerpt: neutralizeUntrustedText(excerpt),
          sourceType: source.type ?? fetched.type ?? 'web',
          trust: SOURCE_TRUST[source.type ?? fetched.type] ?? 1,
          query: result.query,
          reason: result.reason,
          retrievedAt,
        });
      }
    }

    /*
     * Fetched pages that were retrieved for a *general* query (a chapter-level
     * example search, say) are usable for this point only when the page is
     * actually about it.  Without the overlap gate a high-trust unrelated page
     * would be attached to every point, which makes the citation list look
     * complete while proving nothing.
     */
    for (const fetch of fetchedByUrl.values()) {
      if (retrievedEvidence.length >= limits.perPoint) break;
      if (!fetch.text) continue;
      if (retrievedEvidence.some((item) => item.url === fetch.url)) continue;
      const overlap = Math.max(
        ...queries.map((query) => topicalOverlap(query, fetch.text.slice(0, 4000))),
        topicalOverlap(topicText, fetch.text.slice(0, 4000)),
      );
      if (overlap < FETCH_OVERLAP_THRESHOLD) continue;
      const excerpt = selectRelevantExcerpt(fetch.text, topicText, limits.excerptChars);
      if (excerpt.length < 80) continue;
      consider({
        kind: 'page',
        url: fetch.url,
        title: fetch.title ?? '',
        excerpt: neutralizeUntrustedText(excerpt),
        sourceType: fetch.type ?? 'web',
        trust: SOURCE_TRUST[fetch.type] ?? 1,
        query: fetch.retrievReason ? `(chapter-level) ${fetch.relatedTopic ?? ''}` : '',
        reason: fetch.retrievReason ?? 'concept',
        retrievedAt,
        overlap: Number(overlap.toFixed(2)),
      });
    }

    // Attach the catalogue trust/title facts to everything we kept, so a
    // citation renders identically whether it came from a snippet or a page.
    const enriched = retrievedEvidence.map((item) => {
      const catalogue = sourceCatalog.get(item.url);
      return {
        ...item,
        title: item.title || catalogue?.title || item.url,
        sourceType: item.sourceType || catalogue?.type || 'web',
        trust: catalogue?.trust ?? item.trust,
      };
    });

    /*
     * The global character budget is spent in trust order, so a long course
     * cannot push the strongest evidence out of the model's context with a run
     * of low-value blog snippets.
     */
    const budgeted = [];
    for (const item of enriched.slice().sort((a, b) => b.trust - a.trust)) {
      if (externalChars + item.excerpt.length > limits.totalChars) {
        budgeted.push({ ...item, excerpt: '', omitted: 'budget' });
        continue;
      }
      externalChars += item.excerpt.length;
      budgeted.push(item);
    }

    const record = {
      pointId: point.id,
      chapterIndex: point.chapterIndex ?? 0,
      chapterKey: point.chapterKey ?? `Chapter_${String(point.chapterIndex ?? 0).padStart(2, '0')}`,
      topic: point.title ?? '',
      lectureEvidence,
      retrievedEvidence: budgeted,
      queries,
    };
    byPoint.set(key, record);
    byId.set(point.id, record);
  }

  // Every URL the model is allowed to cite, with the points it supports.
  const sources = uniqueBy(
    [...sourceCatalog.values()].filter((source) => typeof source.url === 'string' && source.url !== ''),
    (source) => source.url,
  ).map((source) => ({
    ...source,
    supportedPoints: [...byPoint.values()]
      .filter((record) => record.retrievedEvidence.some((item) => item.url === source.url && item.excerpt !== ''))
      .map((record) => record.pointId),
  }));

  const withEvidence = [...byPoint.values()].filter(
    (record) => record.retrievedEvidence.some((item) => item.excerpt !== ''),
  ).length;

  return {
    byPoint,
    byId,
    sources,
    stats: {
      points: points.length,
      pointsWithEvidence: withEvidence,
      pointsWithLectureOnly: points.length - withEvidence,
      externalChars,
      evidenceItems: [...byPoint.values()].reduce(
        (sum, record) => sum + record.retrievedEvidence.filter((item) => item.excerpt !== '').length,
        0,
      ),
      allowlistedUrls: sources.length,
      retrievedAt,
      limits,
    },
  };
}

/** Evidence for one point, looked up by id first and chapter-qualified key second. */
export function evidenceFor(index, point) {
  if (!index) return null;
  return index.byPoint.get(pointKey(point)) ?? index.byId.get(point.id) ?? null;
}

/**
 * Render the evidence for one point as prompt text.
 *
 * The delimiters are explicit and the provenance labels are part of the text,
 * because the model is asked to mark each claim as `[课件内容]`, `[外部资料]` or
 * `[推导说明]`.  An excerpt whose source is not named cannot be attributed.
 *
 * Excerpts are *inside* a ```text fence, so they go through
 * `neutraliseCostlyPromptText`: a page containing its own fence would otherwise
 * close ours and let web text escape into the prompt body as if it were a plugin
 * instruction.
 */
export function renderEvidenceForPrompt(record, options = {}) {
  const { includeLecture = true, maxItems = EVIDENCE_LIMITS.perPoint } = options;
  if (!record) return '(no evidence retrieved for this knowledge point)';
  const lines = [];
  if (includeLecture && record.lectureEvidence.length > 0) {
    lines.push('### 原课件原文 / Course-material excerpt (kind: lecture)');
    for (const item of record.lectureEvidence) {
      lines.push(`source: ${item.documentName} · ${item.locator}${item.section ? ` · ${item.section}` : ''}`);
      lines.push('```text');
      lines.push(neutraliseCostlyPromptText(item.excerpt));
      lines.push('```');
    }
  }
  const external = record.retrievedEvidence
    .filter((item) => item.excerpt !== '')
    .slice(0, maxItems);
  if (external.length === 0) {
    lines.push('### 外部证据 / External evidence: none retrieved for this point.');
    return lines.join('\n');
  }
  lines.push('### 外部证据 / External evidence (kind: retrieved — cite only these URLs)');
  external.forEach((item, position) => {
    lines.push(`[E${position + 1}] ${label(item.kind)} · ${item.sourceType} · trust ${item.trust}`);
    lines.push(`url: ${item.url}`);
    lines.push(`title: ${item.title}`);
    if (item.query) lines.push(`query: ${item.query}`);
    lines.push('```text');
    lines.push(neutraliseCostlyPromptText(item.excerpt));
    lines.push('```');
  });
  return lines.join('\n');
}

/**
 * Check every URL the notes cite against the URLs retrieval actually returned.
 *
 * @returns {{cited: object[], allowed: number, unknown: object[], checkable: boolean}}
 */
export function validateCitations(noteTexts, evidenceIndex) {
  const allowed = new Set((evidenceIndex?.sources ?? []).map((source) => source.url));
  const cited = [];
  for (const note of noteTexts ?? []) {
    const text = typeof note === 'string' ? note : note.text ?? '';
    for (const match of String(text).matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)) {
      cited.push({ url: match[1], note: typeof note === 'string' ? '' : note.name ?? '' });
    }
    for (const match of String(text).matchAll(/^\s*(?:[-*]|\d+\.)\s+(https?:\/\/\S+)/gm)) {
      cited.push({ url: match[1].replace(/[.,;)]+$/, ''), note: typeof note === 'string' ? '' : note.name ?? '' });
    }
  }
  const unique = uniqueBy(cited, (item) => `${item.note}::${item.url}`);
  const unknown = unique.filter((item) => !allowed.has(item.url));
  return {
    cited: unique,
    allowed: allowed.size,
    unknown,
    // A run that performed no retrieval has nothing to validate against; saying
    // "0 invalid citations" would imply a check that never happened.
    checkable: allowed.size > 0,
  };
}

export { hasCjk };
