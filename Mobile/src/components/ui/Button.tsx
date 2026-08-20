import React, { useRef, useCallback } from "react";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger" | "glass" | "icon";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  children?: React.ReactNode;
}

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  className = "",
  children,
  disabled,
  onClick,
  ...props
}: ButtonProps) {
  const btnRef = useRef<HTMLButtonElement | null>(null);

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      // M3 ripple effect
      const btn = btnRef.current;
      if (btn) {
        const rect = btn.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const ripple = document.createElement("span");
        ripple.style.cssText = `
          position: absolute;
          left: ${x}px;
          top: ${y}px;
          width: 0;
          height: 0;
          border-radius: 50%;
          background: currentColor;
          transform: translate(-50%, -50%);
          pointer-events: none;
          animation: ripple-spread 0.45s ease-out forwards;
        `;
        btn.appendChild(ripple);
        setTimeout(() => ripple.remove(), 450);
      }
      onClick?.(e);
    },
    [onClick]
  );

  // AnymeX-style buttons: filled primary, radius 8px
  const base =
    "relative inline-flex items-center justify-center font-semibold rounded-lg transition-all duration-200 ease-out cursor-pointer select-none focus:outline-none focus-visible:ring-3 focus-visible:ring-brand-500/40 focus-visible:ring-offset-2 disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.97] overflow-hidden";

  const variants: Record<string, string> = {
    primary:
      "bg-md-primary text-md-on-primary hover:shadow-md active:brightness-95 border border-transparent",
    secondary:
      "bg-md-secondary-container text-md-on-secondary-container hover:shadow-sm border border-transparent",
    ghost:
      "bg-transparent text-md-on-surface-variant hover:bg-md-surface-container-high active:bg-md-surface-container-highest",
    danger:
      "bg-md-error-container text-md-on-error-container border border-transparent hover:shadow-sm",
    glass:
      "bg-md-surface-container text-md-on-surface border border-md-outline-variant hover:bg-md-surface-container-high",
    icon:
      "bg-transparent text-md-on-surface-variant hover:bg-md-surface-container-highest rounded-full p-0 border border-transparent",
  };

  const sizes: Record<string, string> = {
    sm: "text-xs px-4 py-2 gap-1.5 min-h-[32px]",
    md: "text-sm px-6 py-2.5 gap-2 min-h-[40px]",
    lg: "text-sm px-8 py-3 gap-2.5 min-h-[48px]",
  };

  // Icon variant overrides size to fixed square
  const sizeClass = variant === "icon" ? "w-10 h-10" : sizes[size];

  return (
    <button
      ref={btnRef}
      className={`${base} ${variants[variant]} ${sizeClass} ${className}`}
      disabled={disabled || loading}
      onClick={handleClick}
      {...props}
    >
      {loading && (
        <svg
          className="animate-spin h-4 w-4 shrink-0"
          viewBox="0 0 24 24"
          fill="none"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="3"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
          />
        </svg>
      )}
      {children}
    </button>
  );
}
