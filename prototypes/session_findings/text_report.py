"""Readable sections with actual evidence; no UI or raw JSON required."""
import difflib
import textwrap


DECISIONS = {
    "surface": "FLAG FOR REVIEW",
    "no_supported_finding": "NO SUPPORTED ISSUE",
    "insufficient_evidence": "NOT ENOUGH EVIDENCE",
}
NAMES = {
    "persistent_difficulty": "Difficulty persisted after help",
    "request_mismatch": "The response missed the student's request",
    "advice_linked_obstacle": "An obstacle followed the tutor's advice",
}


def paragraph(text, indent="", width=100):
    lines = []
    for line in str(text).splitlines() or [""]:
        lines.extend(textwrap.wrap(line, width=width, initial_indent=indent,
                                   subsequent_indent=indent, replace_whitespace=False) or [indent])
    return lines


def record_lines(record, timeline):
    rid = record["id"]
    at = record["timestamp"]
    stamp = f"{at} | {record['origin']} | {record.get('question_id') or 'question unknown'}"
    kind = record.get("role", record.get("type", "event"))
    title = kind.capitalize()
    lines = [f"  [{rid}] {title} — {stamp}"]
    if "text" in record:
        lines += paragraph(record["text"], "    ")
    elif kind == "revision":
        previous = next((r for r in timeline if r.get("type") == "revision"
                         and r.get("revision_id") == record.get("previous_revision_id")), None)
        if previous:
            difference = list(difflib.unified_diff(previous["source"].splitlines(),
                record["source"].splitlines(), lineterm="", n=2))
            if difference:
                lines.append(f"    Code change from [{previous['id']}] (- removed, + added):")
                lines.extend("      " + line for line in difference[2:])
            else:
                lines.append(f"    Source unchanged from [{previous['id']}].")
        else:
            lines.append("    Source (earlier revision unavailable):")
            lines.extend("      " + line for line in record["source"].splitlines())
    elif kind == "execution":
        source = next((r for r in timeline if r.get("type") == "revision"
                       and r.get("revision_id") == record.get("revision_id")), None)
        lines.append(f"    Execution: {record['status'].upper()}; source: "
                     + (f"[{source['id']}]" if source else "not linked"))
        if record.get("output"):
            lines += paragraph("Output: " + record["output"], "    ")
    elif kind == "check":
        execution = next((r for r in timeline if r.get("type") == "execution"
                          and r.get("execution_id") == record.get("execution_id")), None)
        lines.append(f"    {record['check_id']}: {record['result'].upper()}; execution: "
                     + (f"[{execution['id']}]" if execution else "not linked"))
        if record.get("feedback"):
            lines += paragraph("Feedback: " + record["feedback"], "    ")
    return lines


def render(payload):
    lines = ["SESSION FINDINGS", "", f"Updated: {payload['generated_at']}",
             f"Input: {payload['input_file']}", f"Analysis: {payload['assessment_source']}",
             "Evidence checks verify supplied links and facts, not whether the interpretation is correct.", ""]
    for number, result in enumerate(payload["results"], 1):
        timeline = result["evidence"]["timeline"]
        assessment = result["assessment"]
        questions = sorted({r["question_id"] for r in timeline if r.get("question_id")})
        lines += ["=" * 80, f"SESSION {number}: {result['session_id']}",
                  "Question(s): " + (", ".join(questions) or "Unknown"),
                  "Decision: " + DECISIONS[result["decision"]]]
        if result["scope"] == "hypothetical_scenario":
            lines.append("Data: Includes synthetic records. Those events did not establish real student behavior.")
        else:
            lines.append("Data: Recorded observations.")
        lines += ["", "WHY THIS DECISION", *paragraph(assessment["summary"]), ""]
        if result["validation_status"] == "rejected":
            lines += ["ASSESSMENT NOT ACCEPTED", "No model finding is accepted for this session."]
            for error in result["validation_errors"]:
                lines += paragraph(error, "  - ")
            lines.append("")
        else:
            for finding_index, finding in enumerate(assessment["findings"], 1):
                lines += [f"FINDING {finding_index}: {NAMES[finding['category']]}",
                          *paragraph(finding["explanation"]), "", "Reasoning tied to evidence:"]
                for claim in finding["interpretations"]:
                    refs = ", ".join(f"[{r}]" for r in claim["evidence_ids"])
                    lines += paragraph(f"{claim['statement']} ({refs})", "  - ")
                refs = set(finding["highlight_ids"])
                for claim in finding["interpretations"]:
                    refs.update(claim["evidence_ids"])
                for fact in finding["facts"]:
                    refs.add(fact["record_id"])
                    if fact.get("related_id"):
                        refs.add(fact["related_id"])
                recovery = set(finding["recovery_evidence_ids"])
                lines += ["", "SUPPORTING EVIDENCE (in recorded timestamp order)"]
                for record in timeline:
                    if record["id"] in refs - recovery:
                        lines += record_lines(record, timeline) + [""]
                lines.append("LATER RECOVERY / CORRECTION")
                if recovery:
                    for record in timeline:
                        if record["id"] in recovery:
                            lines += record_lines(record, timeline) + [""]
                else:
                    lines += ["  None cited. This does not prove that recovery never happened.", ""]
                lines.append("WHAT REMAINS UNCERTAIN")
                for uncertainty in finding["uncertainties"]:
                    lines += paragraph(uncertainty, "  - ")
                lines.append("")
        if not assessment.get("findings") or result["validation_status"] == "rejected":
            lines += ["SESSION CONTEXT"]
            for record in timeline:
                lines += record_lines(record, timeline) + [""]
        # Per-record origin labels already identify synthetic evidence. Keep other
        # coverage warnings, including missing links, rather than repeating long ID lists.
        notices = [n for n in result["notices"] if not n.startswith("finding ")]
        if notices:
            lines.append("DATA GAPS / CAUTIONS")
            for notice in notices:
                lines += paragraph(notice, "  - ")
            lines.append("")
        if result["validation_status"] != "rejected":
            lines += ["Evidence validation: passed structural checks. Semantic reasoning is unverified.", ""]
    return "\n".join(lines) + "\n"
