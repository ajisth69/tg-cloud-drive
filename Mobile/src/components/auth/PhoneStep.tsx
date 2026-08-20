import React, { useState } from "react";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";

interface PhoneStepProps {
  loading: boolean;
  error: string | null;
  onSubmit: (phone: string) => void;
  onBack: () => void;
}

export function PhoneStep({ loading, error, onSubmit, onBack }: PhoneStepProps) {
  const [phone, setPhone] = useState("");
  const [validationError, setValidationError] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = phone.replace(/[\s()-]/g, "");

    if (!cleaned.startsWith("+")) {
      setValidationError("Phone number must start with a country code (e.g. +91)");
      return;
    }
    if (cleaned.length < 10 || cleaned.length > 16) {
      setValidationError("Enter a valid international phone number");
      return;
    }

    setValidationError("");
    onSubmit(cleaned);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6 sm:space-y-8 animate-slide-up">
      <div className="text-center space-y-2">
        <div className="w-12 h-12 mx-auto rounded-2xl bg-md-primary-container flex items-center justify-center mb-3 text-md-on-primary-container">
          <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 1.5H8.25A2.25 2.25 0 006 3.75v16.5a2.25 2.25 0 002.25 2.25h7.5A2.25 2.25 0 0018 20.25V3.75a2.25 2.25 0 00-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-6 15h9" />
          </svg>
        </div>
        <h2 className="text-2xl font-semibold text-md-on-surface tracking-tight">Connect Account</h2>
        <p className="text-md-on-surface-variant text-sm">
          Access your cloud drive using your Telegram session
        </p>
      </div>

      {/* Form Error Alert — M3 error-container */}
      {(error || validationError) && (
        <div className="flex gap-3 bg-md-error-container border border-md-error/20 rounded-2xl p-4 text-xs text-md-on-error-container font-medium leading-relaxed">
          <svg className="w-5 h-5 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <div className="flex-1">{validationError || error}</div>
        </div>
      )}

      {/* Connection Input */}
      <div className="space-y-4">
        <Input
          label="Phone Number"
          type="tel"
          placeholder="+91 XXXXX XXXXX"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          autoFocus
          icon={
            <svg className="w-4 h-4 text-md-on-surface-variant" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
            </svg>
          }
        />
      </div>

      <div className="flex gap-3">
        <Button
          type="button"
          variant="secondary"
          onClick={onBack}
          disabled={loading}
          className="flex-1 select-none cursor-pointer"
          size="lg"
        >
          Back
        </Button>
        <Button
          type="submit"
          loading={loading}
          className="flex-[2] select-none cursor-pointer"
          size="lg"
        >
          Connect & Send
        </Button>
      </div>

      <p className="text-[11px] text-md-on-surface-variant text-center leading-relaxed select-none">
        We will send a secure verification code to your Telegram app.
        <br />
        Session credentials are saved locally in this browser.
      </p>
    </form>
  );
}
