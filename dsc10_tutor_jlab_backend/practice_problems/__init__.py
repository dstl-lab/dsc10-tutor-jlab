"""Practice problems module for DSC 10 tutor."""

from .crawler import crawl_lecture_pages, parse_lecture_page
from .normalizer import normalize_topic, load_mapping, save_mapping
from .retriever import get_practice_problems, load_problems_index
from .formatter import format_problems_response
from .ranker import rank_problems_by_relevance

__all__ = [
    "crawl_lecture_pages",
    "parse_lecture_page",
    "normalize_topic",
    "load_mapping",
    "save_mapping",
    "get_practice_problems",
    "load_problems_index",
    "format_problems_response",
    "rank_problems_by_relevance",
]

