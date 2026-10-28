import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { vapidKeys } from "@/lib/push";

export async function GET() {
  return NextResponse.json({ publicKey: vapidKeys().publicKey });
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Non connecté" }, { status: 401 });
  const sub = (await request.json()) as { endpoint: string; keys: { p256dh: string; auth: string } };
  db.insert(schema.pushSubscriptions)
    .values({ userId: user.id, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth })
    .onConflictDoUpdate({
      target: schema.pushSubscriptions.endpoint,
      set: { userId: user.id, p256dh: sub.keys.p256dh, auth: sub.keys.auth },
    })
    .run();
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  if (!(await getCurrentUser())) return NextResponse.json({ error: "Non connecté" }, { status: 401 });
  const { endpoint } = (await request.json()) as { endpoint: string };
  db.delete(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.endpoint, endpoint)).run();
  return NextResponse.json({ ok: true });
}
