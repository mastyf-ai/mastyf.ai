"""
NPM package page scraper — uses registry API for metadata and
scrapes the npmjs.com page for README quality signals.
"""
import re
import requests
from bs4 import BeautifulSoup
from config import REQUEST_TIMEOUT

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    "Accept": "text/html,application/xhtml+xml",
    "Accept-Language": "en-US,en;q=0.9",
}


def _fetch_registry_metadata(package_name: str) -> dict:
    """Fetch reliable metadata from npm registry API."""
    result = {
        "weekly_downloads_display": "0",
        "maintainer_count": 0,
        "license_displayed": "unknown",
        "repository_link": None,
        "homepage_link": None,
    }

    try:
        encoded = package_name.replace("/", "%2f")
        resp = requests.get(
            f"https://registry.npmjs.org/{encoded}",
            timeout=REQUEST_TIMEOUT,
        )
        if resp.status_code != 200:
            return result

        doc = resp.json()

        # License
        latest_ver = doc.get("dist-tags", {}).get("latest", "")
        v_doc = doc.get("versions", {}).get(latest_ver, {})
        lic = v_doc.get("license")
        result["license_displayed"] = lic if isinstance(lic, str) else (lic.get("type", "unknown") if isinstance(lic, dict) else "unknown")

        # Repository
        repo = v_doc.get("repository")
        if isinstance(repo, str):
            result["repository_link"] = repo
        elif isinstance(repo, dict):
            result["repository_link"] = repo.get("url")

        # Homepage
        result["homepage_link"] = v_doc.get("homepage")

        # Maintainers
        maintainers = doc.get("maintainers", [])
        result["maintainer_count"] = len(maintainers) if isinstance(maintainers, list) else 0

        # Downloads
        dl_resp = requests.get(
            f"https://api.npmjs.org/downloads/point/last-month/{encoded}",
            timeout=REQUEST_TIMEOUT,
        )
        if dl_resp.status_code == 200:
            dl_data = dl_resp.json()
            count = dl_data.get("downloads", 0)
            if count >= 1_000_000:
                result["weekly_downloads_display"] = f"{count / 1_000_000:.1f}M"
            elif count >= 1_000:
                result["weekly_downloads_display"] = f"{count / 1_000:.1f}K"
            else:
                result["weekly_downloads_display"] = str(count)

    except Exception as e:
        print(f"  Registry API error for {package_name}: {e}")

    return result


def scrape_npm_page(package_name: str) -> dict:
    """
    Scrape npm for README quality signals + metadata.
    Uses registry API for metadata (reliable) and page scraping for README analysis.
    """
    # Get reliable metadata from registry API
    result = _fetch_registry_metadata(package_name)

    # Add README analysis defaults
    result.update({
        "readme_length": 0,
        "readme_has_examples": False,
        "readme_has_badges": 0,
        "readme_has_install_instructions": False,
        "readme_has_api_docs": False,
    })

    # Scrape page for README quality signals
    try:
        url = f"https://www.npmjs.com/package/{package_name}"
        resp = requests.get(url, headers=HEADERS, timeout=REQUEST_TIMEOUT)
        if resp.status_code != 200:
            return result

        soup = BeautifulSoup(resp.text, "lxml")

        # README analysis
        readme_section = (
            soup.select_one(".markdown-body")
            or soup.select_one("#readme")
        )
        if readme_section:
            readme_text = readme_section.get_text(separator=" ", strip=True)
            result["readme_length"] = len(readme_text)

            # Code examples
            code_blocks = readme_section.find_all("code")
            result["readme_has_examples"] = len(code_blocks) > 2

            # Badges
            badges = soup.find_all("img", src=re.compile(r"badge|shields\.io"))
            result["readme_has_badges"] = len(badges)

            # Install instructions
            lower_text = readme_text.lower()
            install_patterns = ["npm install", "yarn add", "pnpm add", "npx "]
            result["readme_has_install_instructions"] = any(
                p in lower_text for p in install_patterns
            )

            # API docs
            api_patterns = ["## api", "## usage", "## methods", "## options", "## examples"]
            result["readme_has_api_docs"] = any(p in lower_text for p in api_patterns)

    except Exception as e:
        print(f"  NPM page scrape error for {package_name}: {e}")

    return result
