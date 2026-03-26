import { useEffect, useRef, useState } from 'react';
import {
  COMPLETE_STATE,
  HOLD_STATES,
  LOADER_STATES,
  type LoaderTier,
  type LoadingState,
} from '@/components/ui/multi-step-loader-states';

interface UseAsyncLoaderOptions {
  tier: LoaderTier;
  loading: boolean;
  complete: boolean;
  /** Optional wallclock start time — elapsed will be derived from this so it survives remounts. */
  startedAt?: string | null;
}

interface UseAsyncLoaderReturn {
  currentStep: number;
  states: LoadingState[];
  isHolding: boolean;
  isComplete: boolean;
  elapsed: number;
}

function getStepDuration(index: number, totalMain: number): number {
  const progress = index / totalMain;
  if (progress < 0.4) return 4000;
  if (progress < 0.65) return 8000;
  if (progress < 0.85) return 15000;
  return 25000;
}

const HOLD_INTERVAL = 12000;

export function useAsyncLoader({ tier, loading, complete, startedAt }: UseAsyncLoaderOptions): UseAsyncLoaderReturn {
  const mainStates = LOADER_STATES[tier];
  const [step, setStep] = useState(0);
  const [phase, setPhase] = useState<'main' | 'hold' | 'complete'>('main');
  const [holdIndex, setHoldIndex] = useState(0);
  const [elapsed, setElapsed] = useState(() => {
    if (startedAt) {
      return Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000));
    }
    return 0;
  });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const elapsedRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const wasLoadingRef = useRef(loading);

  const states: LoadingState[] =
    phase === 'complete'
      ? [...mainStates, COMPLETE_STATE]
      : phase === 'hold'
        ? [...mainStates, HOLD_STATES[holdIndex]]
        : mainStates;

  const currentStep =
    phase === 'complete'
      ? mainStates.length
      : phase === 'hold'
        ? mainStates.length
        : step;

  useEffect(() => {
    // Only reset when transitioning from not-loading → loading (not on remount while loading)
    if (loading && !complete && !wasLoadingRef.current) {
      setStep(0);
      setPhase('main');
      setHoldIndex(0);
      setElapsed(startedAt ? Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000)) : 0);
    }
    wasLoadingRef.current = loading;
  }, [loading, complete, startedAt]);

  useEffect(() => {
    if (complete && loading) {
      if (timerRef.current) clearTimeout(timerRef.current);
      setPhase('complete');
    }
  }, [complete, loading]);

  useEffect(() => {
    if (loading && !complete) {
      elapsedRef.current = setInterval(() => {
        setElapsed((s) => s + 1);
      }, 1000);
    } else if (elapsedRef.current) {
      clearInterval(elapsedRef.current);
    }

    return () => {
      if (elapsedRef.current) clearInterval(elapsedRef.current);
    };
  }, [loading, complete]);

  useEffect(() => {
    if (!loading || complete) return;

    if (phase === 'main') {
      const duration = getStepDuration(step, mainStates.length);
      timerRef.current = setTimeout(() => {
        if (step < mainStates.length - 1) {
          setStep((s) => s + 1);
        } else {
          setPhase('hold');
          setHoldIndex(0);
        }
      }, duration);
    } else if (phase === 'hold') {
      timerRef.current = setTimeout(() => {
        setHoldIndex((h) => (h + 1) % HOLD_STATES.length);
      }, HOLD_INTERVAL);
    }

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [loading, complete, phase, step, holdIndex, mainStates.length]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (elapsedRef.current) clearInterval(elapsedRef.current);
    };
  }, []);

  return {
    currentStep,
    states,
    isHolding: phase === 'hold',
    isComplete: phase === 'complete',
    elapsed,
  };
}
