"""Crawler and parser for DSC 10 practice problems from practice.dsc10.com."""

import json
import re
import time
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup
from bs4.element import NavigableString

BASE_URL = "https://practice.dsc10.com"
LECTURE_PAGE_PATTERN = "/lectures/lec{}/index.html"
EXAMS_INDEX_URL = f"{BASE_URL}/"

DATA_DIR = Path(__file__).parent.parent / "data"
PROBLEMS_FILE = DATA_DIR / "lecture_problems.json"
EXAM_PROBLEMS_FILE = DATA_DIR / "exam_problems.json"


def fetch_page(url: str, retry_count: int = 3) -> Optional[str]:
    """Fetch HTML content from a URL with retries."""
    for attempt in range(retry_count):
        try:
            response = requests.get(url, timeout=10)
            response.raise_for_status()
            if response.encoding is None or response.encoding.lower() == "iso-8859-1":
                response.encoding = response.apparent_encoding or "utf-8"
            return response.text
        except requests.RequestException as e:
            if attempt < retry_count - 1:
                time.sleep(1)                                                                                                       
                continue
            print(f"Error fetching {url}: {e}")
            return None
    return None


def collect_images(elem, base_url: str, existing_images: List[str]) -> List[str]:
    """Collect image URLs from an element."""
    images = existing_images.copy()
    if elem.name:
        img_tags = elem.find_all("img")
        for img in img_tags:
            img_src = img.get("src", "")
            if img_src:
                if img_src.startswith("/"):
                    img_url = urljoin(base_url, img_src)
                elif not img_src.startswith("http"):
                    img_url = urljoin(base_url, img_src)
                else:
                    img_url = img_src
                if img_url not in images:
                    images.append(img_url)
    return images


def collect_code_blocks(elem, existing_code: List[str]) -> List[str]:
    """Collect code blocks from an element."""
    code_blocks = existing_code.copy()
    if elem.name:
        code_elements = elem.find_all(["code", "pre"])
        for code_elem in code_elements:
            code_text = code_elem.get_text(strip=False)
            if code_text:
                code_stripped = code_text.strip()
                if code_stripped and code_stripped not in code_blocks:
                    code_blocks.append(code_stripped)
    return code_blocks


def _normalize_markdown_spacing(text: str) -> str:
    """Normalize spacing while preserving intentional newlines."""
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r" *\n *", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _render_markdown_text(elem) -> str:
    """Render selected HTML content to simple markdown text."""
    if isinstance(elem, NavigableString):
        return str(elem)

    if not getattr(elem, "name", None):
        return ""

    tag = elem.name.lower()

    if tag == "br":
        return "\n"

    if tag == "code":
        if getattr(elem.parent, "name", "") == "pre":
            return ""
        code_text = elem.get_text(" ", strip=True)
        return f"`{code_text}`" if code_text else ""

    if tag == "pre":
        code_text = elem.get_text("\n", strip=False).strip("\n")
        if not code_text:
            return ""
        return f"```\n{code_text}\n```"

    parts = [_render_markdown_text(child) for child in elem.children]
    return _normalize_markdown_spacing("".join(parts))


def extract_text_and_choices(elem, problem_text_parts: List[str], choices: List[str]) -> Tuple[List[str], List[str]]:
    """Extract text and choices from an element."""
    new_text_parts = problem_text_parts.copy()
    new_choices = choices.copy()
    
    if elem.name is None:
        text = _normalize_markdown_spacing(str(elem))
        if text:
            new_text_parts.append(text)
    elif elem.name in ["code", "pre"]:
        text = _render_markdown_text(elem)
        if text:
            new_text_parts.append(text)
    elif elem.name == "p":
        text = _render_markdown_text(elem)
        if text and not text.lower().startswith("click to view"):
            new_text_parts.append(text)
    elif elem.name in ["h3", "h4", "h5", "h6"]:
        text = _normalize_markdown_spacing(elem.get_text(" ", strip=True))
        if text:
            new_text_parts.append(f"### {text}")
    elif elem.name == "ul":
        for li in elem.find_all("li"):
            choice_text = _normalize_markdown_spacing(li.get_text(" ", strip=True))
            if choice_text:
                new_choices.append(choice_text)
    elif elem.name == "ol":
        for li in elem.find_all("li"):
            text = _normalize_markdown_spacing(li.get_text(" ", strip=True))
            if text:
                if re.match(r"^[A-E][\.\)]\s*", text) or len(text) < 200:
                    new_choices.append(text)
                else:
                    new_text_parts.append(text)
    elif elem.name in ["div", "section"]:
        text = _render_markdown_text(elem)
        if text and not text.lower().startswith("click to view"):
            if len(text) > 20:
                new_text_parts.append(text)
    
    return new_text_parts, new_choices


