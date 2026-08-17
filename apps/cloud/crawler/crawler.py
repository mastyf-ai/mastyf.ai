#!/usr/bin/env python3
"""
Package scoring crawler — scrapes npm, GitHub, and community signals
for packages in the database and writes JSON files for the Node.js scorer.

Usage:
    python crawler.py --batch-size 50
    python crawler.py --package @modelcontextprotocol/server-filesystem
    python crawler.py --list packages.txt
"""
import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(__file__))

import psycopg2
from config import DATABASE_URL, DATA_DIR, CRAWL_FRESHNESS_HOURS, DEFAULT_BATCH_SIZE
from scrapers.npm_page import scrape_npm_page
from scrapers.github_repo import scrape_github_repo
from scrapers.community import scrape_community
from scrapers.security import scrape_security_context


def get_packages_to_crawl(batch_size: int, force: bool = False) -> list[dict]:
    """Query database for packages that need crawling."""
    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor()

    if force:
        cur.execute("""
            SELECT package_name, MAX(computed_at) as computed_at
            FROM package_score_cache
            GROUP BY package_name
            ORDER BY computed_at DESC
            LIMIT %s
        """, (batch_size,))
    else:
        cur.execute("""
            SELECT package_name, MAX(computed_at) as computed_at
            FROM package_score_cache
            WHERE last_crawled_at IS NULL
               OR last_crawled_at < NOW() - INTERVAL '%s hours'
            GROUP BY package_name
            ORDER BY computed_at DESC
            LIMIT %s
        """, (CRAWL_FRESHNESS_HOURS, batch_size))

    packages = [{"name": row[0]} for row in cur.fetchall()]
    cur.close()
    conn.close()
    return packages


def get_package_repo_url(package_name: str) -> str | None:
    """Get repository URL from npm metadata (cached in DB or fresh fetch)."""
    import requests
    try:
        encoded = package_name.replace("/", "%2f")
        res = requests.get(
            f"https://registry.npmjs.org/{encoded}",
            timeout=10,
        )
        if res.status_code == 200:
            doc = res.json()
            repo = doc.get("repository", {})
            if isinstance(repo, dict):
                return repo.get("url", "")
            elif isinstance(repo, str):
                return repo
    except Exception:
        pass
    return None


def get_cve_ids(package_name: str) -> list[str]:
    """Get CVE IDs for a package from the database (already enriched)."""
    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor()
    cur.execute("""
        SELECT score_report->'categories'
        FROM package_score_cache
        WHERE package_name = %s
        ORDER BY computed_at DESC
        LIMIT 1
    """, (package_name,))
    row = cur.fetchone()
    cur.close()
    conn.close()

    if not row or not row[0]:
        return []

    # Extract CVE IDs from findings
    cve_ids = []
    try:
        report = row[0] if isinstance(row[0], dict) else json.loads(row[0])
        for cat in report:
            findings = cat.get("findings", [])
            for f in findings:
                if isinstance(f, str) and f.startswith("CVE:"):
                    cve_ids.append(f.replace("CVE:", "").strip())
    except Exception:
        pass

    return cve_ids[:5]  # limit to 5


def crawl_package(package_name: str) -> dict | None:
    """Crawl all signals for a single package."""
    print(f"  Crawling {package_name}...")

    # Get repo URL
    repo_url = get_package_repo_url(package_name)
    time.sleep(0.5)  # rate limit

    # Scrape all sources
    npm_data = scrape_npm_page(package_name)
    time.sleep(1)  # rate limit

    github_data = {}
    if repo_url:
        github_data = scrape_github_repo(repo_url)
        time.sleep(1)

    community_data = scrape_community(package_name, repo_url)
    time.sleep(0.5)

    # Get CVE IDs for security context
    cve_ids = get_cve_ids(package_name)
    security_data = scrape_security_context(cve_ids=cve_ids)

    # Build output
    result = {
        "package_name": package_name,
        "crawled_at": datetime.now(timezone.utc).isoformat(),
        "crawl_version": 1,
        "npm": npm_data,
        "github": github_data,
        "community": community_data,
        "security": security_data,
    }

    return result


def save_scraped_data(package_name: str, data: dict):
    """Save scraped data to JSON file."""
    os.makedirs(DATA_DIR, exist_ok=True)

    # Normalize filename
    safe_name = package_name.replace("@", "").replace("/", "__")
    filepath = os.path.join(DATA_DIR, f"{safe_name}.json")

    with open(filepath, "w") as f:
        json.dump(data, f, indent=2)


def update_last_crawled(package_name: str):
    """Update the last_crawled_at timestamp in the database."""
    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor()
    cur.execute("""
        UPDATE package_score_cache
        SET last_crawled_at = NOW()
        WHERE package_name = %s
    """, (package_name,))
    conn.commit()
    cur.close()
    conn.close()


def add_last_crawled_column():
    """Add last_crawled_at column if it doesn't exist."""
    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor()
    cur.execute("""
        DO $$ BEGIN
            ALTER TABLE package_score_cache
            ADD COLUMN IF NOT EXISTS last_crawled_at TIMESTAMPTZ;
        EXCEPTION WHEN duplicate_column THEN
            NULL;
        END $$;
    """)
    conn.commit()
    cur.close()
    conn.close()


def main():
    parser = argparse.ArgumentParser(description="Package scoring crawler")
    parser.add_argument("--batch-size", type=int, default=DEFAULT_BATCH_SIZE)
    parser.add_argument("--package", type=str, help="Crawl a specific package")
    parser.add_argument("--list", type=str, help="File with package names (one per line)")
    parser.add_argument("--force", action="store_true", help="Re-crawl recently crawled packages")
    args = parser.parse_args()

    # Ensure output directory exists
    os.makedirs(DATA_DIR, exist_ok=True)

    # Add DB column if needed
    try:
        add_last_crawled_column()
        print("Database ready.")
    except Exception as e:
        print(f"Warning: Could not update database schema: {e}")

    # Determine packages to crawl
    if args.package:
        packages = [{"name": args.package}]
    elif args.list:
        with open(args.list) as f:
            packages = [{"name": line.strip()} for line in f if line.strip()]
    else:
        packages = get_packages_to_crawl(args.batch_size, args.force)

    if not packages:
        print("No packages to crawl.")
        return

    print(f"Crawling {len(packages)} packages...")

    success = 0
    failed = 0

    for i, pkg in enumerate(packages, 1):
        name = pkg["name"]
        print(f"[{i}/{len(packages)}] {name}", end="")

        try:
            data = crawl_package(name)
            if data:
                save_scraped_data(name, data)
                update_last_crawled(name)
                success += 1
                print(f" ✓ ({data.get('github', {}).get('stars', 0)} stars)")
            else:
                failed += 1
                print(" ✗ (no data)")
        except Exception as e:
            failed += 1
            print(f" ✗ ({e})")

        # Rate limiting between packages
        if i < len(packages):
            time.sleep(1)

    print(f"\nDone: {success} succeeded, {failed} failed")


if __name__ == "__main__":
    main()
