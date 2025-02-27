"use client";

import React from "react";
import { SignedOut, SignInButton } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";
import Image from "next/image";

const LoginButton = () => {
  return (
    <SignedOut>
      <Button className="bg-[#5865f2] text-white text-md">
        <Image
          className="text-white"
          src="/discord-blue.svg"
          alt="discord"
          width="32"
          height="32"
        />
        <SignInButton />
      </Button>
    </SignedOut>
  );
};

export default LoginButton;
