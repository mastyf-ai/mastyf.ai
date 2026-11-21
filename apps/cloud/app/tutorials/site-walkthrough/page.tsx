import Link from 'next/link';
import { resolveSiteUrl } from '@/lib/site-url';
import '../../certified/certified.css';

export const metadata = {
  title: 'Tutorial — mastyf.ai website walkthrough | mastyf.ai',
  description:
    'Walkthrough: explore mastyf.ai, look up an MCP package, and fetch live security scores in real time.',
};

export default function SiteWalkthroughTutorialPage() {
  const base = resolveSiteUrl();
  return (
    <main className="socket-main" style={{ paddingTop: '2rem', maxWidth: 900, margin: '0 auto' }}>
      <p className="socket-breadcrumb">
        <Link href="/certified">Security scores</Link> / Tutorial
      </p>
      <h1 className="socket-pkg-title">mastyf.ai website walkthrough</h1>
      <p className="certified-lead" style={{ marginBottom: '1.5rem' }}>
        ~2 minute tour: landing page, architecture, live lookup for <code>@playwright/mcp</code>, full
        score report, and the JSON badge API. Record voiceover with{' '}
        <a href="https://wisprflow.ai" rel="noopener noreferrer">
          Wispr Flow
        </a>{' '}
        using the{' '}
        <a
          href="https://github.com/mastyf-ai/mastyf.ai/blob/main/docs/tutorials/site-walkthrough-video-script.md"
          rel="noopener noreferrer"
        >
          narration script
        </a>
        .
      </p>
      <video
        controls
        playsInline
        preload="metadata"
        style={{ width: '100%', borderRadius: 12, background: '#0a0a0a' }}
        poster="/assets/security-swarm-architecture.png"
      >
        <source src="/tutorials/site-walkthrough-demo.webm" type="video/webm" />
        <source src="/tutorials/site-walkthrough-with-voiceover.webm" type="video/webm" />
        Your browser does not support WebM video.{' '}
        <a href="/tutorials/site-walkthrough-demo.webm">Download the tutorial</a>.
      </video>
      <p className="certified-meta" style={{ marginTop: '1rem' }}>
        Direct link:{' '}
        <a href="/tutorials/site-walkthrough-demo.webm">/tutorials/site-walkthrough-demo.webm</a>
        {' · '}
        <Link href="/certified">Try it yourself</Link>
      </p>
      <pre className="badge-embed-code" style={{ marginTop: '1.5rem', fontSize: '0.8rem' }}>
        {`curl -s "${base}/api/v1/badge/@playwright%2Fmcp/json"`}
      </pre>
    </main>
  );
}
