"use client";

import { REGEXP_ONLY_DIGITS } from "input-otp";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
} from "@/components/ui/input-otp";

/** The emailed sign-in code: eight digits (otpLength in convex/auth.ts), shadcn's InputOTP. */
export function CodeInput({ id = "code", name = "code" }: { id?: string; name?: string }) {
  return (
    <InputOTP
      id={id}
      name={name}
      maxLength={8}
      pattern={REGEXP_ONLY_DIGITS}
      autoComplete="one-time-code"
      required
    >
      <InputOTPGroup>
        {[0, 1, 2, 3].map((i) => (
          <InputOTPSlot key={i} index={i} />
        ))}
      </InputOTPGroup>
      <InputOTPSeparator />
      <InputOTPGroup>
        {[4, 5, 6, 7].map((i) => (
          <InputOTPSlot key={i} index={i} />
        ))}
      </InputOTPGroup>
    </InputOTP>
  );
}
