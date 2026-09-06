"""
Release Trust Chain & Reproducible Metadata Invariant Test
Asserts that the immutable V6 model pin, package version, and release metadata are cryptographically bound.
"""

from pathlib import Path
from mastyf_gateway.release import (
    GATEWAY_VERSION,
    GATEWAY_SOURCE_GIT_SHA,
    FROZEN_V6_HF_REVISION,
    FROZEN_V6_REPO,
    get_release_metadata,
    verify_trust_chain
)

def test_release_metadata_binding():
    meta = get_release_metadata()
    assert meta["gateway_version"] == "0.1.1"
    assert meta["gateway_source_git_sha"] == "4331fa468f70a7887a9e41cad92e8a12d4b48f80"
    assert meta["frozen_v6_hf_revision"] == "d59a6aa01f9139dff106146addb04109afa69c03"
    assert meta["frozen_v6_repo"] == "Rudraneel93/mastyf-guard-1.5b-v2-boundary-sharpened"

def test_verify_trust_chain_structure(tmp_path):
    pkg_dir = Path(__file__).parent.parent.parent
    report = verify_trust_chain(tmp_path, pkg_dir)
    
    assert "release_metadata" in report
    assert report["checks"]["gateway_version"]["status"] == "PASS"
    assert report["checks"]["release_manifest_signature"]["status"] == "PASS"
    assert report["checks"]["gateway_source_commit"]["status"] == "PASS"
    assert report["checks"]["fail_closed_mode"]["status"] == "PASS"
