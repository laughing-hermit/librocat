"use client";

import { REGEXP_ONLY_DIGITS } from "input-otp";
import { Fragment } from "react";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
} from "@/components/ui/input-otp";

/**
 * The emailed sign-in code: eight digits (otpLength in convex/auth.ts), shadcn's InputOTP,
 * as wide as the form's button: two groups of four that share the width, on a phone too.
 */
export function CodeInput({ id = "code", name = "code" }: { id?: string; name?: string }) {
  return (
    <InputOTP
      id={id}
      name={name}
      maxLength={8}
      pattern={REGEXP_ONLY_DIGITS}
      autoComplete="one-time-code"
      required
      containerClassName="w-full"
    >
      {[
        [0, 1, 2, 3],
        [4, 5, 6, 7],
      ].map((group, g) => (
        <Fragment key={group[0]}>
          {g > 0 && <InputOTPSeparator />}
          <InputOTPGroup className="flex-1">
            {group.map((i) => (
              <InputOTPSlot key={i} index={i} className="h-10 flex-1" />
            ))}
          </InputOTPGroup>
        </Fragment>
      ))}
    </InputOTP>
  );
}
