# CourseNotes

**Turn lecture slides, PDFs and Word handouts into structured bilingual study notes — inside DeepSeek Harness.**

CourseNotes is a native [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) Cordis plugin. Point it at a folder of course material and an output directory, and it runs a seven-stage pipeline: scan → parse → extract knowledge points → retrieve supporting sources → generate notes → check coverage → write files. Every knowledge point stays traceable to the page, slide or paragraph it came from.

It is deliberately **not** a summariser. The design principles are:

1. **Completeness first** — no chapter is dropped to save space; the outline, knowledge points, formulas and figures are all accounted for.
2. **Teaching depth** — every core point gets a substantive explanation, not a re-arranged slide.
3. **Bilingual by keyword** — Chinese prose with English terms glossed inline (`基本可行集（basic feasible set）`) plus a term table per chapter. No duplicated full-length English translation.
4. **Nothing is invented** — unreadable figures, unavailable retrieval and failed files are reported explicitly, never faked.

---

## Table of contents

- [Features](#features)
- [Requirements](#requirements)
- [Installation](#installation)
- [Usage](#usage)
- [Tools reference](#tools-reference)
- [How the pipeline works](#how-the-pipeline-works)
- [Configuration](#configuration)
- [Offline CLI](#offline-cli)
- [Notes on coverage](#notes-on-coverage)
- [Known limitations](#known-limitations)
- [Development](#development)
- [License](#license)

---

## Features

| Capability | Detail |
| --- | --- |
| **Multi-format parsing** | `.pdf` `.pptx` `.docx` `.md` `.markdown` `.txt` `.rst` `.tex` `.csv` `.json` `.html` `.ipynb` `.srt` `.vtt`, and images `.png` `.jpg` `.jpeg` `.webp` `.gif` `.bmp` `.tif` |
| **Structural extraction** | Heading hierarchy, paragraphs, lists, tables, formula candidates, images, speaker notes, Word inline pictures, scanned-PDF detection |
| **Source tracing** | Every knowledge point carries a locator (`page 12`, `slide 4`, `paragraph 8`, `line 30`) |
| **Knowledge organisation** | Chapters → sections → knowledge points; same-titled chapters across files are merged; prerequisite references detected |
| **Term tables** | Recognises `中文名称（English Full Name, ABBR）`, `English (中文)` and `English (ABBR)` |
| **Web retrieval** | Uses the Harness `ctx.web` service; sources are graded (official / university / paper / community) and only trustworthy ones are fetched |
| **Coverage checking** | Compares extracted knowledge points against what the notes actually say, and reports covered / partial / missing |
| **Failures are visible** | Unparsable files, unreadable figures, unavailable retrieval and denied writes all appear in the run report |
| **Bilingual keyword glosses** | Inline `中文（English term）` plus per-chapter term tables |

## Requirements

- **DeepSeek Harness** (the plugin is a Host plugin; it registers agent tools).
- **A Python interpreter with `pymupdf`, `python-pptx`, `python-docx` and `Pillow`** for PDF / PPTX / DOCX / image parsing.

> **Good news:** DSH ships its own Python runtime with all four libraries already installed. CourseNotes finds it automatically — including when the Host process has no `DSH_HOME` environment variable set (which is the normal case).
>
> If you use a different Python, set `pythonPath` in the plugin config, or the `COURSE_NOTES_PYTHON` / `DSH_PYTHON` / `PYTHON` environment variable. Run `probe_course_notes` to see exactly what was probed and why.
>
> Markdown, plain text, HTML, CSV, LaTeX and notebooks need **no Python at all** — the plugin parses those natively.

## Installation

### 1. Install the bundle

Use the Harness Plugin Manager with the absolute path to this directory:

```
plugin_manager { action: "install_bundle", target: "<absolute path>/course-notes" }
```

This adds the package to your profile and inserts the plugin row into the Cordis tree. It applies to every session in that profile.

### 2. Restart DeepSeek Harness

Node caches ES modules by URL, so **a running Host process cannot pick up a freshly installed plugin module**. Restart the app once; after that the four tools are live.

### 3. Verify

Call `probe_course_notes`. It reports the resolved Python backend (with the full discovery trail), which Harness services are available (`tools`, `web`, `llm`, `fs`), the effective configuration, and whether a given input path is parseable.

## Usage

### Let the agent drive (recommended)

> Turn `D:\courses\networking` into notes and write them to `D:\notes\networking`

The agent calls:

```jsonc
generate_course_notes({
  "input_paths": ["D:\\courses\\networking"],  // files, folders, or a mix
  "output_dir": "D:\\notes\\networking",
  "language": "bilingual",
  "detail_level": "comprehensive",
  "enable_web_search": true,
  "split_by_chapter": true,
  "coverage_check": true
})
```

It receives a **note-writing brief**: the outline, every knowledge point with its source excerpt, the term table, formula candidates, figures to interpret, retrieval evidence, and an explicit list of positions to fill. The agent writes the prose; `check_notes_coverage` then verifies nothing was skipped.

### Produce finished notes in one call

```jsonc
generate_course_notes({
  "input_paths": ["D:\\courses\\networking"],
  "output_dir": "D:\\notes\\networking",
  "author_with_llm": true   // the plugin writes the prose itself, chapter by chapter
})
```

With `author_with_llm: true` the plugin calls `ctx.llm` once **per chapter**, so a long course never depends on one oversized completion, and re-runs the coverage check afterwards.

### Output layout

```
<output_dir>/
├── README.md                    course index + glossary + coverage summary
├── Chapter_01_<title>.md        one file per chapter (or a single file if split_by_chapter=false)
├── coverage-report.md           coverage + Markdown structure check
├── run-report.md / run-report.json   processing report, including known limitations
├── knowledge.json               full knowledge-point list (machine readable)
├── assets/                      figures extracted from the material
└── .coursenotes/<run-id>/       note-brief.md, documents.json, retrieval.json, …
```

## Tools reference

| Tool | Purpose |
| --- | --- |
| `generate_course_notes` | Run the pipeline (supports `stages`, `author_with_llm`, per-run overrides) |
| `check_notes_coverage` | Compare `knowledge.json` with the note text; report covered / partial / missing plus Markdown structure problems |
| `probe_course_notes` | Environment diagnostics: Python backend, `ctx.web`, `ctx.llm`, session default model, effective config, input parseability |
| `read_course_notes_report` | Read a previous run's `run-report.md`, `coverage-report.md`, `knowledge.json` or `note-brief.md` |

### `generate_course_notes` parameters

| Parameter | Type | Default | Meaning |
| --- | --- | --- | --- |
| `input_paths` | string[] | **required** | Files, folders or a mix. Absolute Windows paths are fine; relative paths resolve against the session cwd. Folders are scanned recursively, skipping `node_modules`, `.git`, `__pycache__`, `.venv`, `dist`, `build` and `~$…` temp files |
| `output_dir` | string | `<cwd>/course-notes-output` | Where notes are written |
| `course_name` | string | inferred | Override the detected course name |
| `language` | `bilingual` \| `zh` \| `en` | `bilingual` | Output language |
| `detail_level` | `concise` \| `standard` \| `comprehensive` | `comprehensive` | How deep the explanations go |
| `enable_web_search` | boolean | `true` | Use `ctx.web` for supplementary material |
| `enable_ocr` | boolean | `true` | Keep image-only content as vision tasks for a multimodal model |
| `include_examples` | boolean | `true` | Generate "Examples" sections and example-seeking queries |
| `include_exercises` | boolean | `true` | Generate self-assessment and misconception sections |
| `split_by_chapter` | boolean | `true` | One file per chapter, or a single combined file |
| `coverage_check` | boolean | `true` | Run the coverage check at the end |
| `file_order` | `natural` \| `name` \| `explicit` \| `mtime` | `natural` | Discovery order (`lecture2` before `lecture10`) |
| `explicit_order` | string[] | `[]` | File names in order, for `file_order: "explicit"` |
| `stages` | string[] | all | `scan` `parse` `knowledge` `retrieve` `generate` `check` `output` |
| `max_searches` / `max_fetches` | integer | 12 / 8 | Retrieval budget |
| `brief_char_budget` | integer | 60000 | Size of the returned brief |
| `author_with_llm` | boolean | `false` | Author the prose with `ctx.llm`, one chapter at a time |

## How the pipeline works

```
Stage A  scan       classify files, check readability, order them, report legacy/unsupported formats
Stage B  parse      text/headings/lists/tables/formulas/figures + source locators -> one document model
Stage C  knowledge  rebuild chapters and sections -> knowledge points -> term table -> formulas -> dependencies
Stage D  retrieve   prioritised queries (formula derivations > term definitions > fact checks > background > examples)
Stage E  generate   per-chapter Markdown + the machine-readable brief the writing stage consumes
Stage F  check      knowledge-point coverage + Markdown structure (fences, formulas, relative links, placeholders)
Stage G  output     note files, README, knowledge.json, run report, coverage report, assets
```

Intermediate artefacts live in `<output_dir>/.coursenotes/<run-id>/`, so any stage can be inspected or re-run.

**Design decision worth knowing:** the deterministic stages (parse, split, term table, coverage baseline) never call an LLM, so *completeness* does not depend on the model behaving. The writing stage only handles *depth*. That is why a long deck can never silently lose its later chapters.

## Configuration

Edit your profile's `cordis.patch.yml` (a higher-priority layer than the bundle patch, so it survives upgrades):

```yaml
- id: course-notes
  name: course-notes
  config:
    outputDir: ''            # empty = <session cwd>/course-notes-output
    workDir: ''              # empty = <outputDir>/.coursenotes
    language: bilingual
    detailLevel: comprehensive
    enableWebSearch: true
    maxSearches: 12
    maxFetches: 8
    enableOcr: true
    includeExamples: true
    includeExercises: true
    splitByChapter: true
    coverageCheck: true
    fileOrder: natural
    maxUnitChars: 4000
    briefCharBudget: 60000
    maxFileBytes: 209715200  # 200 MiB per input file
    pythonPath: ''           # empty = auto-detect
    extraSearchKeywords: []
    chapterHeadingLevel: 1
    logLevel: info           # silent | error | warn | info | debug
```

Tool-call arguments override these; unset fields fall back to the values above.

## Offline CLI

The same pipeline runs without a Harness host — useful for CI, batch jobs, or trying the parser out:

```powershell
node cli.js "D:\courses\networking" --out D:\notes\networking
node cli.js --probe                                  # environment self-check
node cli.js "D:\courses" --out out --json run.json    # also dump a machine-readable report
node cli.js "D:\courses" --out out --language zh --detail concise --single-file
node cli.js "D:\courses" --out out --order explicit --input ch2.pdf --input ch1.pdf
```

Offline mode has no `ctx.web`; to exercise retrieval anyway, point `--web-endpoint` at an HTTP endpoint that answers `{op:"search", query}` / `{op:"fetch", url}`.

## Notes on coverage

Coverage answers one question: **is every extracted knowledge point actually written up in the notes?** It is an internal completeness indicator and says nothing about whether the explanations are correct.

Two details make the number meaningful:

- The source excerpts embedded in the notes as evidence sit inside code fences and are **excluded** from the measurement — otherwise every point would look "covered" merely because its own text was copied in.
- The report separates **structural completeness** (does every point have its own section?) from **content completeness** (has the prose actually been written?). A freshly generated skeleton is therefore honestly reported as `structure 100% / content 0%`, and the placeholders that remain are counted.

Because a note that has not been authored yet scores zero, a low number is a to-do list, not a failure.

## Known limitations

1. **Legacy Office formats need converting.** `.ppt` / `.doc` / `.wps` / `.dps` / `.pages` / `.key` / `.odt` / `.odp` cannot be parsed; the plugin lists them with a conversion hint instead of skipping them silently.
2. **Figures need a vision model.** The plugin extracts, locates and queues each figure as a vision task with context. Reading what the figure *means* is the writing stage's job; if the model has no vision capability, the position is explicitly marked rather than filled with guesses.
3. **Scanned PDFs** are detected, rendered page-by-page as images and reported with a `page-without-text-layer` warning — their content depends entirely on vision.
4. **Formula detection is heuristic.** Mathematical fonts and symbol density mark candidates; complex typesetting can be missed. The PDF text layer of some decks also mangles maths glyphs (`∈` arriving as replacement characters), in which case formulas must be read from the rendered page images — `tests/export_pdf_pages.py` exists for exactly that.
5. **Knowledge-point splitting is structural.** It works well for prose decks (Word handouts, Chinese slides). A formula-heavy English deck can fragment badly; when the point count is implausibly high relative to the page count, build the baseline by hand and read the pages directly.
6. **Coverage uses lexical overlap**, so a faithful paraphrase can be scored as "partially covered" — a deliberately conservative estimate. Formula matching is notation-aware and cannot confirm a formula whose canonical form is almost entirely single-letter symbols.
7. **Retrieval depends on a registered web provider.** Without one, the run says so in both the report and the notes; it never produces citations that do not exist.
8. **Writes obey the session sandbox.** A denied output directory is relocated into the session workspace *and reported*, never swapped silently.
9. **`stages` is validated but the current implementation runs the full pipeline in fixed order.**

## Development

```powershell
cd course-notes
python tests/make_fixtures.py      # generate the PPTX/DOCX/PNG/MD/TXT fixtures
node tests/run-tests.mjs           # unit + end-to-end suite
node tests/plugin-contract.test.mjs  # tool schema / render / argument-validation contract
node tests/discovery.test.mjs      # interpreter discovery with no DSH_* env vars
```

The test suite covers configuration normalisation, format routing and natural ordering, Markdown/HTML/CSV parsing, terminology extraction (including negative cases), chapter assembly (flat decks, cross-file merging), multiple-choice option merging, retrieval planning and degradation, untrusted-input neutralisation, coverage positives and negatives including cross-chapter id collisions, asset-link resolution, end-to-end multi-format parsing, and "one broken file must not lose the others".

### Layout

```
course-notes/
├── index.js                      plugin entry: the four tool definitions and registration
├── cli.js                        offline CLI over the same pipeline
├── cordis.patch.yml              bundle patch (inserts the plugin row)
├── lib/
│   ├── config.js                 defaults, coercion, argument overrides
│   ├── scan.js                   stage A: discovery and format classification
│   ├── python-bridge.js          interpreter discovery and invocation
│   ├── parse/course_notes_parser.py   PDF/PPTX/DOCX/images -> structured JSON
│   ├── parsers.js                Markdown/text/HTML/CSV/notebook/LaTeX/subtitles
│   ├── document.js               unified document model
│   ├── cleanup.js                multiple-choice option merging
│   ├── knowledge.js              stage C: chapters, points, term table
│   ├── retrieve.js               stage D: query planning and source grading
│   ├── generate.js               stage E: Markdown and the writing brief
│   ├── coverage.js               stage F: coverage and structure checks
│   ├── files.js                  workspace abstraction (`ctx.fs` or `node:fs`)
│   ├── pipeline.js               orchestration and the run report
│   └── util.js                   logging, paths, hashing, text normalisation
├── tests/
└── docs/
```

See [`docs/architecture.md`](docs/architecture.md) for the data model and the reasoning behind the two-stage design, and [`docs/usage.md`](docs/usage.md) for a detailed parameter guide.

## License

[MIT](LICENSE).
