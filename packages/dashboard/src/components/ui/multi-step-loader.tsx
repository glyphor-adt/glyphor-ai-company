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

  const safeStep = Math.min(Math.max(currentStep, 0), Math.max(states.length - 1, 0));
  const activeState = states[safeStep];

  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;

  return (
    <div className="fixed inset-0 left-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-md md:left-[220px]">
      <div className="relative mx-4 w-full max-w-md">
        <div className="mb-8 h-0.5 w-full overflow-hidden rounded-full bg-white/5">
          <motion.div
            className="h-full rounded-full"
            style={{
              background: 'linear-gradient(90deg, #00E0FF, #00A3FF)',
              boxShadow: '0 0 10px rgba(0, 224, 255, 0.4)',
            }}
            animate={{
              width: isHolding || isComplete ? '100%' : `${((safeStep + 1) / states.length) * 100}%`,
            }}
            transition={{ duration: 0.8, ease: 'easeInOut' }}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <AnimatePresence mode="wait">
            <motion.div
              key={`${safeStep}-${activeState?.text ?? 'step'}`}
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              transition={{ duration: 0.28, ease: 'easeOut' }}
              className="flex items-center gap-3 pl-1"
            >
              {isComplete ? (
                <MdCheckCircle className="shrink-0 text-[#6EE7B7]" size={20} />
              ) : (
                <MdRadioButtonUnchecked className="shrink-0 text-[#00E0FF]" size={20} />
              )}
              <span className={cn('text-[15px] font-medium text-neutral-200 transition-colors duration-300')}>
                {activeState?.text ?? 'Working...'}
              </span>
            </motion.div>
          </AnimatePresence>
        </div>

        <div className="mt-6 flex items-center justify-between px-1">
          <span className="text-xs font-mono tracking-wider text-neutral-600">
            {safeStep + 1} / {states.length}
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
