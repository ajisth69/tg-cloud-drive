import { useState, useRef, useEffect } from "react";
import { Button } from "../ui/Button";

interface OtpStepProps {
  phone: string;
  loading: boolean;
  error: string | null;
  onSubmit: (code: string) => void;
}

export function OtpStep({ phone, loading, error, onSubmit }: OtpStepProps) {
  const [digits, setDigits] = useState<string[]>(Array(5).fill(""));
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    inputRefs.current[0]?.focus();
  }, []);

  const handleChange = (index: number, value: string) => {
    if (!/^\d?$/.test(value)) return;

    const newDigits = [...digits];
    newDigits[index] = value;
    setDigits(newDigits);

    if (value && index < 4) {
      inputRefs.current[index + 1]?.focus();
    }

    if (value && index === 4) {
      const code = newDigits.join("");
      if (code.length === 5) {
        onSubmit(code);
      }
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 5);
    const newDigits = [...digits];
    for (let i = 0; i < pasted.length; i++) {
      newDigits[i] = pasted[i];
    }
    setDigits(newDigits);
    if (pasted.length === 5) {
      onSubmit(pasted);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const code = digits.join("");
    if (code.length === 5) {
      onSubmit(code);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6 animate-slide-up">
      <div className="text-center space-y-2 mb-8">
        <div className="w-12 h-12 mx-auto rounded-2xl bg-md-tertiary-container flex items-center justify-center mb-4 text-md-on-tertiary-container">
          <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.57-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
          </svg>
        </div>
        <h2 className="text-xl sm:text-2xl font-semibold text-md-on-surface tracking-tight">
          Verify Identity
        </h2>
        <p className="text-md-on-surface-variant text-sm">
          Enter the 5-digit code sent to
        </p>
        <p className="text-md-primary text-sm font-semibold font-mono tracking-wide">{phone}</p>
      </div>

      {/* OTP input boxes — M3 outlined field spec */}
      <div className="flex justify-center gap-2.5 sm:gap-3" onPaste={handlePaste}>
        {digits.map((digit, i) => (
          <input
            key={i}
            ref={(el) => {
              inputRefs.current[i] = el;
            }}
            type="text"
            inputMode="numeric"
            maxLength={1}
            value={digit}
            onChange={(e) => handleChange(i, e.target.value)}
            onKeyDown={(e) => handleKeyDown(i, e)}
            className="w-12 h-14 text-center text-2xl font-semibold bg-md-surface-container-lowest border-2 border-md-outline-variant rounded-xl text-md-on-surface focus:outline-none focus:border-md-primary focus:ring-2 focus:ring-md-primary/15 transition-all duration-200 font-mono"
          />
        ))}
      </div>

      {error && (
        <p className="text-md-error text-xs sm:text-sm text-center font-medium animate-pulse-slow">{error}</p>
      )}

      <Button type="submit" loading={loading} className="w-full mt-2" size="lg">
        Submit Code
      </Button>
    </form>
  );
}
