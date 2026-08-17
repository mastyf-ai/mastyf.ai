"""
Security context scraper — scrapes CVE advisory pages for patch availability,
exploit mentions, and additional context.
"""
import re
import requests
from bs4 import BeautifulSoup
from config import REQUEST_TIMEOUT

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    "Accept": "text/html,application/xhtml+xml",
}


def scrape_cve_context(cve_id: str) -> dict:
    """Scrape NVD CVE page for context (patch availability, exploit mentions)."""
    result = {
        "has_exploit": False,
        "has_patch": False,
        "patched_in_version": None,
    }

    try:
        url = f"https://nvd.nist.gov/vuln/detail/{cve_id}"
        resp = requests.get(url, headers=HEADERS, timeout=REQUEST_TIMEOUT)
        if resp.status_code != 200:
            return result

        soup = BeautifulSoup(resp.text, "lxml")
        body_text = soup.get_text(separator=" ", strip=True).lower()

        # Exploit mentions
        exploit_patterns = [
            "exploit in the wild",
            "exploit code is available",
            "actively exploited",
            "known exploit",
            "weaponized",
        ]
        result["has_exploit"] = any(p in body_text for p in exploit_patterns)

        # Patch availability
        patch_patterns = [
            "patch",
            "fixed in",
            "remediation",
            "upgrade to",
            "updated version",
            "mitigation",
        ]
        result["has_patch"] = any(p in body_text for p in patch_patterns)

        # Patched version
        version_pattern = r"(?:fixed|patched|remediated)\s+(?:in|version)\s+([\d.]+)"
        version_match = re.search(version_pattern, body_text)
        if version_match:
            result["patched_in_version"] = version_match.group(1)

    except Exception as e:
        print(f"Error scraping CVE context for {cve_id}: {e}")

    return result


def scrape_ghsa_context(ghsa_id: str) -> dict:
    """Scrape GitHub Advisory page for context."""
    result = {
        "has_exploit": False,
        "has_patch": False,
        "patched_in_version": None,
    }

    try:
        url = f"https://github.com/advisories/{ghsa_id}"
        resp = requests.get(url, headers=HEADERS, timeout=REQUEST_TIMEOUT)
        if resp.status_code != 200:
            return result

        soup = BeautifulSoup(resp.text, "lxml")
        body_text = soup.get_text(separator=" ", strip=True).lower()

        result["has_exploit"] = "exploit" in body_text and (
            "in the wild" in body_text or "active" in body_text or "weaponized" in body_text
        )

        patched_el = soup.select_one("[class*='patched'], [class*='fixed']")
        if patched_el:
            result["has_patch"] = True
            version_text = patched_el.get_text(strip=True)
            version_match = re.search(r"([\d.]+)", version_text)
            if version_match:
                result["patched_in_version"] = version_match.group(1)

    except Exception as e:
        print(f"Error scraping GHSA context for {ghsa_id}: {e}")

    return result


def scrape_security_context(
    cve_ids: list[str] = None,
    ghsa_ids: list[str] = None,
) -> dict:
    """Aggregate security context from CVE and GHSA advisory pages."""
    cve_contexts = []

    for cve_id in (cve_ids or []):
        context = scrape_cve_context(cve_id)
        context["cve_id"] = cve_id
        cve_contexts.append(context)

    for ghsa_id in (ghsa_ids or []):
        context = scrape_ghsa_context(ghsa_id)
        context["cve_id"] = ghsa_id
        cve_contexts.append(context)

    latest_patched = all(
        ctx.get("has_patch", False) for ctx in cve_contexts
    ) if cve_contexts else True

    return {
        "cve_contexts": cve_contexts,
        "latest_version_patched": latest_patched,
    }
