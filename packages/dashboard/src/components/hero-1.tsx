"use client";

import { ArrowRight, Play } from "lucide-react";
import { motion } from "motion/react";

export function Hero1() {
  return (
    <section className="w-full flex items-start lg:items-center py-12 px-4 sm:px-6 lg:px-8 bg-base">
      <div className="max-w-[1400px] mx-auto w-full">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-12 xl:gap-16 items-center">
          {/* Left Column - Content */}
          <div className="flex flex-col space-y-6 sm:space-y-8">
            {/* Announcement Pill */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.1 }}
              className="flex w-fit cursor-pointer items-center gap-2 rounded-full border border-border p-1 transition-colors hover:border-border-hover sm:gap-3"
            >
              <span className="inline-flex items-center rounded-full bg-cyan/20 px-3 py-1 text-xs font-medium text-cyan sm:text-sm">
                New
              </span>
              <span className="mr-2 text-sm text-txt-primary sm:text-base">
                AI-powered design systems
              </span>
            </motion.div>

            {/* Main Headline */}
            <motion.h1
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.2 }}
              className="text-2xl font-medium leading-[1.15] tracking-tight text-txt-primary sm:text-3xl md:text-4xl lg:text-5xl"
            >
              Transform your product with intelligent design
            </motion.h1>

            {/* Sub-headline */}
            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.3 }}
              className="max-w-lg text-base leading-relaxed tracking-tight text-txt-secondary sm:text-lg"
            >
              Get component libraries, design tokens, and expert tooling. Ship
              your design systems faster & smarter.
            </motion.p>

            {/* CTA Buttons */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.4 }}
              className="flex flex-col sm:flex-row items-start sm:items-center gap-3 sm:gap-4"
            >
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className="w-full cursor-pointer rounded-full bg-cyan px-6 py-2.5 text-sm font-medium text-white transition-opacity duration-200 hover:opacity-90 sm:w-auto sm:text-base"
              >
                Start Building
              </motion.button>
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className="group flex w-full cursor-pointer items-center justify-center gap-2 rounded-full border border-border py-2.5 pl-5 pr-3 text-sm font-medium text-txt-primary transition-colors duration-200 hover:bg-surface sm:w-auto sm:text-base"
              >
                Watch Demo
                <motion.span
                  className="flex h-6 w-6 items-center justify-center rounded-full bg-cyan"
                  whileHover={{ rotate: 90 }}
                  transition={{ duration: 0.3 }}
                >
                  <Play className="h-3 w-3 fill-white" />
                </motion.span>
              </motion.button>
            </motion.div>

            {/* Social Proof */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.5 }}
              className="flex items-center gap-3 sm:gap-4 pt-2 sm:pt-4 select-none"
            >
              {/* User Avatars */}
              <div className="flex -space-x-2">
                <div className="flex h-10 w-10 items-center justify-center rounded-full border-4 border-base bg-cyan/25 text-xs font-semibold text-cyan sm:h-12 sm:w-12 sm:text-sm">
                  JD
                </div>
                <div className="flex h-10 w-10 items-center justify-center rounded-full border-4 border-base bg-cyan/25 text-xs font-semibold text-cyan sm:h-12 sm:w-12 sm:text-sm">
                  SK
                </div>
                <div className="flex h-10 w-10 items-center justify-center rounded-full border-4 border-base bg-cyan/25 text-xs font-semibold text-cyan sm:h-12 sm:w-12 sm:text-sm">
                  AL
                </div>
              </div>

              {/* Social Proof Text */}
              <div className="flex flex-col">
                <span className="text-base font-semibold text-txt-primary sm:text-lg">
                  50k+
                </span>
                <span className="text-xs text-txt-secondary sm:text-sm">
                  Engineers shipping products daily.
                </span>
              </div>
            </motion.div>
          </div>

          {/* Right Column - Visual Content */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.6, delay: 0.3 }}
            className="relative w-full h-auto"
          >
            <div className="relative h-full min-h-[250px] w-full overflow-hidden rounded-4xl bg-surface transition-colors hover:bg-raised sm:min-h-[500px]">
              <img
                src="https://images.unsplash.com/photo-1553877522-43269d4ea984?q=80&w=1740&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D"
                alt="Visual content placeholder"
                className="absolute inset-0 w-full h-full object-cover"
              />

              {/* Decorative Circle */}
              <div className="absolute bottom-0 right-0 flex flex-col items-end">
                <svg
                  width="40"
                  height="40"
                  viewBox="0 0 200 200"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M0 200C155.996 199.961 200.029 156.308 200 0V200H0Z"
                    className="fill-base"
                  />
                </svg>

                <div className="relative">
                  <div className="h-24 w-24 rounded-tl-4xl bg-base pl-4 pt-4">
                    <button
                      type="button"
                      className="flex h-full w-full cursor-pointer items-center justify-center rounded-[1.2em] border border-border bg-cyan transition-opacity hover:opacity-90"
                    >
                      <ArrowRight className="h-6 w-6 -rotate-45 text-white" />
                    </button>
                  </div>

                  {/* Bottom Left SVG */}
                  <svg
                    width="40"
                    height="40"
                    viewBox="0 0 200 200"
                    xmlns="http://www.w3.org/2000/svg"
                    className="absolute bottom-0 -left-10"
                  >
                    <path
                      d="M0 200C155.996 199.961 200.029 156.308 200 0V200H0Z"
                      className="fill-base"
                    />
                  </svg>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
