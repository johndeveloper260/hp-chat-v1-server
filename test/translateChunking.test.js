/**
 * Long-text translation chunking (announcements).
 *
 * Long texts are split into chunks that are translated separately; the
 * separators between chunks must survive so reassembly keeps the layout.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { splitForTranslation, extractLines } from "../utils/translationChunks.js";

const rebuild = (chunks) => chunks.map((c) => c.text + c.sep).join("");

test("short text stays a single chunk", () => {
  const chunks = splitForTranslation("Hello\nWorld", 1000);
  assert.equal(chunks.length, 1);
  assert.equal(rebuild(chunks), "Hello\nWorld");
});

test("long multi-paragraph text splits on line breaks and reassembles exactly", () => {
  const para = "This is a sentence about the company event. ".repeat(10).trim();
  const text = `\n\n${Array.from({ length: 12 }, () => para).join("\n\n")}\n- item one\n- item two\n`;
  const chunks = splitForTranslation(text, 1000);
  assert.ok(chunks.length > 1);
  assert.equal(rebuild(chunks), text);
  for (const c of chunks) assert.ok(c.text.length <= 1000);
});

test("a single overlong line splits on sentence boundaries", () => {
  const text = "Short sentence here. ".repeat(200).trim();
  const chunks = splitForTranslation(text, 300);
  assert.ok(chunks.length > 1);
  assert.equal(rebuild(chunks), text);
  for (const c of chunks) {
    assert.ok(c.text.length <= 300);
    assert.ok(c.text.endsWith("."));
  }
});

test("Japanese text without spaces splits on 。 and reassembles exactly", () => {
  const text = "本日は会社のイベントについてお知らせします。".repeat(100);
  const chunks = splitForTranslation(text, 500);
  assert.ok(chunks.length > 1);
  assert.equal(rebuild(chunks), text);
  for (const c of chunks) assert.ok(c.text.length <= 500);
});

test("text with no break points is hard-split", () => {
  const text = "x".repeat(2500);
  const chunks = splitForTranslation(text, 1000);
  assert.deepEqual(chunks.map((c) => c.text.length), [1000, 1000, 500]);
  assert.equal(rebuild(chunks), text);
});

test("extractLines keeps blank lines and line endings when rebuilding", () => {
  const text = "\n日時：11月5日\r\n場所：本社\n\n  \n詳細は後日\nお知らせします。";
  const { lines, rebuild } = extractLines(text);
  assert.deepEqual(lines, ["日時：11月5日", "場所：本社", "詳細は後日", "お知らせします。"]);
  assert.equal(rebuild(lines), text);
  assert.equal(
    rebuild(["Date: Nov 5", "Place: HQ", "Details will be", "announced later."]),
    "\nDate: Nov 5\r\nPlace: HQ\n\n  \nDetails will be\nannounced later.",
  );
});

test("extractLines keeps the original line when a translation comes back empty", () => {
  const { rebuild } = extractLines("a\nb");
  assert.equal(rebuild(["A", ""]), "A\nb");
});
