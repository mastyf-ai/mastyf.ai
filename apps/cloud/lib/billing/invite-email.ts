import type { OutgoingEmail } from '../email';
import { JOIN_CODE_DAYS } from './workspace-seats';

const oneLine = (value: string) => value.replace(/[\r\n]+/g, ' ').trim();

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** The email a person gets when a Team lead adds them. The code is never put in a link. */
export function inviteEmail(input: {
  to: string;
  code: string;
  leadName: string;
  workspace: string;
  siteUrl: string;
}): OutgoingEmail {
  const lead = oneLine(input.leadName) || 'Your team lead';
  const workspace = oneLine(input.workspace) || 'their workspace';
  const link = `${input.siteUrl.replace(/\/$/, '')}/join?email=${encodeURIComponent(input.to)}`;

  const text = [
    `${lead} added you to the ${workspace} workspace on Mastyf.`,
    '',
    `Your join code: ${input.code}`,
    `It works once and expires in ${JOIN_CODE_DAYS} days.`,
    '',
    `1. Download Mastyf Shield: ${link}`,
    '2. Open Shield and choose Join a team.',
    '3. Enter this email address and the code above.',
    '',
    'If you were not expecting this, you can ignore this email.',
  ].join('\n');

  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#1f1f1f">
<p>${escapeHtml(lead)} added you to the <strong>${escapeHtml(workspace)}</strong> workspace on Mastyf.</p>
<p>Your join code:</p>
<p style="font-family:Consolas,Menlo,monospace;font-size:24px;font-weight:bold;letter-spacing:2px">${escapeHtml(input.code)}</p>
<p>It works once and expires in ${JOIN_CODE_DAYS} days.</p>
<ol>
<li><a href="${escapeHtml(link)}">Download Mastyf Shield</a></li>
<li>Open Shield and choose <strong>Join a team</strong>.</li>
<li>Enter this email address and the code above.</li>
</ol>
<p style="color:#6b6b6b">If you were not expecting this, you can ignore this email.</p>
</div>`;

  return { to: input.to, subject: `${lead} added you to ${workspace} on Mastyf`, text, html };
}
