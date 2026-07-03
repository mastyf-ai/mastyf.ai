import { CertifiedShell } from '@/components/CertifiedShell';
import '../landing.css';

type Props = { children: React.ReactNode };

export default function CertifiedLayout({ children }: Props) {
  return <CertifiedShell>{children}</CertifiedShell>;
}
