import { requireUser } from "@/lib/auth";
import { budgetCategories, categoryByCode, computeEnvelopes } from "@/lib/envelopes";
import { listWishes } from "@/lib/wishlist";
import { Wishlist } from "@/components/Wishlist";

export default async function WishlistPage({ searchParams }: PageProps<"/wishlist">) {
  const user = await requireUser();
  const sp = await searchParams;
  const state = computeEnvelopes();
  const cur = state.months.get(state.asOf.slice(0, 7));
  const categories = budgetCategories()
    .filter((c) => c.ownerUserId == null || c.ownerUserId === user.id)
    .map((c) => {
      const env = cur?.get(c.id);
      return { id: c.id, name: c.name, icon: c.icon, free: Math.max(0, env?.remainingToday ?? 0), dailyRate: env?.dailyRate ?? 0 };
    });
  return (
    <Wishlist
      items={listWishes()}
      categories={categories}
      defaultCategoryId={categoryByCode("libre")?.id ?? null}
      openId={Number(sp.open) || undefined}
    />
  );
}
