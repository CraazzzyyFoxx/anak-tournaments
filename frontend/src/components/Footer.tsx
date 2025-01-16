import React from "react";
import Link from "next/link";

export function Footer() {
  return (
    <footer className="text-white py-8">
      <div className="grid grid-cols-1 md:grid-cols-5 gap-8">
        <div className="col-span-3">
          <p className="text-xl font-bold mb-4">Anakq Tournaments</p>
          <p className="text-sm">
            Anakq Tournaments is not affiliated with or endorsed by Blizzard Entertainment, Inc.
          </p>
          {/*<p className="text-sm mt-2">*/}
          {/*  AQT is the number one Anak tournaments tracking platform.*/}
          {/*</p>*/}
          {/*<p className="text-sm mt-4">© AQT 2025</p>*/}
        </div>
        {/*<div>*/}
        {/*  <p className="text-xl font-bold mb-4">Links</p>*/}
        {/*  <Link href="/contact" className="block text-sm mb-2">Contact</Link>*/}
        {/*  <Link href="/privacy-policy" className="block text-sm mb-2">Privacy Policy</Link>*/}
        {/*  <Link href="/resources" className="block text-sm mb-2">Resources</Link>*/}
        {/*</div>*/}
        {/*<div>*/}
        {/*  <p className="text-xl font-bold mb-4">Resources</p>*/}
        {/*  <Link href="/get-deadlock-invite" className="block text-sm mb-2">Get Deadlock Invite</Link>*/}
        {/*  <Link href="/deadlock-hero-tier-list" className="block text-sm mb-2">Deadlock Hero Tier List</Link>*/}
        {/*  <Link href="/changelog" className="block text-sm mb-2">ChangeLog</Link>*/}
        {/*</div>*/}
      </div>
    </footer>
  );
}
