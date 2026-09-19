"use client";

import * as React from "react";
import { useInView, useMotionValue, useSpring } from "motion/react";
import { cn } from "@/lib/utils";

type Props = {
  value: number;
  format?: (n: number) => string;
  className?: string;
  delay?: number;
};

export function NumberTicker({ value, format, className, delay = 0 }: Props) {
  const ref = React.useRef<HTMLSpanElement>(null);
  const mv = useMotionValue(0);
  const spring = useSpring(mv, { damping: 42, stiffness: 120 });
  const inView = useInView(ref, { once: true, margin: "0px" });
  // Round before formatting so a spring passing through 2.417 never prints decimals:
  // a count of 7 steps 0, 1, 2 … 7 instead of growing extra digits mid-flight.
  const fmt = React.useCallback(
    (n: number) => (format ? format(Math.round(n)) : Math.round(n).toLocaleString("en-US")),
    [format],
  );

  React.useEffect(() => {
    if (!inView) return;
    const t = setTimeout(() => mv.set(value), delay);
    return () => clearTimeout(t);
  }, [inView, value, delay, mv]);

  React.useEffect(() => {
    const unsub = spring.on("change", (v) => {
      if (ref.current) ref.current.textContent = fmt(v);
    });
    return unsub;
  }, [spring, fmt]);

  return (
    <span ref={ref} className={cn("tabular-nums", className)}>
      {fmt(0)}
    </span>
  );
}