def process_problem_content(
    problem_content: List,
    base_url: str,
    initial_text: str = ""
) -> Tuple[str, List[str], List[str], List[str]]:
    """
    Process problem content to extract text, choices, images, and code blocks.
    """
    problem_text_parts = [initial_text] if initial_text else []
    choices = []
    images = []
    code_blocks = []
    
    for elem in problem_content:
        images = collect_images(elem, base_url, images)
        code_blocks = collect_code_blocks(elem, code_blocks)
        problem_text_parts, choices = extract_text_and_choices(elem, problem_text_parts, choices)
    
    problem_text = "\n".join(problem_text_parts).strip()
    return problem_text, choices, images, code_blocks


def _clean_solution_text(solution_text: str) -> str:
    """Normalize scraped solution text for storage in JSON."""
    text = re.sub(r"\s+", " ", solution_text).strip()
    text = re.sub(r"\s*Difficulty:\s*.*$", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\s*The average score on this problem was.*$", "", text, flags=re.IGNORECASE)
    return text.strip()


def extract_solution_text_from_heading(start_elem, stop_tags: List[str]) -> str:
    """Extract solution text from the accordion that follows an exam problem heading."""
    current = start_elem.next_sibling

    while current:
        current_name = getattr(current, "name", None)
        if current_name in stop_tags:
            heading_text = current.get_text(strip=True)
            if re.match(r"^Problem\s+\d+(?:\.\d+)?", heading_text, re.I):
                break

        if current_name:
            accordion_body = current.select_one("div.accordion-body")
            if accordion_body is not None:
                solution_text = accordion_body.get_text("\n", strip=True)
                if solution_text:
                    return _clean_solution_text(solution_text)

        current = current.next_sibling

    return ""


def parse_problem_section(
    start_elem,
    base_url: str,
    stop_tags: List[str],
    anchor_id_pattern: Optional[re.Pattern] = None,
    fallback_anchor_id: Optional[str] = None
) -> Dict:
    """
    Parse a problem section starting from a heading element (h2 or h3).
    
    Args:
        start_elem: The starting heading element (h2 or h3)
        base_url: Base URL for resolving relative image URLs
        stop_tags: List of tag names that indicate the end of this section
        anchor_id_pattern: Optional regex pattern to extract anchor_id from heading text
        fallback_anchor_id: Optional fallback anchor_id if extraction fails
    
    Returns:
        Dictionary with keys: text, choices, images, code_blocks, anchor_id, content
    """
    heading_text = start_elem.get_text(strip=True)
    
    anchor_id = start_elem.get("id")
    if not anchor_id:
        if anchor_id_pattern:
            match = anchor_id_pattern.match(heading_text)
            if match:
                if len(match.groups()) == 2:
                    anchor_id = f"problem-{match.group(1)}-{match.group(2)}"
                else:
                    anchor_id = f"problem-{match.group(1)}"
        if not anchor_id and fallback_anchor_id:
            anchor_id = fallback_anchor_id
    
    # Collect content from siblings
    problem_content = []
    current = start_elem.next_sibling
    
    while current:
        if current.name in stop_tags:
            break
        
        if current.name in ["details", "summary"]:
            current = current.next_sibling
            continue
        
        if current.name and current.get_text(strip=True).lower().startswith("click to view"):
            current = current.next_sibling
            continue
        
        problem_content.append(current)
        current = current.next_sibling
    
    # Process the content
    problem_text, choices, images, code_blocks = process_problem_content(
        problem_content, base_url, initial_text=heading_text
    )
    
    return {
        "text": problem_text,
        "choices": choices,
        "images": images,
        "code_blocks": code_blocks,
        "anchor_id": anchor_id,
        "content": problem_content,
    }


def parse_lecture_page(html: str, lecture_num: int, base_url: str = BASE_URL) -> List[Dict]:
    soup = BeautifulSoup(html, "html.parser")
    problems = []
    
    main_content = soup.find("main") or soup.find("article") or soup.find("body")
    if not main_content:
        return problems
    
    h2_headings = main_content.find_all("h2")
    
    problem_id = 1
    for h2 in h2_headings:
        h2_text = h2.get_text(strip=True)
        if not re.match(r"^Problem\s+\d+", h2_text, re.I):
            continue
        
        source = None
        prev_elem = h2.find_previous_sibling()
        while prev_elem:
            if prev_elem.name in ["p", "em", "i"]:
                text = prev_elem.get_text(strip=True)
                if text.startswith("Source:") or text.startswith("_Source:_"):
                    source = text.replace("_Source:_", "").replace("Source:", "").strip()
                    break
            prev_elem = prev_elem.find_previous_sibling()
        
        h2_pattern = re.compile(r"^Problem\s+(\d+)", re.I)
        h2_section = parse_problem_section(
            h2,
            base_url,
            stop_tags=["h2"],
            anchor_id_pattern=h2_pattern,
            fallback_anchor_id=f"problem-{problem_id}"
        )
        
        problem_text = h2_section["text"]
        choices = h2_section["choices"]
        images = h2_section["images"]
        code_blocks = h2_section["code_blocks"]
        h2_anchor_id = h2_section["anchor_id"]
        problem_content = h2_section["content"]
        
        h3_headings = []
        for elem in problem_content:
            if elem.name == "h3":
                h3_text = elem.get_text(strip=True)
                if re.match(r"^Problem\s+\d+\.\d+", h3_text, re.I):
                    h3_headings.append(elem)
        
        if h3_headings:
            for h3 in h3_headings:
                h3_pattern = re.compile(r"^Problem\s+(\d+)\.(\d+)", re.I)
                h3_section = parse_problem_section(
                    h3,
                    base_url,
                    stop_tags=["h3", "h2"],
                    anchor_id_pattern=h3_pattern,
                    fallback_anchor_id=f"problem-{problem_id}"
                )
                
                sub_problem_text = h3_section["text"]
                if sub_problem_text and len(sub_problem_text) > 20:
                    sub_choices = h3_section["choices"]
                    sub_images = h3_section["images"]
                    sub_code_blocks = h3_section["code_blocks"]
                    h3_anchor_id = h3_section["anchor_id"]
                    
                    final_images = sub_images if sub_images else images.copy()
                    final_code = sub_code_blocks if sub_code_blocks else code_blocks.copy()
                    
                    problem = {
                        "id": f"lecture_{lecture_num}_prob_{problem_id}",
                        "lecture_number": lecture_num,
                        "text": sub_problem_text[:2000],
                        "choices": sub_choices if sub_choices else choices,
                        "images": final_images,
                        "code": final_code,
                        "source": source,
                        "source_url": f"{base_url}/lectures/lec{lecture_num}/index.html#{h3_anchor_id}",
                        "anchor_id": h3_anchor_id,
                    }
                    problems.append(problem)
                    problem_id += 1
        else:
            if problem_text and len(problem_text) > 20:
                problem = {
                    "id": f"lecture_{lecture_num}_prob_{problem_id}",
                    "lecture_number": lecture_num,
                    "text": problem_text[:2000],
                    "choices": choices,
                    "images": images,
                    "code": code_blocks,
                    "source": source,
                    "source_url": f"{base_url}/lectures/lec{lecture_num}/index.html#{h2_anchor_id}",
                    "anchor_id": h2_anchor_id,
                }
                problems.append(problem)
                problem_id += 1
    
    return problems


def crawl_lecture_pages(lecture_range: range = range(2, 26), save: bool = True) -> Dict[int, List[Dict]]:
    all_problems = {}
        
    for lecture_num in lecture_range:
        url = f"{BASE_URL}/lectures/lec{lecture_num}/index.html"
        
        html = fetch_page(url)
        if html:
            problems = parse_lecture_page(html, lecture_num)
            if problems:
                all_problems[lecture_num] = problems
            else:
                print(f"  No problems found")
        else:
            print(f"  Failed to fetch")
        
        time.sleep(0.5)
    
    if save:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        with open(PROBLEMS_FILE, "w", encoding="utf-8") as f:
            json.dump(all_problems, f, indent=2, ensure_ascii=False)
    
    return all_problems


def load_problems() -> Dict[int, List[Dict]]:
    """Load problems from saved file."""
    if not PROBLEMS_FILE.exists():
        return {}
    
    with open(PROBLEMS_FILE, "r", encoding="utf-8") as f:
        problems = json.load(f)
        return {int(k): v for k, v in problems.items()}


def get_exam_type(url: str) -> str:
    """Return 'midterm', 'final', or 'exam' based on the URL."""
    url_lower = url.lower()
    if "final" in url_lower:
        return "final"
    if "midterm" in url_lower:
        return "midterm"
    return "exam"


def parse_exam_page(html: str, page_url: str, exam_name: str, exam_type: str) -> List[Dict]:
    """Parse an exam page and return a list of problem dicts."""
    soup = BeautifulSoup(html, "html.parser")
    problems = []

    main_content = soup.find("main") or soup.find("article") or soup.find("body")
    if not main_content:
        return problems

    h2_headings = main_content.find_all("h2")
    problem_id = 1

    for h2 in h2_headings:
        h2_text = h2.get_text(strip=True)
        if not re.match(r"^Problem\s+\d+", h2_text, re.I):
            continue

        h2_pattern = re.compile(r"^Problem\s+(\d+)", re.I)
        h2_section = parse_problem_section(
            h2,
            page_url,
            stop_tags=["h2"],
            anchor_id_pattern=h2_pattern,
            fallback_anchor_id=f"problem-{problem_id}",
        )

        # Check for sub-problems (h3 with "Problem N.M")
        h3_headings = [
            elem for elem in h2_section["content"]
            if elem.name == "h3" and re.match(r"^Problem\s+\d+\.\d+", elem.get_text(strip=True), re.I)
        ]

        if h3_headings:
            for h3 in h3_headings:
                h3_pattern = re.compile(r"^Problem\s+(\d+)\.(\d+)", re.I)
                h3_section = parse_problem_section(
                    h3,
                    page_url,
                    stop_tags=["h3", "h2"],
                    anchor_id_pattern=h3_pattern,
                    fallback_anchor_id=f"problem-{problem_id}",
                )
                sub_text = h3_section["text"]
                if sub_text and len(sub_text) > 20:
                    anchor_id = h3_section["anchor_id"]
                    source_url = f"{page_url}#{anchor_id}" if anchor_id else page_url
                    answer = extract_solution_text_from_heading(h3, ["h3", "h2"])
                    problems.append({
                        "id": f"{exam_name}_prob_{problem_id}",
                        "exam_name": exam_name,
                        "exam_type": exam_type,
                        "text": sub_text[:2000],
                        "answer": answer,
                        "choices": h3_section["choices"] or h2_section["choices"],
                        "images": h3_section["images"] or h2_section["images"].copy(),
                        "code": h3_section["code_blocks"] or h2_section["code_blocks"].copy(),
                        "source": exam_name,
                        "source_url": source_url,
                        "anchor_id": anchor_id,
                    })
                    problem_id += 1
        else:
            problem_text = h2_section["text"]
            if problem_text and len(problem_text) > 20:
                anchor_id = h2_section["anchor_id"]
                source_url = f"{page_url}#{anchor_id}" if anchor_id else page_url
                answer = extract_solution_text_from_heading(h2, ["h2"])
                problems.append({
                    "id": f"{exam_name}_prob_{problem_id}",
                    "exam_name": exam_name,
                    "exam_type": exam_type,
                    "text": problem_text[:2000],
                    "answer": answer,
                    "choices": h2_section["choices"],
                    "images": h2_section["images"],
                    "code": h2_section["code_blocks"],
                    "source": exam_name,
                    "source_url": source_url,
                    "anchor_id": anchor_id,
                })
                problem_id += 1

    return problems


def crawl_exam_pages(save: bool = True) -> List[Dict]:
    """Crawl midterm and final exam pages from practice.dsc10.com.

    Fetches the /exams/ index page to discover individual exam URLs, then
    parses each exam page for problems.  Results are saved to exam_problems.json.
    """
    index_html = fetch_page(EXAMS_INDEX_URL)
    exam_urls: List[str] = []

    if index_html:
        soup = BeautifulSoup(index_html, "html.parser")
        for a_tag in soup.find_all("a", href=True):
            href: str = a_tag["href"]
            if not re.search(r"(midterm|final)", href, re.I):
                continue
            if href.startswith("/"):
                full_url = urljoin(BASE_URL, href)
            elif href.startswith("http"):
                full_url = href
            else:
                full_url = urljoin(EXAMS_INDEX_URL, href)
            # Keep only links on the same site and avoid duplicates
            if full_url.startswith(BASE_URL) and full_url not in exam_urls:
                exam_urls.append(full_url)

    all_problems: List[Dict] = []
    for exam_url in exam_urls:
        html = fetch_page(exam_url)
        if not html:
            print(f"  Failed to fetch {exam_url}")
            continue

        # Derive a short exam name from the URL, e.g. "fa23-midterm1"
        path_part = exam_url.rstrip("/")
        if path_part.endswith("/index.html"):
            exam_name = path_part[len(BASE_URL):].split("/")[-2]
        else:
            exam_name = path_part.split("/")[-1]

        exam_type = get_exam_type(exam_url)
        problems = parse_exam_page(html, exam_url, exam_name, exam_type)
        print(f"  {exam_name}: {len(problems)} problems")
        all_problems.extend(problems)
        time.sleep(0.5)

    if save and all_problems:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        with open(EXAM_PROBLEMS_FILE, "w", encoding="utf-8") as f:
            json.dump(all_problems, f, indent=2, ensure_ascii=False)

    return all_problems


if __name__ == "__main__":
    problems = crawl_lecture_pages()
