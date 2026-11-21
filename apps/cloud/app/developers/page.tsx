import { permanentRedirect } from 'next/navigation';

/**
 * The old developer quickstart described the 4.x gateway. Setup now lives in the docs, which start
 * with picking the path for your agent.
 */
export default function DevelopersPage() {
  permanentRedirect('/docs/getting-started');
}
