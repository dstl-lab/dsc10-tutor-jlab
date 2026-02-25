"""Crawler and parser for DSC 10 practice problems from practice.dsc10.com."""

import json
import re
import time
from pathlib import Path
from typing import Dict, List, Optional
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://practice.dsc10.com"
LECTURE_PAGE_PATTERN = "/lectures/lec{}/index.html"

DATA_DIR = Path(__file__).parent.parent / "data"
PROBLEMS_FILE = DATA_DIR / "lecture_problems.json"


def fetch_page(url: str, retry_count: int = 3) -> Optional[str]:
    """Fetch HTML content from a URL with retries."""
    for attempt in range(retry_count):
        try:
            response = requests.get(url, timeout=10)
            response.raise_for_status()
            return response.text
        except requests.RequestException as e:
            if attempt < retry_count - 1:
                time.sleep(1)                                                                                                       
                continue
            print(f"Error fetching {url}: {e}")
            return None
    return None


def parse_lecture_page(html: str, lecture_num: int, base_url: str = BASE_URL) -> List[Dict]:
    """
    Parse a lecture page HTML to extract practice problems.
    
    Returns a list of problem dictionaries.
    """
    soup = BeautifulSoup(html, "html.parser")
    problems = []
    
    # Find main content area
    main_content = soup.find("main") or soup.find("article") or soup.find("body")
    if not main_content:
        return problems
    
    h2_headings = main_content.find_all("h2")
    
    problem_id = 1
    for h2 in h2_headings:
        h2_text = h2.get_text(strip=True)
        if not re.match(r"^Problem\s+\d+", h2_text, re.I):
            continue
        

        h2_anchor_id = h2.get("id")
        if not h2_anchor_id:
            match = re.match(r"^Problem\s+(\d+)", h2_text, re.I)
            if match:
                h2_anchor_id = f"problem-{match.group(1)}"
            else:
                h2_anchor_id = f"problem-{problem_id}"
        
        source = None
        prev_elem = h2.find_previous_sibling()
        while prev_elem:
            if prev_elem.name in ["p", "em", "i"]:
                text = prev_elem.get_text(strip=True)
                if text.startswith("Source:") or text.startswith("_Source:_"):
                    source = text.replace("_Source:_", "").replace("Source:", "").strip()
                    break
            prev_elem = prev_elem.find_previous_sibling()
        
        problem_content = []
        current = h2.next_sibling
        
        while current:
            if current.name == "h2":
                break
            
            if current.name in ["details", "summary"]:
                current = current.next_sibling
                continue
            
            if current.name and current.get_text(strip=True).lower().startswith("click to view"):
                current = current.next_sibling
                continue
            
            problem_content.append(current)
            current = current.next_sibling
        
        problem_text_parts = []
        choices = []
        images = []
        code_blocks = []
        

        for elem in problem_content:
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
                
                code_elements = elem.find_all(["code", "pre"])
                for code_elem in code_elements:
                    code_text = code_elem.get_text(strip=False)
                    if code_text and code_text not in code_blocks:
                        code_blocks.append(code_text.strip())
        
        for elem in problem_content:
            if elem.name is None:  
                text = str(elem).strip()
                if text:
                    problem_text_parts.append(text)
            elif elem.name in ["code", "pre"]:
                pass
            elif elem.name == "p":
                text = elem.get_text(strip=True)
                if text and not text.lower().startswith("click to view"):
                    problem_text_parts.append(text)
            elif elem.name in ["h3", "h4"]:
                text = elem.get_text(strip=True)
                if text:
                    problem_text_parts.append(f"\n{text}\n")
            elif elem.name == "ul":
                for li in elem.find_all("li"):
                    choice_text = li.get_text(strip=True)
                    if choice_text:
                        choices.append(choice_text)
            elif elem.name == "ol":
                for li in elem.find_all("li"):
                    text = li.get_text(strip=True)
                    if text:
                        if re.match(r"^[A-E][\.\)]\s*", text) or len(text) < 200:
                            choices.append(text)
                        else:
                            problem_text_parts.append(text)
        
        problem_text = "\n".join(problem_text_parts).strip()
        
        h3_headings = []
        for elem in problem_content:
            if elem.name == "h3":
                h3_text = elem.get_text(strip=True)
                if re.match(r"^Problem\s+\d+\.\d+", h3_text, re.I):
                    h3_headings.append(elem)
        
        if h3_headings:
            for h3 in h3_headings:
                h3_anchor_id = h3.get("id")
                if not h3_anchor_id:
                    h3_text = h3.get_text(strip=True)
                    match = re.match(r"^Problem\s+(\d+)\.(\d+)", h3_text, re.I)
                    if match:
                        h3_anchor_id = f"problem-{match.group(1)}-{match.group(2)}"
                    else:
                        h3_anchor_id = f"problem-{problem_id}"
                
                sub_problem_text_parts = [h3.get_text(strip=True)]
                sub_choices = []
                sub_images = []
                sub_code_blocks = []
                
                current = h3.next_sibling
                while current:
                    if current.name in ["h3", "h2"]:
                        break
                    
                    if current.name:
                        img_tags = current.find_all("img")
                        for img in img_tags:
                            img_src = img.get("src", "")
                            if img_src:
                                if img_src.startswith("/"):
                                    img_url = urljoin(base_url, img_src)
                                elif not img_src.startswith("http"):
                                    img_url = urljoin(base_url, img_src)
                                else:
                                    img_url = img_src
                                if img_url not in sub_images:
                                    sub_images.append(img_url)
                        
                        code_elements = current.find_all(["code", "pre"])
                        for code_elem in code_elements:
                            code_text = code_elem.get_text(strip=False)
                            if code_text and code_text.strip() not in sub_code_blocks:
                                sub_code_blocks.append(code_text.strip())
                    
                    if current.name == "p":
                        text = current.get_text(strip=True)
                        if text and not text.lower().startswith("click to view"):
                            sub_problem_text_parts.append(text)
                    elif current.name in ["h4", "h5", "h6"]:
                        text = current.get_text(strip=True)
                        if text:
                            sub_problem_text_parts.append(f"\n{text}\n")
                    elif current.name in ["code", "pre"]:
                        pass
                    elif current.name == "ul":
                        for li in current.find_all("li"):
                            choice_text = li.get_text(strip=True)
                            if choice_text:
                                sub_choices.append(choice_text)
                    elif current.name == "ol":
                        for li in current.find_all("li"):
                            text = li.get_text(strip=True)
                            if text:
                                if re.match(r"^[A-E][\.\)]\s*", text) or len(text) < 200:
                                    sub_choices.append(text)
                                else:
                                    sub_problem_text_parts.append(text)
                    elif current.name in ["div", "section"]:
                        text = current.get_text(strip=True)
                        if text and not text.lower().startswith("click to view"):
                            if len(text) > 20:
                                sub_problem_text_parts.append(text)
                    
                    current = current.next_sibling
                
                sub_problem_text = "\n".join(sub_problem_text_parts).strip()
                
                if sub_problem_text and len(sub_problem_text) > 20:
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
    """
    Crawl all lecture pages and extract problems.
    
    Args:
        lecture_range: Range of lecture numbers to crawl (default: 2-25)
        save: Whether to save results to file
    
    Returns:
        Dictionary mapping lecture numbers to lists of problems
    """
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
        return json.load(f)


if __name__ == "__main__":
    problems = crawl_lecture_pages()
