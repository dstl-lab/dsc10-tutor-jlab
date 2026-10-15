"""Stable report replacement, escaping, and preflight; no live model calls."""
from html.parser import HTMLParser
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import analyze_sessions as analyzer
import run


class Links(HTMLParser):
    def __init__(self):
        super().__init__()
        self.ids, self.targets = set(), set()

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if "id" in attrs:
            self.ids.add(attrs["id"])
        if attrs.get("href", "").startswith("#"):
            self.targets.add(attrs["href"][1:])


class LauncherTests(unittest.TestCase):
    def test_credentials_use_environment_only_without_file_access(self):
        with patch.dict(run.os.environ, {"GEMINI_API_KEY": "invented-key"}, clear=True), patch.object(run, "dotenv_values", side_effect=AssertionError("unnecessary secret file read")):
            run.credentials()
            self.assertEqual(run.os.environ["GEMINI_API_KEY"], "invented-key")

    def test_missing_credentials_fail_without_prompting_or_searching(self):
        with patch.dict(run.os.environ, {}, clear=True), patch.object(Path, "is_file", return_value=False), patch.object(run, "dotenv_values", side_effect=AssertionError("unexpected file read")):
            with self.assertRaisesRegex(ValueError, "No Gemini API key"):
                run.credentials()

    def test_credentials_reuse_known_chatsight_file_without_importing_database_password(self):
        with patch.dict(run.os.environ, {}, clear=True), patch.object(Path, "is_file", return_value=True), patch.object(run, "dotenv_values", return_value={"GEMINI_API_KEY": "invented-key", "PG_PASSWORD": "invented-db-password"}) as loader:
            run.credentials()
            loader.assert_called_once_with(run.CHATSIGHT_ENV)
            self.assertEqual(run.os.environ["GEMINI_API_KEY"], "invented-key")
            self.assertNotIn("PG_PASSWORD", run.os.environ)

    def test_demo_replaces_one_text_file_with_readable_evidence(self):
        with tempfile.TemporaryDirectory() as directory:
            report = Path(directory) / "report.txt"
            with patch.object(run, "REPORT", report):
                self.assertEqual(run.main(["demo", "--no-open"]), 0)
                report.write_text("old content")
                self.assertEqual(run.main(["demo", "--no-open"]), 0)
            self.assertEqual(list(Path(directory).iterdir()), [report])
            text = report.read_text()
            self.assertIn("authored findings, not model inference", text)
            self.assertNotEqual(text, "old content")
            self.assertEqual(text.count("Question(s):"), 6)
            self.assertIn("WHY THIS DECISION", text)
            self.assertIn("SUPPORTING EVIDENCE", text)
            self.assertIn("I changed it to >=", text)
            self.assertIn("Q1.result: FAIL; execution: [E2]", text)
            self.assertIn("WHAT REMAINS UNCERTAIN", text)
            self.assertTrue(text.endswith("\n"))

    def test_analyze_uses_default_model_and_writes_report_not_terminal_findings(self):
        source = run.HERE / "examples" / "sessions.json"
        authored = json.loads((run.HERE / "examples" / "authored_assessments.json").read_text())["assessments"]
        cache = {item["session_id"]: analyzer.Assessment.model_validate(item) for item in authored}
        with tempfile.TemporaryDirectory() as directory:
            report = Path(directory) / "report.txt"
            with patch.object(run, "REPORT", report), patch.object(run, "credentials"), patch.dict(run.os.environ, {"SESSION_FINDINGS_MODEL": ""}), patch.object(analyzer, "generate", side_effect=lambda evidence, model: cache[evidence["session_id"]]) as model:
                self.assertEqual(run.main(["analyze", str(source), "--no-open"]), 0)
                self.assertEqual(model.call_count, 6)
                self.assertTrue(all(c.args[1] == "gemini-3.8-flash" for c in model.call_args_list))
            self.assertIn("Gemini analysis", report.read_text())
            self.assertEqual(list(Path(directory).iterdir()), [report])

    def test_invalid_input_does_not_send_or_replace_previous_report(self):
        with tempfile.TemporaryDirectory() as directory:
            source, report = Path(directory) / "bad.json", Path(directory) / "report.html"
            source.write_text('{"sessions": []}')
            report.write_text("previous report")
            with patch.object(run, "REPORT", report), patch.object(run, "credentials") as credentials:
                with self.assertRaises(ValueError):
                    run.main(["analyze", str(source), "--no-open"])
                credentials.assert_not_called()
            self.assertEqual(report.read_text(), "previous report")

    def test_html_treats_message_markup_as_text(self):
        source = run.HERE / "examples" / "sessions.json"
        payload, evidence = run.load_input(source)
        evidence[0]["timeline"][0]["source"] = '<script>alert("injected")</script>'
        authored = json.loads((run.HERE / "examples" / "authored_assessments.json").read_text())["assessments"]
        cache = {item["session_id"]: analyzer.Assessment.model_validate(item) for item in authored}
        results = analyzer.assess_sessions(payload.sessions, evidence, cached=cache)
        text = run.render({"results": results, "generated_at": "test", "input_file": "test", "assessment_source": "offline"})
        self.assertNotIn("<script>", text)
        self.assertIn("&lt;script&gt;", text)
        self.assertIn("default-src 'none'", text)


if __name__ == "__main__":
    unittest.main()
