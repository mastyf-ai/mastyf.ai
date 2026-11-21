import Image from 'next/image';
import Link from 'next/link';

/** The Mastyf mark at the top of the docs rail, as on the dashboard's sidebar. Wide screens only. */
export function RailBrand() {
  return (
    <Link href="/" className="docs__brand" aria-label="Mastyf home">
      <Image src="/brand/mark-64.png" alt="" width={26} height={26} className="brand-mark" />
      <span>mastyf.ai</span>
    </Link>
  );
}
