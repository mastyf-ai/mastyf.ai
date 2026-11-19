import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  eslint: { ignoreDuringBuilds: true },
  serverExternalPackages: ['better-sqlite3', 'pino'],
  async redirects() {
    // The Platform page was retired; its content lives in the docs.
    return [{ source: '/platform', destination: '/docs/how-it-works', permanent: true }];
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Content-Security-Policy',
            // Razorpay Checkout loads its script from checkout.razorpay.com and renders the payment
            // form in an iframe from api.razorpay.com (components/billing/RazorpayCheckoutButton.tsx).
            value: "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://checkout.razorpay.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https:; frame-src https://api.razorpay.com https://checkout.razorpay.com; frame-ancestors 'none'",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
