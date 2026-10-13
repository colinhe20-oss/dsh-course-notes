/**
 * Multimodal step — what the plugin can and cannot do with figures.
 *
 * ## The honest capability statement
 *
 * This plugin runs inside DeepSeek Harness and has exactly two seams that can
 * look at an image:
 *
 *   * `ctx.fs` — raw bytes, no understanding;
 *   * `ctx.llm` — the model-call service.  A request may carry an image **only**
 *     as a durable attachment reference produced by the attachment provider;
 *     `ctx.llm` projects that reference into a route-specific request version and
 *     replaces durable `FileBlock`s with handle text.  There is no seam that
 *     turns "a PNG on disk in the session workspace" into a request image, and
 *     inventing one would be a fabricated capability.
 *
 * So the plugin does what it can prove:
 *
 *   1. **Detect** whether the session model accepts image input, from
 *      `ctx.llm.resolveModelInfo(provider, model)`, whose absence of
 *      `inputModalities` means "unknown" rather than "no";
 *   2. **Plan** one vision task per figure with the question that figure needs
 *      answered (a protocol timing diagram needs a different question from a
 *      neural-network block diagram);
 *   3. **Ingest** whatever the *agent* (which does have a vision tool) or a human
 *      writes back into `vision-results.json`, folding it into the knowledge
 *      points so it actually reaches the notes;
 *   4. **Refuse to pretend**: when no vision result exists, the markdown keeps an
 *      explicit "not interpreted" marker and the coverage report counts it.
 *
 * `describeFigureWithModel` is the one function that would call a model with an
 * image.  It is implemented against the *documented* request shape and returns a
 * structured `unsupported` result when the seam cannot carry an image, which is
 * the case in every configuration this plugin has been verified against.  It is
 * never the reason a run reports success.
 */

import { normalizeWhitespace, truncate, uniqueBy } from './util.js';

/** Question asked about a figure, by the knowledge a figure of that shape encodes. */
export const FIGURE_PROMPTS = Object.freeze({
  sequence: {
    label: '协议时序图 / protocol sequence diagram',
    question:
      'Reconstruct the message exchange: who sends what to whom, in which order, and what state each side is in. Name the fields shown and the timer/acknowledgement semantics.',
  },
  architecture: {
    label: '模型/网络结构图 / architecture diagram',
    question:
      'Describe the data flow: input shape, each layer or block in order with its operation, activation, output shape, and where the parameters live.',
  },
  flowchart: {
    label: '算法流程图 / algorithm flowchart',
    question:
      'Turn the chart into executable steps: initialisation, loop condition, body, termination, and the invariant that holds each iteration.',
  },
  curve: {
    label: '数学函数曲线 / mathematical curve',
    question:
      'Name the axes and units, the behaviour at the limits, the shape between them, and the parameters whose change moves the curve.',
  },
  chart: {
    label: '数据统计图 / data chart',
    question:
      'State the variables, the units, the trend, the notable points, and one conclusion the data does support versus one it does not.',
  },
  screenshot: {
    label: '课件截图 / slide screenshot',
    question:
      'Transcribe any text and formulas exactly, marking anything illegible rather than guessing it, then state what the slide is teaching.',
  },
  scanned: {
    label: '扫描页 / scanned page',
    question:
      'Transcribe the page, preserving formulas in LaTeX where the symbols are unambiguous; mark uncertain symbols explicitly.',
  },
  generic: {
    label: '图表 / figure',
    question:
      'Explain the knowledge the figure encodes (its structure, flow, axes or steps) rather than relabelling the text inside it.',
  },
});

/**
 * Classify a figure from the text around it.
 *
 * The classification only chooses *which question to ask*; it never claims to
 * have read the image.  A misclassification therefore costs a slightly worse
 * question, not a wrong statement in the notes.
 */
