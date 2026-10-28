/** Icône de l'app (rendue en PNG par ImageResponse). */
export function AppIcon({ size }: { size: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "linear-gradient(135deg, #14b8a6 0%, #0f766e 100%)",
        color: "white",
        fontSize: size * 0.56,
        fontWeight: 700,
        fontFamily: "sans-serif",
      }}
    >
      €
    </div>
  );
}
