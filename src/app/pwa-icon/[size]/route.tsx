import { ImageResponse } from "next/og";
import { AppIcon } from "@/components/AppIcon";

export async function GET(_: Request, ctx: RouteContext<"/pwa-icon/[size]">) {
  const { size } = await ctx.params;
  const px = Math.min(1024, Math.max(16, Number(size) || 512));
  return new ImageResponse(<AppIcon size={px} />, { width: px, height: px });
}
