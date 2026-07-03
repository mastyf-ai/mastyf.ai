import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';

export default async function PostLoginPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect('/login');
  }
  redirect('/dashboard');
}
