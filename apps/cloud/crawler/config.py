"""
Configuration for the package scoring crawler.
"""
import os

# Database connection
DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://neondb_owner:npg_BOmH08yXDgse@ep-wispy-mouse-aznn5raj-pooler.c-3.ap-southeast-1.aws.neon.tech/neondb?sslmode=require"
)

# Output directory for scraped data
DATA_DIR = os.path.join(os.path.dirname(__file__), "data")

# Rate limiting (seconds between requests)
RATE_LIMITS = {
    "npm": 2.0,
    "github": 1.5,  # 0.5 with token
    "stackoverflow": 1.0,
    "nvd": 6.0,  # 0.6 with key
}

# GitHub token (optional, increases rate limit)
GITHUB_TOKEN = os.environ.get("GITHUB_TOKEN", "")

# NVD API key (optional, increases rate limit)
NVD_API_KEY = os.environ.get("NVD_API_KEY", "")

# Crawl freshness (hours) — skip packages crawled within this window
CRAWL_FRESHNESS_HOURS = 6

# Batch size for database queries
DEFAULT_BATCH_SIZE = 50

# Request timeout (seconds)
REQUEST_TIMEOUT = 15
