import { fixture } from './fixtures.mjs';
import { chunks, replay, wire } from './recorder.mjs';
const { sources, events, labels } = fixture();
const bytes = wire(events);
const reports = await Promise.all([1, 7, 4096].map(size => replay(chunks(bytes, size), sources, labels)));
console.log(JSON.stringify({ experiment: 'same_authored_events_different_byte_boundaries',
  wire_bytes: bytes.length, chunk_sizes: [1, 7, 4096],
  boundary_invariant: reports.every(r => JSON.stringify(r) === JSON.stringify(reports[0])), report: reports[0] }, null, 2));
