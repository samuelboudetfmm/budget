import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { imageDir } from "@/lib/wishlist";

const TYPES: Record<string, string> = { png: "image/png", webp: "image/webp", gif: "image/gif", jpg: "image/jpeg" };

export async function GET(_: Request, ctx: RouteContext<"/api/wishlist/image/[id]">) {
  if (!(await getCurrentUser())) return new Response(null, { status: 401 });
  const { id } = await ctx.params;
  const item = db.select().from(schema.wishlistItems).where(eq(schema.wishlistItems.id, Number(id))).get();
  if (!item?.image) return new Response(null, { status: 404 });
  const file = path.join(imageDir(), path.basename(item.image));
  if (!fs.existsSync(file)) return new Response(null, { status: 404 });
  return new Response(fs.readFileSync(file), {
    headers: {
      "Content-Type": TYPES[item.image.split(".").pop() ?? ""] ?? "image/jpeg",
      "Cache-Control": "private, max-age=86400",
    },
  });
}
