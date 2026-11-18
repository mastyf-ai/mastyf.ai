import { permanentRedirect } from 'next/navigation';

/** The page moved into Funding and support; the old address keeps working. */
export default function IitKharagpurMoved() {
  permanentRedirect('/funding#iit-kharagpur');
}
