"use client";

import React, { useState } from "react";
import { MultiStepLoader as Loader } from "@/components/ui/multi-step-loader";
import { useAsyncLoader } from "@/hooks/useAsyncLoader";
import { MdClose } from "react-icons/md";

export default function MultiStepLoaderDemo() {
  const [loading, setLoading] = useState(false);
  const [complete, setComplete] = useState(false);
  const loader = useAsyncLoader({ tier: "deep", loading, complete });

  async function startDemo() {
    setLoading(true);
    setComplete(false);

    // Simulate long-running async work.
    await new Promise((resolve) => setTimeout(resolve, 12000));

    setComplete(true);
    setTimeout(() => {
      setLoading(false);
      setComplete(false);
    }, 2000);
  }

  return (
    <div className="flex h-[60vh] w-full items-center justify-center">
      <Loader
        states={loader.states}
        currentStep={loader.currentStep}
        loading={loading}
        isComplete={loader.isComplete}
        isHolding={loader.isHolding}
        elapsed={loader.elapsed}
      />

      <button
        onClick={startDemo}
        className="mx-auto flex h-10 items-center justify-center rounded-lg bg-[#39C3EF] px-8 text-sm font-medium text-black transition duration-200 hover:bg-[#39C3EF]/90 md:text-base"
        style={{
          boxShadow:
            "0px -1px 0px 0px #ffffff40 inset, 0px 1px 0px 0px #ffffff40 inset",
        }}
      >
        Click to load
      </button>

      {loading && (
        <button
          className="fixed right-4 top-4 z-[120] text-black dark:text-white"
          onClick={() => {
            setLoading(false);
            setComplete(false);
          }}
        >
          <MdClose className="h-10 w-10" />
        </button>
      )}
    </div>
  );
}
