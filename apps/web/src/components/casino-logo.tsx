import Image from "next/image";
import { cn } from "@/lib/utils";
import type { CasinoMeta } from "@/lib/types";

export function CasinoLogo({
  casino,
  size = 32,
  className,
}: {
  casino: Pick<CasinoMeta, "logo" | "name" | "color">;
  size?: number;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-lg border border-white/8 bg-white/[0.04]",
        className,
      )}
      style={{ width: size, height: size, boxShadow: `inset 0 0 0 1px ${casino.color}22` }}
    >
      <Image
        src={casino.logo}
        alt={`${casino.name} logo`}
        width={size}
        height={size}
        className="object-contain p-1"
        style={{ width: size, height: size }}
        unoptimized
      />
    </span>
  );
}
