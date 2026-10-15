# Session findings prototype

A standalone Python CLI combines chat and notebook observations into a linked
timeline, obtains a structured assessment, and validates its evidence. It writes
a single plain-text report. It does not modify the extension or access a database.

## Short commands

From the repository root:

```sh
./session-findings analyze       # Analyze data.json and open report.txt
./session-findings analyze my-data.json  # Swap input files
./session-findings show          # Open the same report.txt
./session-findings demo          # Offline invented examples
./session-findings data          # Create/show an editable input file
./session-findings check         # Validate that input without sending it
```

The six sessions are **fully invented**, including messages and notebook activity.
The accompanying assessments are manually authored target examples, **not model
outputs**. Offline mode demonstrates input assembly, evidence validation and reporting;
it does not automatically discover findings. The assessments are pinned to the exact
input bytes to prevent applying stale judgments to changed evidence.

Scenarios: persistent difficulty/repeated advice; progress through different obstacles;
explicit request mismatch; a pass on another question; unchanged retries followed by
recovery; and an advice-linked obstacle followed by correction/recovery.

The launcher replaces **one file**, `local-analytics/session-findings/report.txt`,
on every completed run. Each session has small sections: decision, why, actual quoted
messages, code changes, linked execution/check results, recovery, and uncertainty.
Evidence retains its IDs, timestamps, question links, and real/synthetic origin.
On macOS it opens in your text editor. `--no-open` writes it without opening an editor.
`--json` additionally updates raw `report.json`; `--html` updates optional `report.html`.
Default runs write only the text report.
Running `./session-findings` alone also runs analyze.

## Analyze new sessions with Gemini

For a fresh checkout, install the standalone prototype dependencies with Python 3.11+:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r prototypes/session_findings/requirements.txt
```

Use `GEMINI_API_KEY` or `GOOGLE_API_KEY` in your environment for live analysis.
The default model is `gemini-3.8-flash`:

```sh
./session-findings analyze my-data.json
```

Swap data by changing the file argument. Relative paths resolve from your terminal's
current directory. Or use `./session-findings data`, edit the printed file, and run
`./session-findings analyze` without a filename. `data` never overwrites an existing
input. It starts with invented examples, not real course logs. Analyze also creates
that starter input automatically if the default file is missing.

**`analyze` sends the chosen file's entire session evidence to Gemini.** Use private
course records only with appropriate provider-transfer authorization. Demo, data,
check and show make no model calls. The launcher uses environment `GEMINI_API_KEY`
or `GOOGLE_API_KEY` first. If neither exists, it reuses the known sibling original
ChatSight file, `../chatsight/.env`, taking only the Gemini key into the process.
It does not search other secret locations, import database credentials, prompt,
display, or copy/store the key. Missing credentials preserve the existing report.
`SESSION_FINDINGS_MODEL`
or `--model` can override the automatic model, but neither is required.
Live inference uses one request per session, with no application-level retries.
SDK transport may retry independently. Failures remain insufficient evidence.

The lower-level `analyze_sessions.py` remains available for explicit output paths
and replaying other input-pinned saved assessments. It still creates JSON/text files and requires `--send` for model
calls and does not load the launcher's settings file automatically.

## Input

`sessions.json` has a `sessions` list. Each session has a unique `session_id`,
`messages`, and `activity`. All records have unique `id`, timezone-aware `timestamp`,
`origin` (`recorded` or `synthetic`), and optional `question_id`.

- Message: `role` (student/tutor), `text`.
- Revision: `type: revision`, `revision_id`, optional `previous_revision_id`, `source`.
- Execution: `type: execution`, `execution_id`, optional `revision_id`, `status`
  (success/error/unknown), optional `output`.
- Check: `type: check`, `check_id`, optional `execution_id`, `result`
  (pass/fail/unknown), optional `feedback`.

See `examples/sessions.json` for the complete input shape. There is no direct raw
database importer in this increment. Real chat plus synthetic activity must mark
each record's origin; output containing synthetic records is explicitly hypothetical.

## Analysis and evidence checks

The prompt defines persistent difficulty, request mismatch, and advice-linked
obstacles. It asks for a decision, explanations, interpretations, highlight IDs,
recovery IDs, uncertainty, and structured factual claims.

Python validates all sessions before any request. Explicit revision/execution/check
links must be temporally consistent and cannot contradict known question IDs. Missing
links remain unknown; proximity does not create links. Equal-time events have no
inferred chronology; the timeline's ID tie-breaker is display ordering only.

Assessment validation checks IDs, cited student/tutor messages, highlight coverage,
claimed event order, check outcomes and execution/revision links. It rejects omitted
later same-question passing checks when a failed check is cited, and rejects a
different-question check presented as recovery. Rejected results are downgraded to
insufficient evidence; raw rejected assessments remain available for debugging.

Semantic assertions—whether code implements advice, an obstacle is the same, or a
response misses the request—are **not proved by these checks**. Valid means structurally
and factually consistent under the supplied links, not correct or calibrated. Recovery
checks do not prove learning. This prototype has no anomaly ranking, causal attribution,
active-time estimation or validated detection accuracy.

Optional raw JSON includes the input hash, prompt hash, assessment source, evidence timeline,
links, validation errors and notices. Reports can contain private messages and source:
use ignored `local-analytics/` output and private sharing only.

## Verify

```sh
.venv/bin/python -m unittest discover -s prototypes/session_findings -p 'test_*.py' -v
```

Tests cover invented references, changed input, false check outcomes, wrong-question
recovery, omitted recovery, invalid chronology, duplicate IDs, missing links, and
create-only reports. No network or provider calls occur in tests.

## Expanded synthetic casebook

`examples/casebook_sessions.json` preserves the 11 authored October 13 scenarios
as input only. Every message, code revision, execution and check is invented.
These cover repeated advice, request mismatch, advice-associated errors,
wrong-question recovery, productive struggle, unchanged retries, diagnostic
questions and subsequent recovery. They are examples for inspection, not a
representative dataset or validated benchmark. Generated model assessments and
local casebook reports are not included.

```sh
./session-findings check prototypes/session_findings/examples/casebook_sessions.json
./session-findings analyze prototypes/session_findings/examples/casebook_sessions.json
```

`check` is offline; `analyze` sends all 11 sessions to Gemini and replaces the
local report. The default six-session `demo` continues to replay its original
input-pinned authored assessments without making model calls.