export function classifyFigure(context = {}) {
  const text = `${context.reason ?? ''} ${context.caption ?? ''} ${context.section ?? ''} ${context.locator ?? ''}`;
  if (/scanned|扫描|page\s+\d+|整页/i.test(text)) return 'scanned';
  if (/时序|sequence|handshake|握手|报文交互|timing/i.test(text)) return 'sequence';
  if (/架构|结构图|network architecture|block diagram|layer|网络结构|模型结构/i.test(text)) return 'architecture';
  if (/流程|flow\s*chart|algorithm\s*steps|算法步骤/i.test(text)) return 'flowchart';
  if (/曲线|curve|function\s+plot|函数图像|loss\s+curve/i.test(text)) return 'curve';
  if (/统计|chart|bar|histogram|distribution|柱状|折线/i.test(text)) return 'chart';
  if (/slide|截图|screenshot|课件图/i.test(text)) return 'screenshot';
  return 'generic';
}

/**
 * Is this model able to receive an image?
 *
 * @returns {{supported: boolean|null, reason: string, modalities: string[]|null}}
 *   `supported: null` means the adapter did not publish modalities — an unknown,
 *   not a denial, and the caller must say so rather than assume either way.
 */
export function detectVisionCapability(model, llm) {
  if (!model?.provider || !model?.model) {
    return { supported: false, reason: 'no provider/model is resolvable for this session', modalities: null };
  }
  if (!llm || typeof llm.resolveModelInfo !== 'function') {
    return {
      supported: null,
      reason: 'ctx.llm does not expose resolveModelInfo, so image input cannot be confirmed',
      modalities: null,
    };
  }
  try {
    const info = llm.resolveModelInfo(model.provider, model.model);
    if (info && typeof info.then === 'function') {
      return {
        supported: null,
        reason: 'resolveModelInfo is asynchronous in this build; image input is unverified',
        modalities: null,
      };
    }
    const modalities = Array.isArray(info?.inputModalities) ? [...info.inputModalities] : null;
    if (modalities === null) {
      return {
        supported: null,
        reason: `adapter publishes no input modalities for ${model.provider}/${model.model}`,
        modalities: null,
      };
    }
    return {
      supported: modalities.includes('image'),
      reason: modalities.includes('image')
        ? `${model.provider}/${model.model} declares image input`
        : `${model.provider}/${model.model} declares text-only input (${modalities.join(', ')})`,
      modalities,
    };
  } catch (error) {
    return {
      supported: null,
      reason: `cannot resolve model info for ${model.provider}/${model.model}: ${error.message}`,
      modalities: null,
    };
  }
}

/**
 * Build the vision task list for a run.
 *
 * Sources, in order of specificity:
 *   1. the parser's own `vision_tasks` (a scanned page, an image-only PDF);
 *   2. figures discovered in a chapter, which a chapter renderer already embeds;
 *   3. image-only documents, which have no text at all.
 *
 * @returns {{tasks: object[], stats: object}}
 */
