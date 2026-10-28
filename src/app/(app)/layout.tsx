import { requireUser } from "@/lib/auth";
import { Nav } from "@/components/Nav";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireUser();
  return (
    <>
      <Nav />
      <main className="mx-auto max-w-5xl px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-28 sm:pt-6 sm:pb-12">{children}</main>
    </>
  );
}
