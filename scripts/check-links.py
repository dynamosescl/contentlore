#!/usr/bin/env python3
"""Simple internal-link checker for static HTML files.

- Scans href/src in *.html.
- Ignores external links and anchors.
- Allows known dynamic route prefixes for Cloudflare Functions.
"""

from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
HTML_FILES = list(ROOT.rglob("*.html"))

ALLOW_EXACT = {
    "/people", "/people/",
    "/discover", "/discover/",
    "/claim",
    "/admin",
}
ALLOW_PREFIXES = (
    "/api/",
    "/creator/",
)

ATTR_RE = re.compile(r"(?:href|src)=['\"]([^'\"]*)['\"]")


def is_ignored(url: str) -> bool:
    return url.startswith(("http://", "https://", "mailto:", "tel:", "#", "data:", "javascript:"))


def split_url(url: str) -> str:
    return url.split('#', 1)[0].split('?', 1)[0]


def to_site_path(source_file: Path, url: str) -> str:
    clean = split_url(url)
    if clean.startswith('/'):
        return clean
    rel = (source_file.parent / clean).resolve().relative_to(ROOT.resolve())
    return '/' + str(rel).replace('\\', '/')


def resolve_target(source_file: Path, url: str) -> Path:
    site_path = to_site_path(source_file, url)
    return ROOT / site_path.lstrip('/')


def exists_as_route(target: Path) -> bool:
    if target.exists():
        return True
    if (target / "index.html").exists():
        return True
    alt = Path(str(target).rstrip("/") + "/index.html")
    return alt.exists()


def main() -> int:
    missing = []
    empty_attrs = set()

    for html_file in HTML_FILES:
        text = html_file.read_text(encoding="utf-8", errors="ignore")
        for m in ATTR_RE.finditer(text):
            raw_url = m.group(1)
            url = raw_url.strip()
            if not url:
                empty_attrs.add(html_file.relative_to(ROOT))
                continue
            if is_ignored(url):
                continue
            site_path = to_site_path(html_file, url)
            if site_path in ALLOW_EXACT or any(site_path.startswith(p) for p in ALLOW_PREFIXES):
                continue

            target = resolve_target(html_file, url)
            if not exists_as_route(target):
                missing.append((html_file.relative_to(ROOT), url))

    if empty_attrs:
        print(f"Empty href/src attributes: {len(empty_attrs)}")
        for file_path in sorted(empty_attrs):
            print(f"- {file_path} -> empty link attribute")
        return 1

    if missing:
        print(f"Missing internal targets: {len(missing)}")
        for file_path, url in missing:
            print(f"- {file_path} -> {url}")
        return 1

    print("All internal links resolved.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
