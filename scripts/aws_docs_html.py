#!/usr/bin/env python3
"""AWS docs HTML -> Markdown helper.

JSON in via stdin, JSON out via stdout.
Modes:
- health
- read: {mode, html}
- sections: {mode, html, section_titles}
"""

from __future__ import annotations

import json
import sys
from typing import Any

import markdownify
from bs4 import BeautifulSoup, Tag


CONTENT_SELECTORS = [
    "main",
    "article",
    "#main-content",
    ".main-content",
    "#content",
    ".content",
    "div[role='main']",
    "#awsdocs-content",
    ".awsui-article",
]

NAV_SELECTORS = [
    "noscript",
    ".prev-next",
    "#main-col-footer",
    ".awsdocs-page-utilities",
    "#quick-feedback-yes",
    "#quick-feedback-no",
    ".page-loading-indicator",
    "#tools-panel",
    ".doc-cookie-banner",
    "awsdocs-copyright",
    "awsdocs-thumb-feedback",
]

TAGS_TO_STRIP = [
    "script",
    "style",
    "noscript",
    "meta",
    "link",
    "footer",
    "nav",
    "aside",
    "header",
    "awsdocs-cookie-consent-container",
    "awsdocs-feedback-container",
    "awsdocs-page-header",
    "awsdocs-page-header-container",
    "awsdocs-filter-selector",
    "awsdocs-breadcrumb-container",
    "awsdocs-page-footer",
    "awsdocs-page-footer-container",
    "awsdocs-footer",
    "awsdocs-cookie-banner",
    "js-show-more-buttons",
    "js-show-more-text",
    "feedback-container",
    "feedback-section",
    "doc-feedback-container",
    "doc-feedback-section",
    "warning-container",
    "warning-section",
    "cookie-banner",
    "cookie-notice",
    "copyright-section",
    "legal-section",
    "terms-section",
]


def _ok(**kwargs: Any) -> None:
    payload = {"ok": True, **kwargs}
    sys.stdout.write(json.dumps(payload, ensure_ascii=False))


def _err(message: str) -> None:
    payload = {"ok": False, "error": message}
    sys.stdout.write(json.dumps(payload, ensure_ascii=False))


def normalize_space(value: str) -> str:
    return " ".join(value.strip().split())


def extract_content_from_html(html: str) -> str:
    if not html:
        return "<e>Empty HTML content</e>"

    try:
        soup = BeautifulSoup(html, "html.parser")

        main_content = None
        for selector in CONTENT_SELECTORS:
            content = soup.select_one(selector)
            if content:
                main_content = content
                break

        if not main_content:
            main_content = soup.body if soup.body else soup

        for selector in NAV_SELECTORS:
            for element in main_content.select(selector):
                element.decompose()

        content = markdownify.markdownify(
            str(main_content),
            heading_style=markdownify.ATX,
            autolinks=True,
            default_title=True,
            escape_asterisks=True,
            escape_underscores=True,
            newline_style="SPACES",
            strip=TAGS_TO_STRIP,
        )

        if not content:
            return "<e>Page failed to be simplified from HTML</e>"

        return content
    except Exception as exc:
        return f"<e>Error converting HTML to Markdown: {str(exc)}</e>"


def extract_sections_from_html(html: str, section_titles: list[str]) -> str:
    if not html or not section_titles:
        raise ValueError("No content or section titles provided")

    soup = BeautifulSoup(html, "html.parser")

    normalized_titles: dict[str, str] = {}
    for title in section_titles:
        normalized_key = normalize_space(title).lower()
        normalized_titles[normalized_key] = title.strip()

    h2_tags = soup.find_all("h2")
    available_level2_sections: list[str] = []
    matched_sections_html: list[str] = []
    found_sections: set[str] = set()

    for h2 in h2_tags:
        h2_text = h2.get_text(strip=True)
        available_level2_sections.append(h2_text)

        normalized_h2 = normalize_space(h2_text).lower()

        if normalized_h2 in normalized_titles:
            section_content = [h2]

            for sibling in h2.find_next_siblings():
                if isinstance(sibling, Tag) and sibling.name in ["h1", "h2"]:
                    break
                section_content.append(sibling)

            section_html_str = "".join(str(elem) for elem in section_content)
            matched_sections_html.append(section_html_str)
            found_sections.add(normalized_titles[normalized_h2])

    if not found_sections:
        section_list = ", ".join(f'"{title}"' for title in section_titles)
        if available_level2_sections:
            available_list = ", ".join(f'"{section}"' for section in available_level2_sections)
            raise ValueError(
                f"No matching sections were found: {section_list}. "
                f"Available sections: {available_list}. "
                "Please retry with one or more of these sections or use aws_docs_read."
            )
        raise ValueError(
            "This document does not contain subsections. Please use aws_docs_read instead."
        )

    result_html = "".join(matched_sections_html)

    if len(found_sections) < len(section_titles):
        missing_sections = [
            title.strip() for title in section_titles if title.strip() not in found_sections
        ]
        missing_list = ", ".join(f'"{title}"' for title in missing_sections)
        result_html += (
            f"\n\n<blockquote><strong>Note</strong>: "
            f"The following requested sections were not found: {missing_list}</blockquote>"
        )

    return result_html


def main() -> None:
    try:
        raw = sys.stdin.read()
        if not raw:
            _err("Missing JSON input")
            return

        data = json.loads(raw)
        mode = data.get("mode")

        if mode == "health":
            _ok(message="ok")
            return

        if mode == "read":
            html = data.get("html", "")
            markdown = extract_content_from_html(str(html))
            _ok(markdown=markdown)
            return

        if mode == "sections":
            html = str(data.get("html", ""))
            section_titles = data.get("section_titles", [])
            if not isinstance(section_titles, list) or not all(
                isinstance(title, str) for title in section_titles
            ):
                _err("section_titles must be an array of strings")
                return

            filtered_html = extract_sections_from_html(html, section_titles)
            markdown = extract_content_from_html(filtered_html)
            _ok(markdown=markdown)
            return

        _err(f"Unsupported mode: {mode}")
    except Exception as exc:
        _err(str(exc))


if __name__ == "__main__":
    main()
