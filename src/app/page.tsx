"use client";

import { motion } from "framer-motion";
import { ArrowRight, Zap, Shield, TrendingUp, Globe } from "lucide-react";
import Link from "next/link";

const features = [
  {
    icon: Zap,
    title: "Real-Time Signals",
    description: "Scan fresh memecoin pairs across multiple chains every few minutes. Catch runners before the crowd.",
  },
  {
    icon: Shield,
    title: "Tiered Quality Filter",
    description: "A/B/C tier badges filter noise. Only the highest-conviction signals surface to your dashboard.",
  },
  {
    icon: TrendingUp,
    title: "Buy Pressure & Volume",
    description: "Weighted scoring on buy pressure, volume velocity, liquidity, and pair age — not just hype.",
  },
  {
    icon: Globe,
    title: "Multi-Chain Coverage",
    description: "Solana, Base, Ethereum, BSC, and Arbitrum in one place. One dashboard for the entire degen multiverse.",
  },
];

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.08, delayChildren: 0.1 } as const,
  },
} as const;

const item = {
  hidden: { opacity: 0, y: 24 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] } },
} as const;

export default function Home() {
  return (
    <main className="relative z-10">
      {/* Hero */}
      <section className="min-h-[80vh] flex flex-col items-center justify-center px-6 text-center">
        <motion.div variants={container} initial="hidden" animate="show" className="max-w-3xl mx-auto space-y-6">
          <motion.div variants={item} className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-primary text-xs font-medium">
            <Zap size={14} />
            Live memecoin scanner
          </motion.div>
          <motion.h1
            variants={item}
            className="text-5xl sm:text-7xl font-extrabold tracking-tight leading-[0.95]"
          >
            <span className="bg-gradient-to-r from-primary via-accent to-primary bg-clip-text text-transparent">
              DegeneScan
            </span>
          </motion.h1>
          <motion.p variants={item} className="text-lg sm:text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed">
            Surface early degen signals across Solana, Base, Ethereum, BSC, and Arbitrum.
            Tiered A/B/C scoring, buy pressure, and volume velocity — all in one dark, premium dashboard.
          </motion.p>
          <motion.div variants={item} className="flex items-center justify-center gap-4 pt-2">
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-primary text-primary-foreground font-semibold hover:bg-primary/90 transition-colors"
            >
              Open Dashboard
              <ArrowRight size={18} />
            </Link>
            <a
              href="#features"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl glass hover:bg-muted/50 transition-colors text-sm font-medium text-foreground"
            >
              Learn More
            </a>
          </motion.div>
        </motion.div>
      </section>

      {/* Features */}
      <section id="features" className="py-24 px-6">
        <div className="max-w-6xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="text-center mb-16"
          >
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
              <span className="bg-gradient-to-r from-foreground to-muted-foreground bg-clip-text text-transparent">
                Why DegeneScan?
              </span>
            </h2>
            <p className="text-muted-foreground mt-3 max-w-xl mx-auto">
              A scanner built for speed, signal quality, and clarity. No noise. No bloat. Just alpha.
            </p>
          </motion.div>
          <motion.div variants={container} initial="hidden" whileInView="show" viewport={{ once: true }} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {features.map((f, i) => (
              <motion.div key={i} variants={item} className="glass-card glass-card-hover rounded-2xl p-6 flex flex-col gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary/30 to-accent/20 flex items-center justify-center border border-primary/20">
                  <f.icon size={20} className="text-primary" />
                </div>
                <h3 className="font-semibold text-foreground">{f.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{f.description}</p>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-24 px-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="max-w-2xl mx-auto glass-card rounded-3xl p-10 text-center space-y-4"
        >
          <h2 className="text-3xl font-bold tracking-tight">Ready to scan?</h2>
          <p className="text-muted-foreground">
            Jump into the dashboard and start scanning for early memecoin signals.
          </p>
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-primary text-primary-foreground font-semibold hover:bg-primary/90 transition-colors"
          >
            Launch Dashboard
            <ArrowRight size={18} />
          </Link>
        </motion.div>
      </section>
    </main>
  );
}
