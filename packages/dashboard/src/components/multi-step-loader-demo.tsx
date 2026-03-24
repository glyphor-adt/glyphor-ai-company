"use client";

import React, { useState } from "react";
import { MultiStepLoader as Loader } from "@/components/ui/multi-step-loader";
import { MdClose } from "react-icons/md";

const loadingStates = [
  { text: "Caffeinating the research agents" },
  { text: "Asking the hard questions nobody asked" },
  { text: "Stalking your competitors (legally)" },
  { text: "Reading every press release so you don't have to" },
  { text: "Finding the pricing pages they tried to hide" },
  { text: "Translating corporate speak into English" },
  { text: "Counting their job postings for clues" },
  { text: "Following the money trail" },
  { text: "Noticing what they're NOT saying" },
  { text: "Separating signal from hype" },
  { text: "Catching someone's math not mathing" },
  { text: "Fact-checking the thought leaders" },
  { text: "Mapping who's actually a threat vs. vibes" },
  { text: "Finding the gaps nobody's filling" },
  { text: "Arguing with ourselves for quality" },
  { text: "Triangulating so hard right now" },
  { text: "Making charts you'll actually want to read" },
  { text: "Writing the part where you look brilliant" },
  { text: "One last sanity check..." },
  { text: "Your briefing is ready, boss" },
];

export default function MultiStepLoaderDemo() {
  const [loading, setLoading] = useState(false);

  return (
    <div className="flex h-[60vh] w-full items-center justify-center">
      <Loader loadingStates={loadingStates} loading={loading} duration={2000} />

      <button
        onClick={() => setLoading(true)}
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
          onClick={() => setLoading(false)}
        >
          <MdClose className="h-10 w-10" />
        </button>
      )}
    </div>
  );
}
