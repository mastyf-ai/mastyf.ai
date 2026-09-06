#!/usr/bin/env python3
"""
Publishes Version 5.3 of Mastyf Guard to Zenodo:
1. Creates a new version draft from record 22463320 (Concept DOI: 10.5281/zenodo.22179415).
2. Cleans up any old files in the draft.
3. Uploads the canonical 15-page manuscript PDF (mastyf-guard.pdf, 6.5 MB)
   and updated replication/submission bundle (techrxiv_submission_bundle.zip, 13 MB).
4. Updates metadata with Version 5.3 and the refined Phase 4 abstract / author affiliations.
5. Publishes the deposit and outputs the new Version DOI, Concept DOI, and URLs.
"""

import os
import sys
import json
import requests

publish_now = "--publish" in sys.argv
explicit_token = [arg for arg in sys.argv[1:] if not arg.startswith("--")]
ZENODO_TOKEN = explicit_token[0] if explicit_token else os.environ.get("ZENODO_TOKEN", "tfljZdfBRuyDzbO0yupN1HNFEULMSJ7YvCQCj787XL9XP9doBo8TkvrXVZdC")
BASE_URL = "https://zenodo.org/api"
PARENT_RECORD_ID = "22463320"  # Last published version (v2.1)
CONCEPT_REC_ID = "22179415"

PDF_PATH = "/Users/rudraneeldas/Projects/mastyf-full/paper/mastyf-guard.pdf"
BUNDLE_PATH = "/Users/rudraneeldas/Projects/mastyf-full/paper/techrxiv_submission_bundle.zip"
RECEIPT_PATH = "/Users/rudraneeldas/Projects/mastyf-full/reports/zenodo_v5_3_publish_receipt.json"

headers = {"Authorization": f"Bearer {ZENODO_TOKEN}"}

