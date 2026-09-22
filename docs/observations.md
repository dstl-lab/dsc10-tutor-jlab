# Tutor requests and notebook execution records

The tutor records the work present at each streamed help request, and separately
records notebook-cell execution submissions and results. These records support
comparing changes between help requests without guessing which code produced an
output. They do not record every edit or establish what a student learned.

## Help requests

`tutor_query.payload.request` is the exact object serialized for `/ask-stream`,
including `request_id`, notebook JSON, effective question, structured context and
prompt options. It is captured synchronously before hashing, logging or network
dispatch. The original typed question remains in `payload.question`.

Every streamed request gets a distinct request ID. `tutor_response` retains that
ID and the resolved conversation ID, even when the first query had no conversation
ID. `tutor_request_failed` uses the same ID for errors and cancellation, retaining
any partial response. EOF without a completion event is a failure, not a successful
empty answer. Duplicate completion and late cancellation do not add extra outcomes.

The query contains `notebook_sha256`: SHA-256 of the exact UTF-8 bytes of
`request.notebook_json`. It is null, with a console warning, if the browser cannot
compute it. Preserve the original string when verifying the hash; reformatting JSON
changes the bytes. Native cell IDs survive sanitization. These extra IDs also reach
the existing tutor notebook context; prompt templates and code/markdown source are
unchanged. Output sanitization remains in effect.

`tutor_notebook_info` remains as a legacy completed-turn summary, with the request
ID. Its first-turn `initial_notebook_json` now comes from the request snapshot,
rather than a second notebook read after streaming. `capture_phase: "request"`
distinguishes these new records from older response-time captures. Canonical
per-request work lives in `tutor_query`, including failed requests.

Exam-mode tutor requests intentionally send `{}` as notebook context. The log
retains exactly that. Practice-problem retrieval and exam-question selection use
separate existing endpoints/events and are outside this streamed-request contract.
The unused non-streaming `askTutor` helper is also outside it.

## Execution submissions and results

The plugin observes all tracked notebook panels independently of the tutor sidebar.
`notebook_execution_requested` captures a local, non-silent kernel `execute_request`
whose native `cellId` resolves to a code cell in that notebook. It retains:

- `execution_id`: the kernel request message ID;
- `kernel_id`, `kernel_client_id`, and `notebook_session_id`;
- notebook path/name, native cell ID, and the cell index at submission;
- `source`: the exact submitted code, with `source_capture: "execute_request"`.

Submission can be queued by Jupyter; this event alone does not prove delivery or
execution. `notebook_execution_finished` requires a matching shell reply and IOPub
idle message, joined by the parent request ID on the same connection. Its source
remains the submitted source even if the editor changes during the run. Execution
count is descriptive, never the identity used for matching.

The result stores the kernel status and up to 20,000 characters of text output.
`output_complete` describes that **text transcript through completion**, not full
rich output, final rendered output, or kernel memory. HTML/image payloads are
omitted; text/plain alternatives are retained. Truncation, rich-only output,
clear/update-display messages and interruptions make completeness false. Output
arriving after completion is outside this boundary.

Connection loss, kernel replacement/restart/death, or losing the last observed
view produces an `incomplete` result. A surviving shared notebook view continues
the same observation. Abrupt page/process termination can leave a request without
a terminal event; that outcome remains unknown. Foreign-client executions, silent
requests and console/unbound requests are excluded.

Legacy `autograder_info` records now carry the execution binding and
`checked_source`. `grader_detection_method: "source_regex"` and
`verdict_method: "text_heuristic"` explicitly qualify the existing grader detector.
`success` is nullable: unrecognized/incomplete output or an unsuccessful kernel
execution is not a recognized passing grade. The bound source may be only
`grader.check("q1")`; it does **not** identify the complete answer or kernel state
that this command checked. This compatibility detector is not a generic course
grader specification.

## Joining and interpreting observations

New observation payloads carry `schema_version: 1`, the frontend package
`client_version`, and client UTC timestamps. Release/deployment provenance should
also retain the built Git commit; a package version alone does not identify local
changes. Request metadata captures live notebook/session/kernel identities where
available, with nulls for unknowns. Notebook paths can change and are not global
task IDs. Task identity/version remain explicitly unknown.

For an invented example, a student can execute `x = 1`, edit it to `x = 2`, and
ask why the output remains `1`. The execution source and later request snapshot
explain that discrepancy. Compute diffs between retained request snapshots when
needed. Do not infer intermediate edits, student intent, or a causal link between
a nearby tutor response and execution from timestamps alone.

The existing collector accepts these payload fields without a database migration.
Delivery remains **best effort**: HTTP failures and network errors are reported to
the browser console, with no persistent queue or automatic retry. A local logging
call does not prove database retention. Network delivery can reorder events; join
by identifiers rather than database row order. Deployment verification must inspect
the records actually received before using a session in a study. This change does
not repair missing historical captures.

## Verification

Run the existing Jest suite and frontend build/type checks. The authored controls
cover two different request snapshots, mutation during streaming, exact hashes,
request/response joins, cancellation before and during streaming, partial output,
EOF/server errors, malformed events, native/missing cell IDs, overlapping and
background executions, matching reply/idle boundaries, shared views, output bounds,
and interruptions. Serializing and reopening the emitted request records preserves
the work and response joins without a model call.

The existing Galata browser suite also runs `ui-tests/tests/observations.spec.ts`
against the built plugin and a real Python kernel. An invented cell prints `1`
after the editor has changed to `x = 2`; two subsequent tutor requests retain
distinct snapshots (`x = 2`, then `x = 3`) and the earlier output. Assertions cover
submitted source, native identities, hashes, request/response joins and the legacy
first-turn snapshot. Run it using `jlpm test` in `ui-tests` after building and
installing the extension as described in that directory's README. Each run attaches
`observations.json` with the intercepted request and logging bodies.

Tutor responses are scripted and collector uploads intercepted in the browser;
other nonlocal HTTP traffic is blocked, including during fixture cleanup. This
checks emitted records, not deployed database retention. No model, real student or
live course kernel is involved. No learner fidelity, learning, delivery-completeness
or historical-data claim follows from passing these controls.

The package requires Tornado `>=6.5.10`. CI follows that requirement without the
earlier temporary `<6.5.9` bound, which would conflict with the package dependency.

Reply latency has not been benchmarked. Request serialization, copying and the
notebook checksum currently precede tutor dispatch. Logging HTTP requests are not
awaited, but serialization and concurrent uploads still consume resources. Measure
request-to-first-token latency with representative notebook sizes and connections
before deployment; successful recording tests do not establish zero overhead.
