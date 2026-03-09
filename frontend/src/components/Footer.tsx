import React from "react";
import Link from "next/link";
import Github from "@/components/icons/Github";
import { SITE_NAME } from "@/config/site";

export function Footer() {
  return (
    <footer className="text-white py-8">
      <div className="flex gap-8 justify-between px-4">
        <div className="col-span-3">
          <p className="text-xl font-bold mb-4">{SITE_NAME}</p>
          <p className="text-sm">
            {SITE_NAME} is not affiliated with or endorsed by Blizzard Entertainment, Inc.
          </p>
        </div>
        <Link href={"https://github.com/CraazzzyyFoxx/anak-tournaments"}>
          <Github />
        </Link>
      </div>
    </footer>
  );
}
