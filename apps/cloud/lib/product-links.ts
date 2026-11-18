/**
 * Public product naming — mastyf.ai security platform.
 */

export const SITE_NAME = 'mastyf.ai';
export const CLOUD_NAME = 'mastyf.ai Cloud';

/** Canonical production URL (www). Set NEXT_PUBLIC_APP_URL in Vercel to match. */
export const PRODUCTION_SITE_URL = 'https://www.mastyf.ai';
export const PRODUCTION_SITE_HOST = 'www.mastyf.ai';
export const PRODUCTION_APEX_HOST = 'mastyf.ai';

/** Kept for backward compatibility with API/library code — not shown in UI */
export const NPM_PRODUCT_NAME = 'mastyf.ai engine';
export const NPM_PACKAGE_NAME = 'mastyf.ai';
export const NPM_PACKAGE_URL = 'https://github.com/mastyf-ai/mastyf.ai';
export const GITHUB_REPO_URL = 'https://github.com/mastyf-ai/mastyf.ai';
export const CLI_NAME = 'mastyf-ai';
export const NPM_INSTALL_CMD = `npm install -g @mcp-guardian/server`;
export const CLI_ONBOARD_CMD = `mastyf-ai onboard --apply`;
export const CLI_START_CMD = `mastyf-ai start`;

/** Research & distribution */
export const HF_MODEL_URL = 'https://huggingface.co/Rudraneel93/mastyf-guard-1.5b';
export const HF_MODEL_ID = 'Rudraneel93/mastyf-guard-1.5b';
/** The newest Zenodo version of the paper (the concept DOI below always resolves to the newest). */
export const ZENODO_URL = 'https://zenodo.org/records/22895043';
export const ZENODO_DOI = '10.5281/zenodo.22895043';
export const ZENODO_CONCEPT_DOI = '10.5281/zenodo.22179415';
export const PAPER_TITLE =
  'Capability-Mediated Perimeters for Secure AI Agent Tool Execution';
export const PAPER_SUBTITLE =
  'Conditional Non-Escalation Invariants and Empirical Evaluation Against Indirect Prompt Injection';
/** The edition the site cites (the newest Zenodo record carries a date, not a version number). */
export const PAPER_VERSION = 'September 2026';
export const SSRN_PAPER_URL = 'https://papers.ssrn.com/sol3/papers.cfm?abstract_id=7505299';
export const SSRN_ABSTRACT_ID = '7505299';
export const PAPER_PDF_URL = 'https://zenodo.org/api/records/22895043/files/mastyf_guard_1.5B.pdf/content';
/** Same-origin copy of that PDF (byte-identical to the Zenodo file); the research page renders it. */
export const PAPER_LOCAL_PDF_PATH = '/paper/mastyf-guard.pdf';
export const PAPER_BIBTEX = `@misc{das2026capability,
  title={${PAPER_TITLE}: ${PAPER_SUBTITLE}},
  author={Das, Rudraneel},
  publisher={Zenodo},
  note={Preprint, ${PAPER_VERSION}},
  year={2026},
  doi={${ZENODO_DOI}},
  url={https://doi.org/${ZENODO_DOI}}
}`;
/** Working Lemon storefront (bare /checkout and old buy UUIDs 404). */
export const LEMON_STORE_URL = 'https://mastyfai.lemonsqueezy.com/';
export const HF_CHECKOUT_URL = LEMON_STORE_URL;
export const CONTACT_EMAIL = 'mastyf.support@gmail.com';
export const SHIELD_DOWNLOAD_PATH = '/download';

export const RESEARCH_SQUARE_PAPER_URL = 'https://doi.org/10.21203/rs.3.rs-10889863/v1';

/** The founder's Mastyf papers, newest first; the research page lists them under the reader. */
export interface Paper {
  title: string;
  date: string;
  summary: string;
  links: { label: string; href: string }[];
}

export const PAPERS: Paper[] = [
  {
    title: 'Capability-Mediated Perimeters for Secure AI Agent Tool Execution',
    date: 'September 2026',
    summary:
      'Conditional non-escalation invariants for an externally enforced execution perimeter, and an empirical evaluation against indirect prompt injection. The paper in the reader above.',
    links: [
      { label: 'Zenodo', href: ZENODO_URL },
      { label: 'Research Square', href: RESEARCH_SQUARE_PAPER_URL },
      { label: 'SSRN', href: SSRN_PAPER_URL },
    ],
  },
  {
    title:
      'Mastyf Guard 1.5B: Cognitive Harvard Architectures for Sub-Millisecond AI Agent Perimeter Defense and Capability-Based Access Control',
    date: 'September 2026',
    summary:
      'Decoupling data ingestion from privileged tool execution through a capability-mediated perimeter, with a proof of deterministic non-interference and an evaluation on 50,000 samples against Llama Guard 3 and Prompt Guard.',
    links: [{ label: 'Research Square', href: 'https://doi.org/10.21203/rs.3.rs-10868139/v1' }],
  },
];
