import test from 'node:test';
import assert from 'node:assert/strict';
import { Recorder, ContractError, replay, chunks, wire } from './recorder.mjs';
import { fixture, citation } from './fixtures.mjs';

test('same Unicode answer and delayed citations across every small byte chunk size', async () => {
  const f = fixture(), bytes = wire(f.events);
  const reference = await replay([bytes], f.sources, f.labels);
  for (let size = 1; size <= 31; size++) assert.deepEqual(await replay(chunks(bytes, size), f.sources, f.labels), reference);
  const answer = reference.answers[0];
  assert.equal(answer.citations[0].structurally_valid, true);
  assert.ok(answer.utf16_units > answer.code_points);
});
test('structurally valid factual falsehood remains separate from support label', async () => {
  const f = fixture(), report = await replay([wire(f.events)], f.sources, f.labels);
  const moon = report.answers[0].citations[1];
  assert.equal(moon.structurally_valid, true);
  assert.equal(moon.semantic_support, 'unsupported');
  assert.equal(report.structurally_invalid, 2);
});
test('source update cannot silently retarget an old citation', async () => {
  const f = fixture(), report = await replay([wire(f.events)], f.sources, f.labels);
  const citation = report.answers[0].citations[0];
  assert.equal(citation.sources[0].version, 'v1');
  const recorder = new Recorder();
  recorder.addSource('a', 'v1', 'old');
  assert.throws(() => recorder.addSource('a', 'v1', 'new'), ContractError);
});
test('edits invalidate copied spans; dangling versions and unreviewed support are explicit', async () => {
  const f = fixture(), report = await replay([wire(f.events)], f.sources);
  assert.ok(report.answers[1].citations[0].structural_errors.includes('span_text_mismatch'));
  assert.ok(report.answers[1].citations[1].structural_errors.includes('dangling_source_version'));
  assert.equal(report.answers[0].citations[0].semantic_support, 'unreviewed');
});
test('multiple sources and combining characters use exact code-point text without normalization', async () => {
  const f = fixture();
  const version = 'combining', text = 'e\u0301 and 🐧';
  const events = [{ type: 'message-start', answer_version: version, offset_unit: 'unicode-code-points' },
    { type: 'content-delta', answer_version: version, delta: { message: { content: { text } } } },
    citation(version, 'multi', 0, text, [['menu', 'v1'], ['science', 'v1']]),
    { type: 'message-end', answer_version: version }];
  const report = await replay(chunks(wire(events), 1), f.sources);
  assert.equal(report.answers[0].citations[0].structurally_valid, true);
  assert.equal(report.answers[0].citations[0].sources.length, 2);
});
test('malformed UTF-8, truncated NDJSON and unsupported offset units fail closed', async () => {
  await assert.rejects(replay([Buffer.from([0xff])], []), ContractError);
  await assert.rejects(replay([Buffer.from('{')], []), ContractError);
  const f = fixture(); f.events[0].offset_unit = 'utf16';
  await assert.rejects(replay([wire(f.events)], f.sources), ContractError);
});
test('incomplete answers do not produce a valid citation verdict', async () => {
  const f = fixture();
  const report = await replay([wire(f.events.slice(0, 4))], f.sources);
  assert.ok(report.answers[0].citations[0].structural_errors.includes('answer_incomplete'));
});
test('answer revisions and citation ids cannot be overwritten', () => {
  const f = fixture(), recorder = new Recorder();
  recorder.accept(f.events[0]); recorder.accept(f.events[2]);
  assert.throws(() => recorder.accept(f.events[2]), ContractError);
  assert.throws(() => recorder.accept(f.events[0]), ContractError);
});
test('oversized complete lines reject identically across chunk boundaries using UTF-8 bytes', async () => {
  const f = fixture();
  // Character count is below the bound; multibyte UTF-8 byte count exceeds it.
  f.events[0].ignored = '界'.repeat(90000);
  const bytes = wire(f.events);
  assert.ok(bytes.length < 2_000_000);
  assert.ok(JSON.stringify(f.events[0]).length < 262144);
  assert.ok(Buffer.byteLength(JSON.stringify(f.events[0])) > 262144);
  for (const size of [bytes.length, 1024, 8192])
    await assert.rejects(replay(chunks(bytes, size), f.sources), { name: 'Error', message: 'Oversized event line' });
});
