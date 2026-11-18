"""The check program this package runs, and the SHA-256 of each platform's build.

From the `check-v<CHECK_VERSION>` GitHub release (its `.sha256` files). A downloaded program is run
only when its SHA-256 matches the one here.
"""

CHECK_VERSION = "0.1.0"

SHA256: dict[str, str] = {
    "mastyf-check-win-x64.exe": "27d1caa1bf0076d18b290ba430b7e852160976d087f396167ad2a77e220bad3b",
    "mastyf-check-linux-x64": "ab6ae7f4a2d523bd49fd1cb5cea872eab064ae9cec4e76441e67a804b18b5095",
    "mastyf-check-linux-arm64": "2dd9fef54009f7142a97cb39cbf37db248854f278d146f28b77690df40fed508",
    "mastyf-check-darwin-x64": "44409e9c6cb37899605a95363106cf35e2de515bac1183a53a3f8066137aeac4",
    "mastyf-check-darwin-arm64": "596ec6c0d993f147e7053b60ff54e16fe98b7bb8c7027b017d58da54876fd8e6",
}
