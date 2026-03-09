"""Script to crawl and ingest practice problems from practice.dsc10.com."""

from pathlib import Path
import sys

backend_dir = Path(__file__).parent.parent
sys.path.insert(0, str(backend_dir))

from practice_problems.crawler import crawl_lecture_pages
from practice_problems.normalizer import build_mapping_from_problems


def main():
    """Main ingestion script."""
    problems_by_lecture = crawl_lecture_pages(lecture_range=range(2, 26), save=True)
    
    total_problems = sum(len(probs) for probs in problems_by_lecture.values())
    print(f"Crawled {total_problems} problems from {len(problems_by_lecture)} lectures")
    
    print("Building topic mapping...")
    try:
        mapping = build_mapping_from_problems(problems_by_lecture)
        if len(mapping) > 0:
            print(f"Created topic mapping with {len(mapping)} topics")
        else:
            print("Topic mapping not created (GEMINI_API_KEY not set)")
    except Exception as e:
        print(f"Could not build mapping: {e}")
    
    print("Ingestion complete!")


if __name__ == "__main__":
    main()

