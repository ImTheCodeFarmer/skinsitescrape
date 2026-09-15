"use client";

import { motion, type HTMLMotionProps } from "motion/react";

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06, delayChildren: 0.05 } },
};
const item = {
  hidden: { opacity: 0, y: 12, filter: "blur(4px)" },
  show: {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transition: { type: "spring" as const, stiffness: 160, damping: 22 },
  },
};

export function Stagger(props: HTMLMotionProps<"div">) {
  return <motion.div variants={container} initial="hidden" animate="show" {...props} />;
}

export function Reveal(props: HTMLMotionProps<"div">) {
  return <motion.div variants={item} {...props} />;
}
