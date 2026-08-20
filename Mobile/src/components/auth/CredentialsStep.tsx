import React, { useState } from "react";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";

interface CredentialsStepProps {
  loading: boolean;
  error: string | null;
  onSubmit: (apiId: number, apiHash: string) => void;
}

export function CredentialsStep({ loading, error, onSubmit }: CredentialsStepProps) {
  const [apiId, setApiId] = useState("");
  const [apiHash, setApiHash] = useState("");
  const [validationError, setValidationError] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!apiId.trim()) {
      setValidationError("Telegram API ID is required");
      return;
    }
    const parsedApiId = parseInt(apiId.trim(), 10);
    if (isNaN(parsedApiId) || parsedApiId <= 0) {
      setValidationError("Enter a valid Telegram API ID (numeric)");
      return;
    }

    if (!apiHash.trim()) {
      setValidationError("Telegram API Hash is required");
      return;
    }
    if (apiHash.trim().length !== 32) {
      setValidationError("Telegram API Hash must be exactly 32 characters");
      return;
    }

    setValidationError("");
    onSubmit(parsedApiId, apiHash.trim());
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-5 animate-slide-up">
      <div className="text-center space-y-1">
        <div className="w-12 h-12 mx-auto rounded-2xl bg-md-primary-container flex items-center justify-center mb-2 text-md-on-primary-container">
          <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.57-.598-3.751h-.152c-3.196 0-6.1-1.249-8.25-3.286zm0 0v1.5m0 9.75h.008v.008H12v-.008z" />
          </svg>
        </div>
        <h2 className="text-xl sm:text-2xl font-semibold text-md-on-surface tracking-tight">API Setup</h2>
        <p className="text-md-on-surface-variant text-xs sm:text-sm">
          Provide your Telegram application credentials
        </p>
      </div>

      {/* Info Banner — M3 primary-container */}
      <div className="flex gap-2.5 bg-md-primary-container/40 border border-md-primary/15 rounded-xl p-3 text-xs text-md-on-surface leading-relaxed">
        <svg className="w-4 h-4 text-md-primary shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <div>
          <span className="font-semibold text-md-on-surface">API Credentials Required:</span> Obtain your <code className="bg-md-surface-container-high px-1 py-0.5 rounded font-mono text-[11px]">api_id</code> and <code className="bg-md-surface-container-high px-1 py-0.5 rounded font-mono text-[11px]">api_hash</code> by logging into{" "}
          <a
            href="https://my.telegram.org"
            target="_blank"
            rel="noopener noreferrer"
            className="text-md-primary hover:underline font-semibold transition-all duration-200 cursor-pointer"
          >
            my.telegram.org
          </a>
          , creating an application, and entering them below.
        </div>
      </div>

      {/* Form Error Alert — M3 error-container */}
      {(error || validationError) && (
        <div className="flex gap-2.5 bg-md-error-container border border-md-error/20 rounded-xl p-3 text-xs text-md-on-error-container font-medium leading-relaxed">
          <svg className="w-4 h-4 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <div className="flex-1">{validationError || error}</div>
        </div>
      )}

      {/* Credentials Inputs */}
      <div className="space-y-3">
        <Input
          label="API ID"
          type="text"
          placeholder="Enter api_id (e.g. 123456)"
          value={apiId}
          onChange={(e) => setApiId(e.target.value)}
          autoFocus
          icon={
            <svg className="w-4 h-4 text-md-on-surface-variant" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14" />
            </svg>
          }
        />

        <Input
          label="API Hash"
          type="text"
          placeholder="Enter api_hash (32-character string)"
          value={apiHash}
          onChange={(e) => setApiHash(e.target.value)}
          icon={
            <svg className="w-4 h-4 text-md-on-surface-variant" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          }
        />
      </div>

      <Button
        type="submit"
        loading={loading}
        className="w-full select-none cursor-pointer mt-2"
        size="md"
      >
        Next Step
      </Button>

      <p className="text-[11px] text-md-on-surface-variant text-center leading-relaxed select-none">
        We will request your phone number in the next step.
      </p>
    </form>
  );
}