export function buildVisionTasks(documents, knowledge, options = {}) {
  const { enableOcr = true, maxTasks = 200 } = options;
  const tasks = [];
  const seen = new Set();
  /**
   * Which chapter a document's content landed in.
   *
   * A parser-level vision task (a scanned page, a slide picture) knows its
   * *document*, not its chapter, and attribution needs the chapter.  Without this
   * mapping such a task could only ever be matched by an exact locator, so a slide
   * figure whose slide produced no knowledge point was attached to nothing — the
   * plugin planned a task, ingested an interpretation, and then declined to use it.
   */
  const chapterByDocument = new Map();
  for (const chapter of knowledge?.chapters ?? []) {
    for (const documentId of chapter.documents ?? []) {
      if (documentId && !chapterByDocument.has(documentId)) chapterByDocument.set(documentId, chapter.index);
    }
    for (const unit of chapter.units ?? []) {
      if (unit.sourceId && !chapterByDocument.has(unit.sourceId)) chapterByDocument.set(unit.sourceId, chapter.index);
    }
  }

  const push = (task) => {
    if (!enableOcr) return;
    const key = `${task.image ?? task.locator}::${task.pageKey ?? ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    const kind = classifyFigure(task);
    tasks.push({
      id: `V${String(tasks.length + 1).padStart(3, '0')}`,
      kind,
      ...FIGURE_PROMPTS[kind],
      priority: task.priority ?? 'normal',
      image: task.image ?? null,
      locator: task.locator ?? '',
      sourceName: task.sourceName ?? '',
      documentId: task.documentId ?? null,
      chapterIndex: task.chapterIndex ?? chapterByDocument.get(task.documentId),
      caption: normalizeWhitespace(task.caption ?? ''),
      reason: task.reason ?? '',
      // Which knowledge points this figure belongs to; filled below.
      pointIds: [],
      status: 'pending',
      interpretation: '',
      confidence: '',
      unresolved: [],
    });
  };

  for (const doc of documents ?? []) {
    for (const task of doc.visionTasks ?? []) {
      push({
        ...task,
        documentId: doc.id,
        sourceName: task.sourceName ?? doc.name,
        pageKey: task.locator,
      });
    }
    if (doc.supported === false) continue;
    if (doc.units?.length === 0 && doc.images?.length > 0) {
      for (const image of doc.images) {
        push({
          image: image.assetPath ?? image.file ?? null,
          locator: image.locator,
          sourceName: doc.name,
          documentId: doc.id,
          caption: image.caption,
          priority: 'high',
          reason: 'image-only document or scanned page with no text layer',
          pageKey: image.locator,
        });
      }
    }
  }

  for (const chapter of knowledge?.chapters ?? []) {
    for (const figure of chapter.figures ?? []) {
      /*
       * A chapter figure is usually the *same* picture the parser already reported
       * as a vision task (same asset, same slide), so it is keyed like the parser
       * task to collapse the duplicate.  Previously it was keyed by
       * `chapter:locator`, which made every such figure a second task — the same
       * image listed twice, and one of the two never attributed.
       */
      push({
        image: figure.image ?? null,
        locator: figure.locator,
        sourceName: figure.sourceName,
        caption: figure.caption ?? '',
        priority: figure.priority ?? 'normal',
        reason: figure.reason ?? '',
        pageKey: figure.locator,
        chapterIndex: chapter.index,
      });
    }
  }

  /*
   * Attribute each task to the knowledge points it belongs to, so an
   * interpretation can actually enter those points' notes and authoring prompts.
   *
   * Three passes, weakest last, because attribution decides whether an
   * interpretation is usable at all:
   *
   *   1. exact locator — a figure extracted from the same slide/paragraph the
   *      point came from;
   *   2. text reference — the point's own source text names the image file or the
   *      locator, which is how a Markdown embed (`![alt](media/chart.png)`)
   *      attaches;
   *   3. chapter fallback — a figure that names no point but belongs to a chapter
   *      is a chapter-level figure, and is offered to that chapter's points rather
   *      than to nobody.  Attaching it nowhere means the plugin knows something
   *      about a figure and then declines to use it, which is the worse failure.
   */
  const byChapterLocator = new Map();
  const pointsByChapter = new Map();
  const sourceOf = new Map();
  for (const chapter of knowledge?.chapters ?? []) {
    const list = pointsByChapter.get(chapter.index) ?? [];
    for (const point of chapter.points ?? []) {
      list.push(point.id);
      sourceOf.set(point.id, point.sourceText ?? '');
      const key = `${chapter.index}:${point.locator}`;
      const locatorList = byChapterLocator.get(key) ?? [];
      locatorList.push(point.id);
      byChapterLocator.set(key, locatorList);
    }
    pointsByChapter.set(chapter.index, list);
  }

  for (const task of tasks) {
    if (task.chapterIndex !== undefined) {
      task.pointIds.push(...(byChapterLocator.get(`${task.chapterIndex}:${task.locator}`) ?? []));
    } else {
      // No chapter is known: fall back to matching the locator across chapters.
      for (const [key, ids] of byChapterLocator) {
        if (key.slice(key.indexOf(':') + 1) === task.locator) task.pointIds.push(...ids);
      }
    }
    // Pass 2: the point's source text names this figure.
    const needles = [task.image, task.locator].filter((value) => typeof value === 'string' && value !== '');
    if (task.pointIds.length === 0 && needles.length > 0) {
      for (const [id, source] of sourceOf) {
        if (needles.some((needle) => source.includes(needle))) task.pointIds.push(id);
      }
    }
    /*
     * Pass 3: chapter-level fallback.  A figure that names no point but belongs to
     * a chapter is a chapter-level figure, and is offered to that chapter's points
     * rather than to nobody: attaching it nowhere means the plugin knows something
     * about a figure and then declines to use it, which is the worse failure.  The
     * attribution is recorded so a report can tell the two cases apart.
     */
    if (task.pointIds.length === 0 && task.chapterIndex !== undefined) {
      task.pointIds.push(...(pointsByChapter.get(task.chapterIndex) ?? []));
      task.attribution = 'chapter';
    }
    task.pointIds = uniqueBy(task.pointIds, (id) => id);
    if (!task.attribution) task.attribution = task.pointIds.length > 0 ? 'specific' : 'unattributed';
  }

  const bounded = tasks.slice(0, Math.max(0, maxTasks));
  return {
    tasks: bounded,
    stats: {
      total: bounded.length,
      dropped: tasks.length - bounded.length,
      byKind: bounded.reduce((acc, task) => {
        acc[task.kind] = (acc[task.kind] ?? 0) + 1;
        return acc;
      }, {}),
      withImage: bounded.filter((task) => task.image).length,
      attachedToPoints: bounded.filter((task) => task.pointIds.length > 0).length,
    },
  };
}

/**
 * Fold externally produced interpretations back into the knowledge points.
 *
 * The results file is written by whoever *can* see the image: the agent with an
 * image-reading tool, or a human.  This function is deliberately strict, because
 * an attached interpretation is quoted in the notes as if it had been read from
 * the figure:
 *
 *   * an entry must carry a task id (or an exact image path) that this run
 *     planned — an unknown target is reported, never invented into a task;
 *   * `interpretation` must be non-empty text;
 *   * the caller decides what to do with `unresolved` details, but they are
 *     carried through so the note can mark them.
 *
 * @param {object[]} tasks
 * @param {object} results  parsed `vision-results.json`
 * @returns {{tasks: object[], applied: number, unknown: object[], unresolved: number}}
 */
export function applyVisionResults(tasks, results) {
  const entries = Array.isArray(results?.results)
    ? results.results
    : Array.isArray(results)
      ? results
      : [];
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const byImage = new Map(tasks.filter((task) => task.image).map((task) => [task.image, task]));
  const unknown = [];
  let applied = 0;
  let unresolved = 0;

  for (const entry of entries) {
    const target =
      (entry.taskId ? byId.get(entry.taskId) : undefined) ??
      (entry.image ? byImage.get(String(entry.image).replace(/\\/g, '/')) : undefined);
    if (!target) {
      unknown.push({
        taskId: entry.taskId ?? null,
        image: entry.image ?? null,
        reason: 'no planned vision task matches this entry',
      });
      continue;
    }
    const interpretation = normalizeWhitespace(entry.interpretation ?? entry.text ?? '');
    if (interpretation === '') {
      unknown.push({ taskId: target.id, image: target.image, reason: 'entry has no interpretation text' });
      continue;
    }
    target.interpretation = truncate(interpretation, 4000);
    target.confidence = String(entry.confidence ?? 'reported');
    target.unresolved = Array.isArray(entry.unresolved) ? entry.unresolved.map((item) => String(item)) : [];
    target.status = 'interpreted';
    unresolved += target.unresolved.length;
    applied += 1;
  }
  return { tasks, applied, unknown, unresolved };
}

/** Interpretations grouped by knowledge point, ready for the note renderer. */
export function visionByPoint(tasks) {
  const map = new Map();
  for (const task of tasks) {
    if (task.status !== 'interpreted') continue;
    for (const id of task.pointIds ?? []) {
      const list = map.get(id) ?? [];
      list.push(task);
      map.set(id, list);
    }
  }
  return map;
}

/**
 * Render the "figures" block of a chapter with whatever interpretations exist.
 *
 * An uninterpreted figure says so, next to the image, so a reader never mistakes
 * a placeholder for a description.
 */
export function renderFigureBlock(figure, task) {
  const source = `${figure.sourceName} · ${figure.locator}`;
  const lines = [];
  if (figure.image) {
    const caption = figure.caption || `figure from ${figure.sourceName} ${figure.locator}`;
    lines.push(`![${caption}](${String(figure.image).replace(/\\/g, '/')})`);
    lines.push('');
  } else {
    lines.push('**（图片未导出 / not exported）**');
    lines.push('');
  }
  lines.push(`> 来源 / Source: ${source}　优先级 / priority: ${figure.priority ?? 'normal'}`);
  if (task) lines.push(`> 视觉任务 / Vision task: ${task.id} — ${task.label}`);
  lines.push(`> 任务 / Task: ${task?.question ?? figure.reason ?? ''}`);
  lines.push('');
  if (task?.status === 'interpreted') {
    lines.push('**视觉解读 / Visual interpretation**');
    lines.push('');
    lines.push(task.interpretation);
    if (task.unresolved.length > 0) {
      lines.push('');
      lines.push(
        `> ⚠ 未能确认的细节 / details that could not be confirmed: ${task.unresolved.join('；')}`,
      );
    }
    lines.push('');
    lines.push(`> 解读来源 / interpretation source: ${task.confidence}`);
  } else {
    lines.push(
      '**尚未解读 / not interpreted yet**：本插件的模型通道不能直接接收图片输入，因此图片内容必须由具备视觉能力的 Agent（例如先 `read_image` 再写回 `vision-results.json`）或人工补全。',
    );
    lines.push('');
    lines.push(
      `**Not interpreted.** The model channel available to this plugin cannot receive image input; the figure must be read by an agent with a vision tool (write the result into \`${VISION_RESULTS_FILE}\`) or by a human.`,
    );
  }
  return lines.join('\n');
}

