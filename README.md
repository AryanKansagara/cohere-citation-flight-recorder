# Citation Flight Recorder

Cohere builds enterprise language/retrieval models and APIs with grounded responses and citations. This independent project investigates citation integrity in a consuming application; it is not affiliated with Cohere.

An executable Node ESM byte-stream recorder preserves cited spans and immutable source versions through Unicode chunking and answer edits. Structural validity and factual support remain separate fields. There is no API call, model, truth oracle, or browser renderer in this milestone.

## Run

Node 22+; no packages, keys or network required.

```sh
npm test
node demo.mjs
node demo.mjs > demo.json
```

The checked-in demo actually replays identical authored NDJSON events with byte chunks of 1, 7 and 4096. It produces the same report for all three: 2 answer versions, 4 citations, 2 structurally invalid citations, and 1 separate unsupported fixture label. The false Moon claim remains **structurally valid**. A copied citation fails after an answer edit; a missing immutable source version fails resolution. The café citation continues resolving to source v1 even though v2 also exists.

## What executes

`recorder.mjs` incrementally decodes real UTF-8 bytes with a fatal `TextDecoder`, buffers NDJSON lines, assembles content deltas, accepts early or delayed citation events, and checks final code-point spans against exact text. It hashes source and answer versions, rejects attempts to redefine them, snapshots accepted citation objects, and resolves explicit source versions. `fixtures.mjs` authors Cohere-shaped `content-delta` and `citation-start` envelopes. The source-version fields, answer-version fields, event IDs and declared code-point offset unit are **local extensions**, not assertions about Cohere's wire contract.

The fixture explicitly uses Unicode code points. It does not assume actual API indices equal JS UTF-16 indices or grapheme clusters. A live adapter would first verify API offset semantics with captured non-ASCII cases. Combining marks are preserved without Unicode normalization. Chunk boundaries do not change offsets.

## Evidence and limits

Nine tests cover 31 small chunk sizes, byte-split emoji, combining marks, multiple sources, delayed citations, immutable source conflicts, copied stale offsets, dangling versions, invalid UTF-8, truncation, unsupported units, incomplete answers and duplicate identities. An oversized multibyte event line is rejected identically whether received whole or split into smaller chunks. Tests demonstrate metadata integrity, not factual entailment. Support labels are authored fixture labels; there is no precision/recall claim without an independent labeled corpus and review process. Source hashes prove content identity within the fixture, not external authenticity or freshness. Repeated same-version source registration with identical content is idempotent.

Bounds: 2 MB wire input, 256 KiB UTF-8 per event line (excluding its newline), 10,000 events, 128 KiB answer text, 64 KiB source text, 1,000 citations per answer and 16 references per citation. The line cap applies before parsing both complete lines and accumulated partial lines. The recorder does not execute content or render HTML. An actual renderer, durable storage, live capture, redaction and support review are future work. JavaScript fits stream and UI offset handling; this project performs no inference workload that would justify C++.

## Sources and inferred gap

Official pages checked October 31, 2026:

- https://docs.cohere.com/docs/rag-citations — citation spans/text/sources and streaming citation events.
- https://docs.cohere.com/docs/tool-use-citations — citations attached to tool-source outputs.

The inferred gap is application-side preservation of citation relationships through edits and stream boundaries. Cohere already generates citations; this does not claim a missing vendor feature or confidential roadmap.
