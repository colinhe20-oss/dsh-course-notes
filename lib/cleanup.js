/**
 * Post-parse clean-up of extracted content units.
 *
 * The parsers are deliberately literal: they report the document as it is.  For
 * study notes, however, some document shapes must be regrouped or the knowledge
 * structure is meaningless.  The important case is multiple-choice material
 * (homework, quiz banks, some slide decks):
 *
 *   1. (10 points) What is the name of PDU at the network layer?
 *   A. message
 *   B. frame
 *   C. packet
 *   D. segment
 *
 * Read literally this is five knowledge points, four of which are answer
 * options.  Merged, it is one knowledge point whose material evidence contains
 * the stem and its options — which is what a note needs.
 *
 * The transformation only ever merges; it never invents or reorders content,
 * and it keeps every locator so traceability is unaffected.
 */

/** A short answer option: "A.", "b)", "（C）", "D、". */
const OPTION_RE = /^\s*[（(]?\s*([A-Ha-h])\s*[)）.、:：]\s*\S/;

/** Continuation markers found inside multi-line options ("E. none of the above"). */
export function isOptionText(text) {
  const value = String(text ?? '').trim();
  if (value === '' || value.length > 400) return false;
  return OPTION_RE.test(value);
}

function unitText(unit) {
  return String(unit.text ?? '').trim();
}

function mergeInto(target, option) {
  const parts = [unitText(target)];
  if (target.rows) {
    // Never mix a table with text; a table is its own knowledge point.
    return target;
  }
  parts.push(unitText(option));
  target.text = parts.join('\n');
  if (!Array.isArray(target.extraLocators)) target.extraLocators = [];
  if (option.locator && option.locator !== target.locator) {
    target.extraLocators.push(option.locator);
  }
  target.mergedOptionCount = (target.mergedOptionCount ?? 0) + 1;
  return target;
}

/**
 * Merge runs of consecutive option units into the preceding content unit.
 *
 * @param {object[]} units  normalised content units (mutated copies are returned)
 * @returns {{units: object[], mergedOptions: number, mergedGroups: number}}
 */
export function mergeOptionUnits(units) {
  const out = [];
  let pendingOptions = [];
  let mergedOptions = 0;
  let mergedGroups = 0;

  const flush = () => {
    if (pendingOptions.length === 0) return;
    const previous = out[out.length - 1];
    // Options only make sense attached to a stem.  With no stem (or a table
    // stem) they are kept as-is rather than being attached to something wrong.
    if (previous && previous.kind === 'text' && !previous.rows) {
      for (const option of pendingOptions) mergeInto(previous, option);
      mergedOptions += pendingOptions.length;
      mergedGroups += 1;
    } else {
      out.push(...pendingOptions);
    }
    pendingOptions = [];
  };

  for (const unit of units) {
    if (isOptionText(unitText(unit)) && unit.kind === 'text') {
      pendingOptions.push({ ...unit });
      continue;
    }
    flush();
    out.push({ ...unit });
  }
  flush();

  return { units: out, mergedOptions, mergedGroups };
}

/**
 * Collect the locators of a unit, including merged option locators, so the note
 * can cite every page/slide a knowledge point came from.
 */
export function unitLocators(unit) {
  const locators = [];
  if (unit.locator) locators.push(unit.locator);
  for (const extra of unit.extraLocators ?? []) {
    if (!locators.includes(extra)) locators.push(extra);
  }
  return locators;
}