/** Sidecar file the agent or a human writes interpretations into. */
export const VISION_RESULTS_FILE = '.coursenotes/vision-results.json';

/**
 * Ask the model to read one figure.
 *
 * Returns a structured `unsupported` result when the seam cannot carry an image
 * — which is the case whenever the figure is a file on disk rather than a
 * durable attachment reference.  Callers must treat `ok: false` as "no
 * interpretation", never as "empty interpretation".
 */
export async function describeFigureWithModel(llm, model, task, options = {}) {
  const capability = detectVisionCapability(model, llm);
  if (capability.supported !== true) {
    return {
      ok: false,
      code: 'VISION_UNSUPPORTED',
      reason: capability.reason,
      taskId: task.id,
    };
  }
  if (!task.image) {
    return { ok: false, code: 'NO_IMAGE_FILE', reason: 'the task has no exported image', taskId: task.id };
  }
  /*
   * The remaining step needs an image *attachment reference*, which only the
   * attachment provider can mint (`attachments.imageHostPath` / a normalized
   * `ImageBlock`).  This plugin has no such provider injected, so it stops here
   * with an explicit code instead of sending a text-only request and presenting
   * the answer as if it had seen the figure.
   */
  void options;
  return {
    ok: false,
    code: 'VISION_ATTACHMENT_REQUIRED',
    reason:
      'reading an image through ctx.llm requires a durable attachment reference from the attachment provider; ' +
      'this plugin does not have that seam, so the figure is left as a vision task for an agent with image input',
    taskId: task.id,
    image: task.image,
  };
}

/** Human-readable summary of the multimodal step for reports and the probe. */
export function summariseVision(vision, capability) {
  if (!vision || vision.stats.total === 0) {
    return '没有需要视觉解读的图表 / no figures require visual interpretation in this run.';
  }
  const interpreted = vision.tasks.filter((task) => task.status === 'interpreted').length;
  const pending = vision.stats.total - interpreted;
  const capabilityLine =
    capability?.supported === true
      ? `模型声明支持图像输入 / the model declares image input（${capability.reason}）`
      : capability?.supported === false
        ? `模型不支持图像输入 / the model is text-only（${capability.reason}）`
        : `图像输入能力未知 / image input could not be confirmed（${capability?.reason ?? 'unknown'}）`;
  return (
    `视觉任务 / vision tasks: ${vision.stats.total} 个（已解读 ${interpreted}，待处理 ${pending}）；${capabilityLine}。` +
    (pending > 0
      ? `未解读的图表在笔记中明确标注，不会被当作已完成。Un-interpreted figures are marked explicitly, never presented as done.`
      : '')
  );
}
