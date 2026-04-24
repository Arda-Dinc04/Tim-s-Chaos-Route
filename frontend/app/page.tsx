"use client";

import dynamic from "next/dynamic";

const BikeRouterMap = dynamic(() => import("./bike-router-map"), {
  ssr: false,
  loading: () => (
    <main className="grid h-screen place-items-center bg-[#f4f1e8] text-[#151515]">
      <p className="text-sm font-semibold uppercase tracking-[0.18em]">
        Loading map
      </p>
    </main>
  ),
});

export default function Home() {
  return <BikeRouterMap />;
}
