"""Self-contained, inert HTML report. No remote resources or executable session text."""
from html import escape
import json


def esc(value):
    return escape(str(value), quote=True)


def render(payload):
    results = payload["results"]
    surfaced = sum(r["decision"] == "surface" for r in results)
    rejected = sum(r["validation_status"] == "rejected" for r in results)
    menu, sections = [], []
    for index, result in enumerate(results):
        sid = esc(result["session_id"])
        decision = esc(result["decision"].replace("_", " "))
        timeline = result["evidence"]["timeline"]
        anchors = {r["id"]: f"s{index}-r{i}" for i, r in enumerate(timeline)}
        highlight = set()
        recovery = set()
        if result["validation_status"] != "rejected":
            for finding in result["assessment"]["findings"]:
                highlight.update(finding["highlight_ids"])
                recovery.update(finding["recovery_evidence_ids"])
        menu.append(f'<a href="#session-{index}"><strong>{sid}</strong><span>{decision}</span></a>')

        def references(ids):
            return " ".join(f'<a class="ref" href="#{anchors[r]}">{esc(r)}</a>' if r in anchors else f'<span class="ref">{esc(r)} (missing)</span>' for r in ids)

        finding_html = []
        if result["validation_status"] == "rejected":
            finding_html.append('<div class="warning"><strong>Assessment rejected</strong><p>No model finding is accepted for this session.</p></div>')
        else:
            for finding in result["assessment"]["findings"]:
                interpretations = ''.join(f'<li>{esc(c["statement"])}<div>{references(c["evidence_ids"])}</div></li>' for c in finding["interpretations"])
                uncertainties = ''.join(f'<li>{esc(u)}</li>' for u in finding["uncertainties"])
                finding_html.append(f'<div class="finding"><h3>{esc(finding["category"].replace("_", " "))}</h3><p>{esc(finding["explanation"])}</p><div><b>Highlight</b> {references(finding["highlight_ids"])}</div><div><b>Recovery</b> {references(finding["recovery_evidence_ids"]) or "None cited"}</div><details><summary>Interpretations and uncertainty</summary><ul>{interpretations}</ul><h4>Uncertainty</h4><ul>{uncertainties}</ul></details></div>')
        events = []
        for record in timeline:
            rid = record["id"]
            classes = "event" + (" highlighted" if rid in highlight else "") + (" recovered" if rid in recovery else "")
            kind = record.get("role", record.get("type", "event"))
            body = ''
            if "text" in record:
                body = f'<div class="message">{esc(record["text"])}</div>'
            elif record.get("type") == "revision":
                body = f'<p>Revision {esc(record["revision_id"])} · previous: {esc(record.get("previous_revision_id") or "unknown")}</p><pre>{esc(record["source"])}</pre>'
            elif record.get("type") == "execution":
                body = f'<p><b>{esc(record["status"])}</b> · source revision: {esc(record.get("revision_id") or "unknown")}</p><pre>{esc(record.get("output") or "No output supplied")}</pre>'
            elif record.get("type") == "check":
                body = f'<p><b>{esc(record["result"])}</b> · {esc(record["check_id"])} · execution: {esc(record.get("execution_id") or "unknown")}</p><div class="message">{esc(record.get("feedback") or "No feedback supplied")}</div>'
            badges = ('<span class="badge">Highlighted</span>' if rid in highlight else '') + ('<span class="badge green">Recovery evidence</span>' if rid in recovery else '')
            events.append(f'<article id="{anchors[rid]}" class="{classes}"><header><strong>{esc(kind.upper())} · {esc(rid)}</strong>{badges}<span class="origin">{esc(record["origin"])}</span></header><div class="meta">{esc(record["timestamp"])} · question: {esc(record.get("question_id") or "unknown")}</div>{body}</article>')
        notices = ''.join(f'<li>{esc(note)}</li>' for note in result["notices"])
        errors = ''.join(f'<li>{esc(error)}</li>' for error in result["validation_errors"])
        sections.append(f'<section id="session-{index}"><div class="session-title"><h2>{sid}</h2><span class="badge">{decision}</span></div><p class="meta">{esc(result["scope"].replace("_", " "))} · validation: {esc(result["validation_status"])}</p><p>{esc(result["assessment"]["summary"])}</p>{"".join(finding_html)}<details><summary>Evidence coverage and validation</summary><ul>{errors}{notices}</ul><p>Semantic interpretations have not been independently verified.</p></details><h3>Session timeline</h3>{"".join(events)}</section>')
    debug = esc(json.dumps(payload, indent=2, ensure_ascii=False))
    return f'''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>Session findings</title><style>
:root{{font-family:system-ui,sans-serif;color:#203132;background:#f4f7f7;line-height:1.5}}*{{box-sizing:border-box}}body{{margin:0}}a{{color:#126965}}.top{{background:#fff;padding:28px 36px;border-bottom:1px solid #dce5e5}}h1{{margin:0 0 8px;font-size:30px}}.meta{{color:#657578;font-size:13px}}.stats{{display:flex;gap:30px;margin-top:20px}}.stats strong{{font-size:24px;display:block}}.layout{{display:grid;grid-template-columns:270px minmax(0,1fr);gap:24px;max-width:1300px;margin:auto;padding:24px}}nav{{align-self:start;position:sticky;top:18px;background:#fff;border:1px solid #dce5e5;border-radius:12px;overflow:hidden}}nav a{{display:block;text-decoration:none;padding:16px;border-bottom:1px solid #edf0f0}}nav span{{display:block;font-size:12px;color:#657578}}section{{background:#fff;border:1px solid #dce5e5;border-radius:12px;padding:26px;margin-bottom:24px;scroll-margin-top:20px}}.session-title{{display:flex;align-items:center;gap:14px;flex-wrap:wrap}}h2{{margin:0;font-size:23px}}h3{{font-size:17px}}.badge,.origin{{font-size:11px;background:#eef4f3;border:1px solid #d5e4e1;border-radius:5px;padding:3px 7px}}.origin{{margin-left:auto}}.finding{{border-left:4px solid #187b75;background:#f1f8f7;padding:16px 20px;margin:18px 0}}.finding h3{{margin:0}}.ref{{display:inline-block;font-size:12px;padding:3px 7px;margin:3px;border:1px solid #c6d9d6;border-radius:5px;text-decoration:none}}details{{margin:16px 0}}summary{{cursor:pointer;font-weight:600}}.event{{border:1px solid #dce5e5;border-radius:9px;padding:18px;margin:14px 0;scroll-margin-top:20px}}.event header{{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:13px}}.highlighted{{border-left:5px solid #187b75;background:#f6fbfa}}.recovered{{border-left:5px solid #4c8553}}.green{{background:#edf7ee}}.message,pre{{white-space:pre-wrap;overflow-wrap:anywhere}}pre{{background:#f3f5f5;padding:12px;overflow:auto;font-size:12px}}.warning{{padding:16px;background:#fff4e5;border:1px solid #e9c998}}.raw{{max-width:1250px;margin:0 auto 30px;padding:0 24px}}.raw pre{{max-height:500px}}@media(max-width:800px){{.layout{{grid-template-columns:1fr;padding:14px}}nav{{position:static}}.top{{padding:22px}}section{{padding:18px}}}}
</style></head><body><div class="top"><h1>Session findings</h1><div class="meta">Updated {esc(payload['generated_at'])} · input: {esc(payload['input_file'])}</div><p>{esc(payload['assessment_source'])}</p><div class="warning">Review candidates, not verified tutor-quality judgments. Synthetic activity remains hypothetical; missing data remains unknown.</div><div class="stats"><div><strong>{len(results)}</strong>Sessions</div><div><strong>{surfaced}</strong>Surfaced</div><div><strong>{rejected}</strong>Rejected assessments</div></div></div><div class="layout"><nav>{''.join(menu)}</nav><main>{''.join(sections)}</main></div><details class="raw"><summary>Complete structured results (JSON)</summary><pre>{debug}</pre></details></body></html>'''
