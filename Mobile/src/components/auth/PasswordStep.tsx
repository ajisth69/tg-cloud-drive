import { useState } from "react";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";

interface PasswordStepProps {
  loading: boolean;
  error: string | null;
  onSubmit: (password: string) => void;
}

export function PasswordStep({ loading, error, onSubmit }: PasswordStepProps) {
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (password.trim()) {
      onSubmit(password);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6 animate-slide-up">
      <div className="text-center space-y-2 mb-8">
        <div className="w-14 h-14 mx-auto rounded-2xl bg-warning-container flex items-center justify-center mb-4 text-on-warning-container">
          <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
          </svg>
        </div>
        <h2 className="text-2xl font-semibold text-md-on-surface tracking-tight">
          Cloud Password
        </h2>
        <p className="text-md-on-surface-variant text-sm">
          Two-Factor Authentication is enabled on this account
        </p>
      </div>

      <div className="relative">
        <Input
          label="Cloud Password"
          type={showPassword ? "text" : "password"}
          placeholder="Enter your cloud password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={error || undefined}
          autoFocus
          icon={
            <svg
              className="w-4 h-4 text-md-on-surface-variant"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
              />
            </svg>
          }
        />
        <button
          type="button"
          onClick={() => setShowPassword(!showPassword)}
          className="absolute right-4 top-[38px] text-md-on-surface-variant hover:text-md-on-surface transition-colors cursor-pointer p-1 rounded-full"
        >
          {showPassword ? (
            <svg
              className="w-5 h-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.8}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88"
              />
            </svg>
          ) : (
            <svg
              className="w-5 h-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.8}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z"
              />
              <circle cx="12" cy="12" r="3" strokeWidth={1.8} />
            </svg>
          )}
        </button>
      </div>

      <Button type="submit" loading={loading} className="w-full" size="lg">
        Unlock Vault
      </Button>
    </form>
  );
}
