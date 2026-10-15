"""One-command analysis and a single self-contained browser report."""
import argparse
from datetime import datetime
import hashlib
import json
import os
from pathlib import Path
import sys
import subprocess
import tempfile
import webbrowser
from zoneinfo import ZoneInfo
from dotenv import dotenv_values

import analyze_sessions as analyzer
from html_report import render
from text_report import render as render_text

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
WORK = ROOT / "local-analytics" / "session-findings"
DATA = WORK / "data.json"
REPORT = WORK / "report.txt"
JSON_REPORT = WORK / "report.json"
HTML_REPORT = WORK / "report.html"
DEFAULT_MODEL = "gemini-3.8-flash"
CHATSIGHT_ENV = ROOT.parent / "chatsight" / ".env"


def load_input(path):
    payload = analyzer.Input.model_validate_json(path.read_bytes())
    if len({s.session_id for s in payload.sessions}) != len(payload.sessions):
        raise ValueError("duplicate session IDs")
    evidence = [analyzer.assemble(session) for session in payload.sessions]
    return payload, evidence


def private_write(path, content, *, exclusive=False):
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.is_symlink():
        raise ValueError("Refusing to write through a symbolic link.")
    if exclusive:
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "w") as stream:
            stream.write(content)
        return
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, delete=False) as stream:
            temporary = Path(stream.name)
            os.chmod(temporary, 0o600)
            stream.write(content)
        os.replace(temporary, path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def credentials():
    key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not key and CHATSIGHT_ENV.is_file():
        # Reuse the one known original-ChatSight credential file. Do not search
        # other locations, load database credentials, print, or persist its values.
        values = dotenv_values(CHATSIGHT_ENV)
        key = values.get("GEMINI_API_KEY") or values.get("GOOGLE_API_KEY")
    if not key:
        raise ValueError("No Gemini API key is available in the environment or the original ChatSight .env file. Existing report preserved; no key requested or displayed.")
    os.environ["GEMINI_API_KEY"] = key


def open_report():
    if not REPORT.exists():
        raise ValueError("No report yet. Run ./session-findings analyze or ./session-findings demo.")
    if sys.platform == "darwin":
        subprocess.run(["open", "-t", str(REPORT)], check=False)
    else:
        print(f"Open this text file in your editor: {REPORT}")


def main(argv=None):
    parser = argparse.ArgumentParser(prog="session-findings", description="Analyze sends session evidence to Gemini and replaces one readable text report. Demo is offline.")
    commands = parser.add_subparsers(dest="command")
    demo = commands.add_parser("demo", help="write/open an offline example text report")
    demo.add_argument("--no-open", action="store_true")
    demo.add_argument("--html", action="store_true", help="also update the optional HTML view")
    demo.add_argument("--json", action="store_true", help="also update raw structured results")
    commands.add_parser("data", help="create/show the editable input file")
    check = commands.add_parser("check", help="validate JSON without sending it")
    check.add_argument("file", nargs="?", type=Path, default=DATA)
    analyze = commands.add_parser("analyze", help="analyze a JSON file with Gemini and update report.txt")
    analyze.add_argument("file", nargs="?", type=Path, default=DATA)
    analyze.add_argument("--model", help="optional override; defaults to gemini-3.8-flash")
    analyze.add_argument("--no-open", action="store_true", help="write the report without opening a browser")
    analyze.add_argument("--html", action="store_true", help="also update the optional HTML view")
    analyze.add_argument("--json", action="store_true", help="also update raw structured results")
    commands.add_parser("show", help="open the same report.txt in your editor")
    args = parser.parse_args(argv)
    command = args.command or "analyze"
    if command == "data":
        if not DATA.exists():
            private_write(DATA, (HERE / "examples" / "sessions.json").read_text(), exclusive=True)
        print(DATA)
        return 0
    if command == "show":
        open_report()
        return 0
    if command == "check":
        payload, _ = load_input(args.file)
        print(f"Valid: {len(payload.sessions)} sessions. No data sent.")
        return 0
    path = HERE / "examples" / "sessions.json" if command == "demo" else getattr(args, "file", DATA)
    if path == DATA and not path.exists():
        private_write(DATA, (HERE / "examples" / "sessions.json").read_text(), exclusive=True)
        print("Created data.json with invented examples; replace it with your session data when ready.")
    raw = path.read_bytes()
    payload, evidence = load_input(path)
    if command == "demo":
        authored = json.loads((HERE / "examples" / "authored_assessments.json").read_text())
        if authored["input_sha256"] != hashlib.sha256(raw).hexdigest():
            raise ValueError("Demo input changed; existing report preserved.")
        cached = {a["session_id"]: analyzer.Assessment.model_validate(a) for a in authored["assessments"]}
        results = analyzer.assess_sessions(payload.sessions, evidence, cached=cached)
        mode = "Offline demonstration — authored findings, not model inference. All records are invented."
    else:
        credentials()
        model = getattr(args, "model", None) or os.environ.get("SESSION_FINDINGS_MODEL") or DEFAULT_MODEL
        print(f"Analyzing {len(payload.sessions)} sessions with {model}. Sending chosen session evidence to Gemini.", flush=True)
        results = analyzer.assess_sessions(payload.sessions, evidence, model=model)
        mode = f"Gemini analysis · {model}"
    report_payload = {"version": 1, "generated_at": datetime.now(ZoneInfo("America/Los_Angeles")).isoformat(),
        "input_file": str(path.resolve()), "assessment_source": mode,
        "input_sha256": hashlib.sha256(raw).hexdigest(),
        "prompt_sha256": hashlib.sha256(analyzer.PROMPT.encode()).hexdigest(), "results": results}
    private_write(REPORT, render_text(report_payload))
    if getattr(args, "json", False):
        private_write(JSON_REPORT, json.dumps(report_payload, indent=2, ensure_ascii=False) + "\n")
    if getattr(args, "html", False):
        private_write(HTML_REPORT, render(report_payload))
    print(f"Report updated: {REPORT}")
    if not getattr(args, "no_open", False):
        open_report()
    return 1 if any(r["validation_status"] == "rejected" for r in results) else 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except FileNotFoundError:
        print("Data file not found. Supply a session JSON path; existing report preserved.", file=sys.stderr)
        raise SystemExit(2)
    except ValueError as error:
        if type(error).__name__ == "ValidationError":
            print("Invalid session JSON. See the example data format; existing report preserved.", file=sys.stderr)
        else:
            print(str(error), file=sys.stderr)
        raise SystemExit(2)
