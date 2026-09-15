import { cn } from "@/lib/utils";

/** A light pulse that travels around the parent's border. Parent needs `relative` + `overflow-hidden`. */
export function BorderBeam({
  className,
  color = "#ffffff",
  duration = 9,
  size = 220,
}: {
  className?: string;
  color?: string;
  duration?: number;
  size?: number;
}) {
  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-0 rounded-[inherit] [mask-clip:padding-box,border-box] [mask-composite:intersect] [mask-image:linear-gradient(transparent,transparent),linear-gradient(#000,#000)] border border-transparent",
        className,
      )}
    >
      <div
        className="absolute aspect-square animate-beam"
        style={
          {
            width: size,
            offsetPath: `rect(0 auto auto 0 round ${size}px)`,
            "--beam-duration": `${duration}s`,
            background: `linear-gradient(to left, ${color}, ${color}66, transparent)`,
          } as React.CSSProperties
        }
      />
    </div>
  );
}
