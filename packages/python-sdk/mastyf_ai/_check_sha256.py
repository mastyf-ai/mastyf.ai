"""The check program this package runs, and the SHA-256 of each platform's build.

Filled in when `check-v<CHECK_VERSION>` is released (see the release steps). Until then there is
no verified build to download, and the library uses MASTYF_CHECK_URL, a running local service, or
MASTYF_CHECK_BIN.
"""

CHECK_VERSION = "0.1.0"

SHA256: dict[str, str] = {}
