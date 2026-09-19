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
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-lg outline outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10",
        className,
      )}
      style={{ width: size, height: size, background: `color-mix(in oklch, ${casino.color} 9%, transparent)` }}
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
