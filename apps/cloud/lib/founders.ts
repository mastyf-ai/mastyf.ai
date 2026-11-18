/**
 * The people on the Founders page. Edit this list to change the page: each entry is one card.
 * `photo` is a path under /public (e.g. '/founders/name.jpg'); leave it out to show initials.
 * The entries below are placeholders until the content is decided.
 */
export interface Founder {
  name: string;
  role: string;
  bio: string;
  photo?: string;
  links?: { label: string; href: string }[];
  /** True while the entry is a placeholder; the page marks it so it can't pass for real content. */
  placeholder?: boolean;
}

export const FOUNDERS_INTRO =
  'Mastyf Labs is building the security layer for AI agents: every tool call checked before it runs. These are the people who started it.';

export const FOUNDERS: Founder[] = [
  {
    name: 'Founder name',
    role: 'Role to be added',
    bio: 'A short paragraph about this founder: background, what they work on at Mastyf, and why they started it.',
    placeholder: true,
  },
  {
    name: 'Founder name',
    role: 'Role to be added',
    bio: 'A short paragraph about this founder: background, what they work on at Mastyf, and why they started it.',
    placeholder: true,
  },
  {
    name: 'Founder name',
    role: 'Role to be added',
    bio: 'A short paragraph about this founder: background, what they work on at Mastyf, and why they started it.',
    placeholder: true,
  },
];

/** Up to two initials, for a card without a photo. */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
}
