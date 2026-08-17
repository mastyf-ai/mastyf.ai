"""
GitHub repository scraper — extracts health signals from GitHub repo pages.
Uses GitHub API for structured data (stars, forks, issues) when possible.
"""
import re
import time
import requests
from bs4 import BeautifulSoup
from datetime import datetime, timezone
from config import REQUEST_TIMEOUT, GITHUB_TOKEN

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    "Accept": "text/html,application/xhtml+xml",
}

API_HEADERS = {
    "Accept": "application/vnd.github+json",
    "User-Agent": "mastyf-score-bot",
}
if GITHUB_TOKEN:
    API_HEADERS["Authorization"] = f"Bearer {GITHUB_TOKEN}"


def _clean_github_url(url: str) -> str:
    """Clean git+https:// and .git suffix from GitHub URLs."""
    url = url.strip()
    if url.startswith("git+"):
        url = url[4:]
    if url.endswith(".git"):
        url = url[:-4]
    return url.rstrip("/")


def _parse_owner_repo(url: str):
    """Extract owner/repo from a GitHub URL."""
    m = re.search(r"github\.com/([^/]+)/([^/]+)", url)
    if m:
        return m.group(1), m.group(2)
    return None, None


def _days_since(date_str: str) -> int:
    """Calculate days since a date string."""
    try:
        if "T" in date_str:
            dt = datetime.fromisoformat(date_str.replace("Z", "+00:00"))
        else:
            dt = datetime.strptime(date_str, "%Y-%m-%d").replace(tzinfo=timezone.utc)
        delta = datetime.now(timezone.utc) - dt
        return max(0, delta.days)
    except Exception:
        return 999


def _scrape_api(owner: str, repo: str) -> dict:
    """Use GitHub API for structured repo data."""
    result = {}
    try:
        # Get repo info
        r = requests.get(
            f"https://api.github.com/repos/{owner}/{repo}",
            headers=API_HEADERS,
            timeout=REQUEST_TIMEOUT,
        )
        if r.status_code == 200:
            d = r.json()
            result["stars"] = d.get("stargazers_count", 0)
            result["forks"] = d.get("forks_count", 0)
            result["open_issues"] = d.get("open_issues_count", 0)
            result["has_wiki"] = d.get("has_wiki", False)
            result["has_license_file"] = d.get("license") is not None

            # Last push date
            pushed = d.get("pushed_at") or d.get("updated_at")
            if pushed:
                result["last_commit_days_ago"] = _days_since(pushed)

        time.sleep(0.8)

        # Get default branch for file tree check
        branch = "main"
        if r.status_code == 200:
            branch = r.json().get("default_branch", "main")

        # Get repo contents for file checks
        r2 = requests.get(
            f"https://api.github.com/repos/{owner}/{repo}/contents/",
            headers=API_HEADERS,
            params={"ref": branch},
            timeout=REQUEST_TIMEOUT,
        )
        if r2.status_code == 200:
            items = r2.json()
            names = [item.get("name", "").lower() for item in items if isinstance(item, dict)]
            result["has_security_md"] = "security.md" in names
            result["has_contributing_md"] = "contributing.md" in names
            result["has_code_of_conduct"] = any("code_of_conduct" in n for n in names)
            result["has_issue_templates"] = any(
                "issue_template" in n or "issue-template" in n for n in names
            )
            result["has_docs_dir"] = any(n in ["docs", "documentation"] for n in names)
            result["has_examples_dir"] = any(n in ["examples", "example"] for n in names)

        time.sleep(0.5)

        # Get commit activity for commits_last_30d
        r3 = requests.get(
            f"https://api.github.com/repos/{owner}/{repo}/stats/commit_activity",
            headers=API_HEADERS,
            timeout=REQUEST_TIMEOUT,
        )
        if r3.status_code == 200:
            weeks = r3.json()
            if isinstance(weeks, list) and len(weeks) >= 1:
                total = sum(w.get("total", 0) for w in weeks[-4:])
                result["commits_last_30d"] = total

        time.sleep(0.5)

        # Check for GitHub Actions workflows
        r4 = requests.get(
            f"https://api.github.com/repos/{owner}/{repo}/contents/.github/workflows",
            headers=API_HEADERS,
            params={"ref": branch},
            timeout=REQUEST_TIMEOUT,
        )
        result["has_ci"] = r4.status_code == 200

    except Exception as e:
        print(f"  GitHub API error for {owner}/{repo}: {e}")

    return result


