/**
 * Demo block receipts shown on the home page. Made by Shield's own receipt code with a throwaway key
 * whose private half was never saved; files live in public/receipts/demo.
 */
export type DemoReceipt = { id: string; label: string; json: string; pdf: string };

export const DEMO_RECEIPTS: DemoReceipt[] = [
  {
    id: 'ssh-key',
    label: 'Claude Code reads an SSH key',
    json: 'receipt-1-claude-code-ssh-key.json',
    pdf: 'receipt-1-claude-code-ssh-key.pdf',
  },
  {
    id: 'env-exfil',
    label: 'Cursor sends .env out',
    json: 'receipt-2-cursor-env-exfiltration.json',
    pdf: 'receipt-2-cursor-env-exfiltration.pdf',
  },
  {
    id: 'transfer',
    label: 'Injected money transfer',
    json: 'receipt-3-custom-agent-transfer-funds.json',
    pdf: 'receipt-3-custom-agent-transfer-funds.pdf',
  },
];

export const DEMO_RECEIPT_DIR = '/receipts/demo';
