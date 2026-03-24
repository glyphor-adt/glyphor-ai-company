"use client";

import React from 'react';
import { cn } from "@/lib/utils";
import { AnimatePresence, motion } from "motion/react";
import { MdCheckCircle, MdRadioButtonUnchecked } from 'react-icons/md';
import type { LoadingState } from './multi-step-loader-states';

interface MultiStepLoaderProps {
  states: LoadingState[];
  currentStep: number;
  loading: boolean;
  isComplete?: boolean;
  isHolding?: boolean;
  elapsed?: number;
}

export function MultiStepLoader({
  states,
  currentStep,
  loading,
  isComplete = false,
  isHolding = false,
  elapsed = 0,
}: MultiStepLoaderProps) {
  if (!loading) return null;

  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-md">
      <div className="relative mx-4 w-full max-w-md">
        <div className="mb-8 h-0.5 w-full overflow-hidden rounded-full bg-white/5">
          <motion.div
            className="h-full rounded-full"
            style={{
              background: 'linear-gradient(90deg, #00E0FF, #00A3FF)',
              boxShadow: '0 0 10px rgba(0, 224, 255, 0.4)',
            }}
            animate={{
              width: isHolding || isComplete ? '100%' : `${((currentStep + 1) / states.length) * 100}%`,
            }}
            transition={{ duration: 0.8, ease: 'easeInOut' }}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <AnimatePresence mode="popLayout">
            {states.map((state, i) => {
              const done = i < currentStep;
              const current = i === currentStep;
              const visible = i <= currentStep + 1;

              if (!visible) return null;

              return (
                <motion.div
                  key={`${i}-${state.text}`}
                  initial={{ opacity: 0, x: 8 }}
                  animate={{ opacity: done ? 0.4 : current ? 1 : 0.2, x: 0 }}
                  exit={{ opacity: 0, x: -8 }}
                  transition={{ duration: 0.4 }}
                  className="flex items-center gap-3 pl-1"
                >
                  {done ? (
                    <MdCheckCircle className="shrink-0 text-[#00E0FF]" size={20} />
                  ) : current ? (
                    <MdCheckCircle
                      className={cn('shrink-0', isComplete ? 'text-[#6EE7B7]' : 'text-[#6EE7B7]/60')}
                      size={20}
                    />
                  ) : (
                    <MdRadioButtonUnchecked className="shrink-0 text-neutral-600" size={20} />
                  )}
                  <span
                    className={cn(
                      'text-[15px] transition-colors duration-300',
                      current
                        ? 'font-medium text-neutral-200'
                        : done
                          ? 'text-neutral-500'
                          : 'text-neutral-600',
                    )}
                  >
                    {state.text}
                  </span>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>

        <div className="mt-6 flex items-center justify-between px-1">
          <span className="text-xs font-mono tracking-wider text-neutral-600">
            {currentStep + 1} / {states.length}
            {isHolding && <span className="ml-2 text-[#00E0FF]/40">- still working</span>}
          </span>
          <span className="text-xs font-mono tracking-wider text-neutral-600">
            {minutes}:{seconds.toString().padStart(2, '0')}
          </span>
        </div>
      </div>
    </div>
  );
}