def _scrape_html(url: str) -> dict:
    """Fallback: scrape GitHub page HTML for basic signals."""
    result = {}
    try:
        resp = requests.get(url, headers=HEADERS, timeout=REQUEST_TIMEOUT)
        if resp.status_code != 200:
            return result

        soup = BeautifulSoup(resp.text, "lxml")

        # Stars — try multiple selectors
        for selector in [
            "#repo-stars-counter-star",
            "a[href*='/stargazers'] span.Counter",
            "a[href*='/stargazers'] span",
            "[class*='stargazers'] span",
        ]:
            el = soup.select_one(selector)
            if el:
                text = el.get_text(strip=True).replace(",", "")
                try:
                    if "k" in text.lower():
                        result["stars"] = int(float(text.lower().replace("k", "")) * 1000)
                    else:
                        result["stars"] = int(text)
                    break
                except ValueError:
                    pass

        # Forks
        for selector in [
            "a[href*='/forks'] span.Counter",
            "a[href*='/forks'] span",
            "#repo-network-counter",
        ]:
            el = soup.select_one(selector)
            if el:
                text = el.get_text(strip=True).replace(",", "")
                try:
                    result["forks"] = int(text)
                    break
                except ValueError:
                    pass

        # Open issues
        for selector in [
            "a[href*='/issues'] span.Counter",
            "a[href*='/issues'] span",
            "#issues-repo-tab-count",
        ]:
            el = soup.select_one(selector)
            if el:
                text = el.get_text(strip=True).replace(",", "")
                try:
                    result["open_issues"] = int(text)
                    break
                except ValueError:
                    pass

        # File checks from file tree
        file_links = soup.select(".js-navigation-container a, [aria-label='Files'] a")
        file_names = [link.get_text(strip=True).lower() for link in file_links]
        if file_names:
            result["has_security_md"] = "security.md" in file_names
            result["has_contributing_md"] = "contributing.md" in file_names
            result["has_code_of_conduct"] = any("code_of_conduct" in n for n in file_names)
            result["has_license_file"] = any("license" in n for n in file_names)
            result["has_docs_dir"] = any(n in ["docs", "documentation"] for n in file_names)
            result["has_examples_dir"] = any(n in ["examples", "example"] for n in file_names)

        # Last commit
        time_el = soup.select_one("relative-time")
        if time_el and time_el.get("datetime"):
            result["last_commit_days_ago"] = _days_since(time_el["datetime"])

        # Wiki
        result["has_wiki"] = soup.select_one("a[href*='/wiki']") is not None

        # CI
        result["has_ci"] = bool(
            soup.select_one("img[src*='actions/workflows'], img[src*='ci']")
        )

    except Exception as e:
        print(f"  GitHub HTML scrape error: {e}")

    return result


def scrape_github_repo(repo_url: str) -> dict:
    """
    Scrape a GitHub repository for health signals.
    Tries API first, falls back to HTML scraping.
    """
    defaults = {
        "stars": 0, "forks": 0, "open_issues": 0,
        "has_security_md": False, "has_contributing_md": False,
        "has_code_of_conduct": False, "has_ci": False,
        "has_license_file": False, "has_issue_templates": False,
        "last_commit_days_ago": 999, "commits_last_30d": 0,
        "has_docs_dir": False, "has_examples_dir": False, "has_wiki": False,
    }

    if not repo_url:
        return defaults

    url = _clean_github_url(repo_url)
    owner, repo = _parse_owner_repo(url)

    if owner and repo:
        # Try API first
        result = _scrape_api(owner, repo)
        # Fill missing fields from HTML if needed
        missing = [k for k in defaults if k not in result]
        if missing:
            html = _scrape_html(url)
            for k in missing:
                result[k] = html.get(k, defaults[k])
        return result
    else:
        # Can't parse owner/repo, try HTML only
        result = _scrape_html(url)
        for k, v in defaults.items():
            result.setdefault(k, v)
        return result
