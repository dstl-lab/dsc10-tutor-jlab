"""Adversarial evidence checks; no model, database, or network calls."""
import copy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import MagicMock, patch

import analyze_sessions as app


ROOT = Path(__file__).resolve().parent


class EvidenceTests(unittest.TestCase):
    def setUp(self):
        self.inputs = json.loads((ROOT / "examples/sessions.json").read_text())
        self.assessments = json.loads((ROOT / "examples/authored_assessments.json").read_text())["assessments"]

    def result(self, index=0, assessment=None, session=None):
        session = app.Session.model_validate(session or self.inputs["sessions"][index])
        assessment = app.Assessment.model_validate(assessment or self.assessments[index])
        return app.validate_assessment(session, app.assemble(session), assessment)

    def test_six_authored_scenarios_preserve_expected_decisions_and_origins(self):
        decisions = []
        for index in range(6):
            result = self.result(index)
            self.assertEqual(result["validation_status"], "valid", result["validation_errors"])
            self.assertEqual(result["scope"], "hypothetical_scenario")
            self.assertFalse(result["semantic_interpretations_verified"])
            decisions.append(result["decision"])
        self.assertEqual(decisions, ["surface", "no_supported_finding", "surface", "insufficient_evidence", "no_supported_finding", "surface"])

    def test_invented_evidence_rejects_finding(self):
        assessment = copy.deepcopy(self.assessments[0])
        assessment["findings"][0]["highlight_ids"].append("FAKE")
        result = self.result(assessment=assessment)
        self.assertEqual(result["decision"], "insufficient_evidence")
        self.assertTrue(any("unknown evidence" in error for error in result["validation_errors"]))

    def test_claimed_pass_for_failed_check_is_rejected(self):
        assessment = copy.deepcopy(self.assessments[0])
        fact = next(f for f in assessment["findings"][0]["facts"] if f["kind"] == "check_result")
        fact["result"] = "pass"
        self.assertEqual(self.result(assessment=assessment)["validation_status"], "rejected")

    def test_omitted_recovery_is_rejected(self):
        assessment = copy.deepcopy(self.assessments[5])
        assessment["findings"][0]["recovery_evidence_ids"] = []
        result = self.result(5, assessment=assessment)
        self.assertTrue(any("omitted later" in error for error in result["validation_errors"]))

    def test_other_question_pass_cannot_be_claimed_as_recovery(self):
        assessment = copy.deepcopy(self.assessments[0])
        assessment["session_id"] = self.inputs["sessions"][3]["session_id"]
        finding = assessment["findings"][0]
        finding["highlight_ids"] = ["M1", "M2", "M3", "C3"]
        finding["interpretations"] = [{"statement": "Difficulty persists.", "evidence_ids": ["M1", "M2", "M3"]}]
        finding["facts"] = []
        finding["recovery_evidence_ids"] = ["C2"]
        result = self.result(3, assessment=assessment)
        self.assertTrue(any("another question" in e for e in result["validation_errors"]))

    def test_cross_question_execution_link_is_invalid_input(self):
        session = copy.deepcopy(self.inputs["sessions"][0])
        next(e for e in session["activity"] if e["id"] == "E2")["question_id"] = "Q9"
        with self.assertRaisesRegex(ValueError, "cross-question"):
            app.assemble(app.Session.model_validate(session))

    def test_execution_before_revision_is_invalid_input(self):
        session = copy.deepcopy(self.inputs["sessions"][0])
        next(e for e in session["activity"] if e["id"] == "E2")["timestamp"] = "2026-10-01T11:00:00Z"
        with self.assertRaisesRegex(ValueError, "reversed"):
            app.assemble(app.Session.model_validate(session))

    def test_unlinked_checks_stay_unknown(self):
        session = copy.deepcopy(self.inputs["sessions"][0])
        next(e for e in session["activity"] if e["id"] == "C2")["execution_id"] = None
        evidence = app.assemble(app.Session.model_validate(session))
        self.assertTrue(any("C2: checked execution not linked" == w for w in evidence["warnings"]))
        self.assertFalse(any(link["to_id"] == "C2" for link in evidence["links"]))

    def test_duplicate_records_are_rejected(self):
        session = copy.deepcopy(self.inputs["sessions"][0])
        session["messages"].append(session["messages"][0])
        with self.assertRaisesRegex(ValueError, "duplicate record"):
            app.assemble(app.Session.model_validate(session))

    def test_changed_input_cannot_reuse_offline_assessment(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            changed = copy.deepcopy(self.inputs)
            changed["sessions"][0]["messages"][0]["text"] = "Different request"
            (path / "changed.json").write_text(json.dumps(changed))
            with self.assertRaisesRegex(ValueError, "different input"):
                app.main([str(path / "changed.json"), "--assessments", str(ROOT / "examples/authored_assessments.json"), "--output", str(path / "result.json")])
            self.assertFalse((path / "result.json").exists())

    def test_cli_reports_are_written_offline_and_existing_output_is_preserved(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "findings.json"
            arguments = [str(ROOT / "examples/sessions.json"), "--assessments", str(ROOT / "examples/authored_assessments.json"), "--output", str(output)]
            self.assertEqual(app.main(arguments), 0)
            saved = json.loads(output.read_text())
            self.assertIn("NOT model inference", saved["assessment_source"])
            self.assertEqual(len(saved["results"]), 6)
            original = hashlib.sha256(output.read_bytes()).hexdigest()
            with self.assertRaises(SystemExit):
                app.main(arguments)
            self.assertEqual(hashlib.sha256(output.read_bytes()).hexdigest(), original)

    def test_model_adapter_sends_linked_evidence_and_parses_structured_response(self):
        session = app.Session.model_validate(self.inputs["sessions"][0])
        evidence = app.assemble(session)
        client = MagicMock()
        client.models.generate_content.return_value.text = json.dumps(self.assessments[0])
        with patch.dict(app.os.environ, {"GEMINI_API_KEY": "invented-test-key"}), patch("google.genai.Client", return_value=client):
            assessment = app.generate(evidence, "test-model")
        call = client.models.generate_content.call_args.kwargs
        self.assertEqual(call["model"], "test-model")
        self.assertIn('"executes_revision"', call["contents"])
        self.assertIn('"origin": "synthetic"', call["contents"])
        self.assertEqual(call["config"]["response_mime_type"], "application/json")
        self.assertEqual(assessment.session_id, session.session_id)
        client.close.assert_called_once()

    def test_model_failure_is_preserved_without_echoing_provider_diagnostics(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "failed.json"
            with patch.object(app, "generate", side_effect=RuntimeError("private prompt or credential here")):
                code = app.main([str(ROOT / "examples/sessions.json"), "--model", "test-model", "--send", "--output", str(output)])
            self.assertEqual(code, 1)
            saved = output.read_text()
            self.assertNotIn("private prompt or credential here", saved)
            self.assertTrue(all(r["decision"] == "insufficient_evidence" for r in json.loads(saved)["results"]))


if __name__ == "__main__":
    unittest.main()
