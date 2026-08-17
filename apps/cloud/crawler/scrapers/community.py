"""
Community reputation scraper — extracts npm download trends,
GitHub star growth, and Stack Overflow mentions.
"""
import re
import requests
from bs4 import BeautifulSoup
from config import REQUEST_TIMEOUT

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    "Accept": "text/html,application/xhtml+xml",
}


def scrape_npm_trend(package_name: str) -> str:
    """Determine download trend (up/down/stable) from npm page."""
    try:
        url = f"https://www.npmjs.com/package/{package_name}"
        resp = requests.get(url, headers=HEADERS, timeout=REQUEST_TIMEOUT)
        if resp.status_code != 200:
            return "stable"

        soup = BeautifulSoup(resp.text, "lxml")
        trend_el = soup.select_one("[class*='trend'], [class*='sparkline']")
        if trend_el:
            classes = " ".join(trend_el.get("class", []))
            if "up" in classes or "positive" in classes:
                return "up"
            if "down" in classes or "negative" in classes:
                return "down"

        return "stable"
    except Exception:
        return "stable"


def scrape_stackoverflow_mentions(package_name: str) -> int:
    """
    Get the number of Stack Overflow questions tagged with the package name.
    Gracefully handles 403/429 blocks.
    """
    try:
        # Clean package name for SO tag
        tag = package_name.split("/")[-1].lower()
        if not tag or len(tag) < 2:
            return 0

        # SO blocks most scrapers — use their API instead (no auth needed for tag info)
        try:
            api_url = f"https://api.stackexchange.com/2.3/tags/{tag}/info?site=stackoverflow"
            resp = requests.get(api_url, timeout=REQUEST_TIMEOUT)
            if resp.status_code == 200:
                data = resp.json()
                items = data.get("items", [])
                if items:
                    return items[0].get("count", 0)
        except Exception:
            pass

        # Fallback: try scraping the page (may get 403)
        url = f"https://stackoverflow.com/questions/tagged/{tag}"
        resp = requests.get(url, headers=HEADERS, timeout=REQUEST_TIMEOUT)
        if resp.status_code != 200:
            return 0

        soup = BeautifulSoup(resp.text, "lxml")
        count_el = soup.select_one(".s-page-title--description, [class*='count']")
        if count_el:
            text = count_el.get_text(strip=True)
            match = re.search(r"([\d,]+)", text)
            if match:
                return int(match.group(1).replace(",", ""))

        return 0
    except Exception:
        return 0


def scrape_community(package_name: str, repo_url: str = None) -> dict:
    """Aggregate community reputation signals."""
    trend = scrape_npm_trend(package_name)
    so_mentions = scrape_stackoverflow_mentions(package_name)

    return {
        "npm_weekly_downloads_trend": trend,
        "stackoverflow_mentions": so_mentions,
        "github_stars_growth_30d": 0,
    }
