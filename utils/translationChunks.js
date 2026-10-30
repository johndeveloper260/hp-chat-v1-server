/**
 * Translation chunking — pure helpers, no I/O.
 *
 * Long texts are split into chunks that are translated separately. Each chunk
 * carries the separator that followed it in the original (newline run or
 * whitespace), re-attached verbatim on reassembly, so
 * chunks.map((c) => c.text + c.sep).join("") === text.
 */

// Break one line into sentence-sized units, hard-splitting anything still too long.
const splitLongLine = (line, maxChars) => {
  const parts = line.split(/(?<=[.!?。！？])(\s*)/);
  const units = [];
  for (let i = 0; i < parts.length; i += 2) {
    const sep = parts[i + 1] ?? "";
    let sentence = parts[i];
    while (sentence.length > maxChars) {
      units.push({ text: sentence.slice(0, maxChars), sep: "" });
      sentence = sentence.slice(maxChars);
    }
    units.push({ text: sentence, sep });
  }
  return units;
};

export const splitForTranslation = (text, maxChars) => {
  const parts = text.split(/(\n+)/);
  const units = [];
  for (let i = 0; i < parts.length; i += 2) {
    const line = parts[i];
    const sep = parts[i + 1] ?? "";
    if (line.length <= maxChars) {
      units.push({ text: line, sep });
    } else {
      const lineUnits = splitLongLine(line, maxChars);
      lineUnits[lineUnits.length - 1].sep += sep;
      units.push(...lineUnits);
    }
  }

  const chunks = [];
  for (const unit of units) {
    const last = chunks[chunks.length - 1];
    if (last && (last.text + last.sep + unit.text).length <= maxChars) {
      last.text += last.sep + unit.text;
      last.sep = unit.sep;
    } else {
      chunks.push({ ...unit });
    }
  }
  return chunks;
};

export const mapWithConcurrency = async (items, limit, fn) => {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
};
