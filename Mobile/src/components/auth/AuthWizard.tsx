import React, { useEffect } from "react";
import { PhoneStep } from "./PhoneStep";
import { CredentialsStep } from "./CredentialsStep";
import { OtpStep } from "./OtpStep";
import { PasswordStep } from "./PasswordStep";
import { registerBackHandler } from "../../lib/back";
import type { AuthState } from "../../types";

interface AuthWizardProps {
  state: AuthState;
  onPhoneSubmit: (phone: string) => void;
  onCredentialsSubmit: (apiId: number, apiHash: string) => void;
  onOtpSubmit: (code: string) => void;
  onPasswordSubmit: (password: string) => void;
  onBackToCredentials: () => void;
  onBackToPhone: () => void;
}

export function AuthWizard({
  state,
  onPhoneSubmit,
  onCredentialsSubmit,
  onOtpSubmit,
  onPasswordSubmit,
  onBackToCredentials,
  onBackToPhone,
}: AuthWizardProps) {
  // Back walks the wizard: password → credentials → phone → exit
  useEffect(() => {
    return registerBackHandler(() => {
      if (state.loading) return false;
      if (state.step === "otp" || state.step === "password") {
        onBackToPhone();
        return true;
      }
      if (state.step === "phone") {
        onBackToCredentials();
        return true;
      }
      return false;
    }, 100);
  }, [state.step, state.loading, onBackToPhone, onBackToCredentials]);

  return (
    <div className="fixed inset-0 overflow-y-auto overflow-x-hidden anymex-ambient transition-colors duration-300 z-50">
      {/* Subtle ambient light — M3 tonal */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none select-none">
        <div className="absolute -top-40 -left-40 w-96 h-96 rounded-full blur-3xl animate-float opacity-60" style={{ background: 'color-mix(in srgb, var(--md-primary) 6%, transparent)' }} />
        <div
          className="absolute -bottom-40 -right-40 w-120 h-120 rounded-full blur-3xl animate-float opacity-65"
          style={{ animationDelay: "2s", background: 'color-mix(in srgb, var(--md-tertiary) 5%, transparent)' }}
        />
      </div>

      <div className="min-h-full w-full flex flex-col items-center justify-start sm:justify-center p-4 py-8 sm:py-12">
        <div className="w-full max-w-md relative z-10 animate-fade-in my-auto">
          <div className="text-center mb-6 sm:mb-8">
            <div className="inline-flex items-center gap-3 mb-2 sm:mb-3">
              <div className="p-2.5 rounded-2xl anymex-glass">
                <svg className="w-7 h-7 sm:w-8 sm:h-8" viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <defs>
                    <linearGradient id="auth-logo-cloud" x1="0%" y1="0%" x2="0%" y2="100%">
                      <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.95" />
                      <stop offset="100%" stopColor="#E0E7FF" stopOpacity="0.85" />
                    </linearGradient>
                  </defs>
                  <path d="M42 80c-5.52 0-10-4.48-10-10 0-4.88 3.5-8.94 8.2-9.82C41.4 51.78 49.38 46 58.5 46c8.07 0 15.22 4.45 18 11.02 1.34-.63 2.85-.98 4.45-.98 5.52 0 10 4.48 10 10s-4.48 10-10 10H42z" fill="url(#auth-logo-cloud)" />
                  <path d="M51 68l24-15.5L46.5 61l.5 9.5 4-2.5z" fill="#24A1DE" />
                  <path d="M75 52.5L46.5 61l15.5 5.5 13-14z" fill="#38BDF8" />
                </svg>
              </div>
              <span className="text-2xl font-semibold tracking-tight bg-gradient-to-r from-brand-400 to-accent-400 bg-clip-text text-transparent">
                Clash Drive
              </span>
            </div>
            <p className="text-md-on-surface-variant text-xs font-medium tracking-wide">
              INFINITE STORAGE • SERVERLESS VIRTUAL CLIENT
            </p>
          </div>

          {/* Step progress indicators — AnymeX pill */}
          <div className="flex items-center justify-center gap-2 mb-6 sm:mb-8 bg-md-surface-container px-5 py-2.5 rounded-xl border border-md-outline-variant/20 w-fit mx-auto">
            {(["credentials", "phone", "otp", "password"] as const).map((step, i) => {
              const steps = ["credentials", "phone", "otp", "password"] as const;
              const stepIdx = steps.indexOf(state.step as any);
              const isFinalStep = state.step === "done";
              const currentIdx = i;
              const isActive = !isFinalStep && currentIdx === stepIdx;
              const isDone = isFinalStep || currentIdx < stepIdx;

              return (
                <div key={step} className="flex items-center gap-2">
                  <div
                    className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-semibold transition-all duration-300 ${
                      isActive
                        ? "bg-md-primary text-md-on-primary"
                        : isDone
                          ? "bg-success-container text-on-success-container border border-success/20"
                          : "bg-md-surface-container-highest text-md-on-surface-variant"
                    }`}
                  >
                    {isDone ? "✓" : i + 1}
                  </div>
                  {i < 3 && (
                    <div
                      className={`w-5 sm:w-6 h-0.5 rounded-full transition-all duration-300 ${
                        isDone ? "bg-success/40" : "bg-md-outline-variant/40"
                      }`}
                    />
                  )}
                </div>
              );
            })}
          </div>

          <div className="anymex-glass p-6 sm:p-8 relative overflow-hidden">
            {state.step === "credentials" && (
              <CredentialsStep
                loading={state.loading}
                error={state.error}
                onSubmit={onCredentialsSubmit}
              />
            )}
            {state.step === "phone" && (
              <PhoneStep
                loading={state.loading}
                error={state.error}
                onSubmit={onPhoneSubmit}
                onBack={onBackToCredentials}
              />
            )}
            {state.step === "otp" && (
              <OtpStep
                phone={state.phone}
                loading={state.loading}
                error={state.error}
                onSubmit={onOtpSubmit}
              />
            )}
            {state.step === "password" && (
              <PasswordStep
                loading={state.loading}
                error={state.error}
                onSubmit={onPasswordSubmit}
              />
            )}
          </div>

          <p className="text-center text-[10px] uppercase font-medium tracking-wider text-md-on-surface-variant mt-6 flex items-center justify-center gap-1.5 select-none">
            <span className="w-1.5 h-1.5 rounded-full bg-success animate-ping shrink-0" />
            End-to-End Encrypted via MTProto
          </p>
        </div>
      </div>
    </div>
  );
}