def main():
    publish_now = "--publish" in sys.argv

    print("1. Testing Zenodo authentication...")
    r = requests.get(f"{BASE_URL}/deposit/depositions", headers=headers)
    if r.status_code != 200:
        print(f"❌ Auth failed ({r.status_code}): {r.text}")
        sys.exit(1)
    print("✅ Authenticated successfully with Zenodo API!")

    # Check for existing unsubmitted draft or create new version
    draft_id = None
    r_drafts = requests.get(f"{BASE_URL}/deposit/depositions", headers=headers)
    for d in r_drafts.json():
        if d.get("conceptrecid") == CONCEPT_REC_ID and not d.get("submitted"):
            draft_id = str(d.get("id"))
            print(f"Found active unsubmitted draft: ID = {draft_id}")
            break

    if not draft_id:
        print(f"Creating new version from parent record {PARENT_RECORD_ID}...")
        r_new = requests.post(f"{BASE_URL}/deposit/depositions/{PARENT_RECORD_ID}/actions/newversion", headers=headers)
        if r_new.status_code not in (200, 201):
            print(f"❌ Failed to create new version ({r_new.status_code}): {r_new.text}")
            sys.exit(1)
        new_data = r_new.json()
        draft_id = new_data["links"]["latest_draft"].split("/")[-1]
        print(f"✅ Created new draft: ID = {draft_id}")

    # Fetch draft deposition details
    r_draft = requests.get(f"{BASE_URL}/deposit/depositions/{draft_id}", headers=headers)
    draft_data = r_draft.json()
    bucket_url = draft_data["links"]["bucket"]
    print(f"Deposit bucket URL: {bucket_url}")

    # Check if files already uploaded
    files = draft_data.get("files", [])
    file_names = {f["filename"] for f in files}
    already_uploaded = ("mastyf-guard.pdf" in file_names and "techrxiv_submission_bundle.zip" in file_names)

    if already_uploaded:
        print(f"2. Verified existing files in draft: {file_names} (skipping re-upload).")
    else:
        # Delete old files from draft
        print(f"2. Cleaning up {len(files)} old files in draft...")
        for f in files:
            fid = f["id"]
            fname = f["filename"]
            print(f" - Deleting old file: {fname} (ID: {fid})")
            r_del = requests.delete(f"{BASE_URL}/deposit/depositions/{draft_id}/files/{fid}", headers=headers)
            if r_del.status_code not in (204, 200):
                print(f"   Warning: delete failed for {fname}: {r_del.text}")

        # Upload fresh 15-page PDF
        print(f"3. Uploading canonical 15-page manuscript: {PDF_PATH} ({os.path.getsize(PDF_PATH):,} bytes)...")
        with open(PDF_PATH, "rb") as fp:
            r_pdf = requests.put(f"{bucket_url}/mastyf-guard.pdf", data=fp, headers=headers)
        if r_pdf.status_code not in (200, 201):
            print(f"❌ PDF upload failed ({r_pdf.status_code}): {r_pdf.text}")
            sys.exit(1)
        print("✅ Successfully uploaded mastyf-guard.pdf!")

        # Upload fresh submission bundle
        print(f"4. Uploading updated submission bundle: {BUNDLE_PATH} ({os.path.getsize(BUNDLE_PATH):,} bytes)...")
        with open(BUNDLE_PATH, "rb") as fp:
            r_zip = requests.put(f"{bucket_url}/techrxiv_submission_bundle.zip", data=fp, headers=headers)
        if r_zip.status_code not in (200, 201):
            print(f"❌ Bundle upload failed ({r_zip.status_code}): {r_zip.text}")
            sys.exit(1)
        print("✅ Successfully uploaded techrxiv_submission_bundle.zip!")

    # Update metadata
    print("5. Updating deposition metadata for Version 5.3...")
    existing_meta = draft_data.get("metadata", {})
    existing_meta["title"] = "Capability-Mediated Perimeters for Secure AI Agent Tool Execution: Conditional Non-Escalation Invariants and Empirical Evaluation Against Indirect Prompt Injection"
    existing_meta["version"] = "5.3"
    existing_meta["creators"] = [
        {
            "name": "Das, Rudraneel",
            "affiliation": "Mastyf AI Research Laboratories",
            "orcid": "0009-0009-6173-0262"
        }
    ]
    existing_meta["description"] = """<p><b>Abstract</b> &mdash; Autonomous artificial intelligence agents executing over extensible tool interfaces (such as Anthropic's Model Context Protocol) operate with ambient authority over connected tools. Because autoregressive Transformers ingest instructions and untrusted third-party data within a single homogeneous context window, adversarial observations can manipulate the model into executing unintended privileged actions&mdash;the classic Confused Deputy problem. In this paper, we explore an architectural defense-in-depth approach that treats <b>LLM agents as potentially compromised, untrusted principals</b>. Rather than relying on linguistic moderation alone, tool dispatch is governed by an external capability-mediated reference monitor enforcing complete mediation, least privilege, and four typed relational argument invariants (destination containment, scope boundedness, privilege monotonicity, and aggregate monetary clamping). Under complete mediation axioms (A1&ndash;A6) over the trusted computing base, out-of-scope tool invocation is deterministically rejected at the transport boundary, formalized as an <b>Inductive Multi-Step Tool Chain Composability Invariant (Proposition 1)</b> showing that adversarial observations cannot synthesize authority across arbitrary execution sequences. However, in-scope parameter poisoning within authorized tools and cross-tool data exfiltration present harder challenges: semantic neural validation is distribution-bounded (exhibiting an empirical false-negative rate of 21.5% on in-scope manipulations prior to boundary sharpening and remaining susceptible to adversarial optimization), while cross-tool exfiltration requires explicit decentralized information-flow tracking (DIFC).</p>

<p>We further introduce <b>declarative stateful workflow authorization</b>, which constrains specified multi-step action sequences as a restrictive intersection with CBAC and DIFC, and validate the integrated gateway through <b>23 author-constructed adversarial workflow tests</b> covering trajectory, concurrency, desynchronization, execution uncertainty, and receipt-integrity attacks.</p>

<p>We report empirical evaluations across both foundational baseline studies (a 50,000-sample macro benchmark and a 3,000-case ablation matrix) and a <b>Six-Regime Empirical Validation Program totaling 6,662 evaluation cases with frozen checkpoint V<sub>6</sub></b>: achieving 100% Correct Identification Rate on internal factorized diagnostics (<i>N</i> = 145), 100% accuracy on a pre-sealed holdout suite (75/75, SHA-256: <code>22bc736c...</code>), 98.43% defense on the 4,216-instance InjecAgent evaluation (2,075/2,108 attacks blocked, 1,916/2,108 benign allowed) (<i>P</i><sub>50</sub>: 267.7 ms), 92.44% defense on AI Safety Bench (416/450 attacks blocked, 550/550 benign operations allowed), 99.52% attack defense on interactive AgentDojo (<i>N</i> = 629) with exact clean-task utility parity (6/97 tasks) matching the unprotected base agent, and 100% defense across 500 targeted adaptive red-team trials.</p>

<p>Finally, we systemize the runtime into the Mastyf Security Gateway: <b>the evaluated research runtime was v0.1.0-RC1 (verifying 38/38 security invariant tests); the hardened commercial-pilot runtime is v0.1.1-rc1 (verifying 118/118 tests across unit, integration, and adversarial suites)</b>, establishing complete mediation non-executability (Decision &isin; {BLOCK, ESCALATE} &rArr; BackendToolInvocations = 0) and &gt;330,000 req/s reference monitor throughput under an Ed25519-signed release manifest. We contextualize Mastyf as an empirically evaluated pre-production architecture, highlighting residual risks and outlining requirements for broader production-scale validation.</p>"""

    existing_meta["keywords"] = [
        "Autonomous AI Agents",
        "Indirect Prompt Injection",
        "Model Context Protocol",
        "Capability-Based Access Control",
        "DIFC",
        "Stateful Workflow Authorization",
        "Adversarial Trajectory Testing",
        "Argument Intent Alignment",
        "In-Scope Parameter Integrity"
    ]

    meta_payload = {"metadata": existing_meta}
    r_meta = requests.put(
        f"{BASE_URL}/deposit/depositions/{draft_id}",
        headers={**headers, "Content-Type": "application/json"},
        data=json.dumps(meta_payload)
    )
    if r_meta.status_code != 200:
        print(f"Warning: metadata update returned {r_meta.status_code}: {r_meta.text}")
    else:
        print("✅ Metadata updated successfully!")

    if not publish_now:
        print("\n" + "="*70)
        print(f"📝 STAGED DRAFT FOR VERSION 5.3 READY ON ZENODO!")
        print(f"Draft Deposition ID: {draft_id}")
        print(f"Draft URL: https://zenodo.org/deposit/{draft_id}")
        print("Run with --publish to publish this draft to Zenodo.")
        print("="*70)
        return

    # Publish Version 5.3
    print(f"6. Publishing Version 5.3 (Deposition ID: {draft_id})...")
    r_pub = requests.post(f"{BASE_URL}/deposit/depositions/{draft_id}/actions/publish", headers=headers)
    if r_pub.status_code not in (202, 200):
        print(f"❌ Publishing failed ({r_pub.status_code}): {r_pub.text}")
        sys.exit(1)

    pub_data = r_pub.json()
    version_doi = pub_data.get("doi")
    concept_doi = pub_data.get("conceptdoi")
    record_url = pub_data["links"]["record_html"]
    doi_url = pub_data["links"]["doi"]

    print("\n" + "="*70)
    print("🎉 VERSION 5.3 SUCCESSFULLY PUBLISHED TO ZENODO!")
    print(f"Version:        5.3")
    print(f"Deposition ID:  {draft_id}")
    print(f"Concept DOI:    {concept_doi}")
    print(f"Version DOI:    {version_doi}")
    print(f"Record URL:     {record_url}")
    print(f"DOI URL:        {doi_url}")
    print("="*70)

    receipt = {
        "version": "5.3",
        "concept_doi": concept_doi,
        "version_doi": version_doi,
        "record_url": record_url,
        "doi_url": doi_url,
        "deposition_id": draft_id
    }
    with open(RECEIPT_PATH, "w") as fp:
        json.dump(receipt, fp, indent=2)
    print(f"Receipt written to {RECEIPT_PATH}")

if __name__ == "__main__":
    main()
