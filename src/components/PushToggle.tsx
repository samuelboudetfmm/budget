"use client";

import { useEffect, useState } from "react";

type Status = "loading" | "unsupported" | "ios-install" | "denied" | "off" | "on";

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function detect(): Promise<Status> {
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone;
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    // Sur iPhone, le push n'existe que pour l'app ajoutée à l'écran d'accueil
    return ios && !standalone ? "ios-install" : "unsupported";
  }
  if (Notification.permission === "denied") return "denied";
  try {
    const reg = await navigator.serviceWorker.ready;
    return (await reg.pushManager.getSubscription()) ? "on" : "off";
  } catch {
    return "off";
  }
}

function usePush() {
  const [status, setStatus] = useState<Status>("loading");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    detect().then((s) => !cancelled && setStatus(s));
    return () => {
      cancelled = true;
    };
  }, []);

  const enable = async () => {
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus(permission === "denied" ? "denied" : "off");
        return;
      }
      const { publicKey } = await fetch("/api/push/subscribe").then((r) => r.json());
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
      await fetch("/api/push/subscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(sub) });
      setStatus("on");
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/push/subscribe", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) });
        await sub.unsubscribe();
      }
      setStatus("off");
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true);
    await fetch("/api/push/test", { method: "POST" }).finally(() => setBusy(false));
  };

  return { status, busy, enable, disable, test };
}

const IOS_HELP = "Sur iPhone : ouvrez ce site dans Safari, touchez Partager puis « Sur l'écran d'accueil », et ouvrez l'app depuis l'icône pour activer les notifications.";

/** Bandeau sur l'accueil tant que les notifications ne sont pas activées sur cet appareil. */
export function PushPrompt() {
  const { status, busy, enable } = usePush();
  if (status === "off")
    return (
      <div className="card flex items-center justify-between gap-3">
        <p className="text-sm">🔔 Recevoir une notification à chaque dépense sur cet appareil ?</p>
        <button className="btn-primary shrink-0" onClick={enable} disabled={busy}>
          Activer
        </button>
      </div>
    );
  if (status === "ios-install") return <div className="card text-sm">📲 {IOS_HELP}</div>;
  return null;
}

/** Réglage complet dans la page Réglages. */
export function PushToggle() {
  const { status, busy, enable, disable, test } = usePush();
  return (
    <div className="space-y-3 text-sm">
      {status === "loading" && <p className="text-muted">…</p>}
      {status === "unsupported" && <p className="text-muted">Ce navigateur ne gère pas les notifications push.</p>}
      {status === "ios-install" && <p>{IOS_HELP}</p>}
      {status === "denied" && (
        <p className="text-danger">Notifications refusées : autorisez-les dans les réglages du navigateur / du téléphone pour ce site.</p>
      )}
      {status === "off" && (
        <button className="btn-primary" onClick={enable} disabled={busy}>
          Activer sur cet appareil
        </button>
      )}
      {status === "on" && (
        <div className="flex flex-wrap gap-2">
          <span className="self-center text-ok">✓ Activées sur cet appareil</span>
          <button className="btn-ghost" onClick={test} disabled={busy}>
            Envoyer un test
          </button>
          <button className="btn-ghost" onClick={disable} disabled={busy}>
            Désactiver
          </button>
        </div>
      )}
    </div>
  );
}
