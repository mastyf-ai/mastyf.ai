import { GITHUB_REPO_URL } from '@/lib/github-links';

/** Public places where Mastyf is listed. npm is left out until the package is published again. */
export type Marketplace = { name: string; href: string; what: string };

export const MARKETPLACES: Marketplace[] = [
  {
    name: 'VS Code Marketplace',
    href: 'https://marketplace.visualstudio.com/items?itemName=MastyfLabs.mastyf-shield',
    what: 'Shield extension for VS Code',
  },
  {
    name: 'Open VSX',
    href: 'https://open-vsx.org/extension/MastyfLabs/mastyf-shield',
    what: 'Shield extension for Cursor, VSCodium and Windsurf',
  },
  {
    name: 'PyPI',
    href: 'https://pypi.org/project/mastyf-ai/',
    what: 'Free Python library: pip install mastyf-ai',
  },
  {
    name: 'GitHub',
    href: GITHUB_REPO_URL,
    what: 'Open source engine and check service',
  },
];
