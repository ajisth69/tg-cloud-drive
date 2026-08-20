interface LoadingScreenProps {
  message?: string;
  subtext?: string;
}

export function LoadingScreen({
  message = "Initializing",
  subtext,
}: LoadingScreenProps) {
  return (
    <div className="min-h-dvh flex flex-col items-center justify-center gap-8 animate-fade-in relative overflow-hidden anymex-ambient">
      {/* Ambient background glows — subtle M3 tonal */}
      <div className="absolute w-[300px] h-[300px] rounded-full blur-3xl animate-pulse-slow" style={{ background: 'color-mix(in srgb, var(--md-primary) 5%, transparent)' }} />
      <div className="absolute w-[200px] h-[200px] rounded-full blur-3xl animate-pulse-slow delay-1000" style={{ background: 'color-mix(in srgb, var(--md-tertiary) 4%, transparent)' }} />
      
      {/* Premium Loader Ring */}
      <div className="relative w-24 h-24">
        {/* Outer Orbit */}
        <div className="absolute inset-0 rounded-full border border-md-outline-variant/30" />
        
        {/* Gradient spinner ring */}
        <svg className="absolute inset-0 w-24 h-24" viewBox="0 0 96 96" style={{ animation: "gradient-ring-spin 0.9s linear infinite" }}>
          <defs>
            <linearGradient id="spinnerGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="var(--md-primary)" />
              <stop offset="50%" stopColor="var(--md-tertiary)" />
              <stop offset="100%" stopColor="var(--md-primary)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <circle cx="48" cy="48" r="44" fill="none" stroke="url(#spinnerGrad)" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="200 100" />
        </svg>
        
        {/* Dashed secondary loop */}
        <div
          className="absolute inset-2.5 rounded-full border border-dashed border-md-tertiary/15 animate-spin"
          style={{ animationDuration: "5s", animationDirection: "reverse" }}
        />

        {/* Outer dot tracker */}
        <div
          className="absolute inset-0 rounded-full animate-spin"
          style={{ animationDuration: "1.8s" }}
        >
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-md-primary" style={{ boxShadow: '0 0 6px color-mix(in srgb, var(--md-primary) 40%, transparent)' }} />
        </div>

        {/* Center Glass Logo Shell */}
        <div className="absolute inset-4 rounded-full bg-md-surface-container flex items-center justify-center border border-md-outline-variant/10" style={{ boxShadow: 'var(--md-elevation-1)' }}>
          <svg className="w-8 h-8 animate-pulse-slow" viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id="load-logo-cloud" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="var(--md-primary)" />
                <stop offset="100%" stopColor="var(--md-tertiary)" />
              </linearGradient>
            </defs>
            <path d="M42 80c-5.52 0-10-4.48-10-10 0-4.88 3.5-8.94 8.2-9.82C41.4 51.78 49.38 46 58.5 46c8.07 0 15.22 4.45 18 11.02 1.34-.63 2.85-.98 4.45-.98 5.52 0 10 4.48 10 10s-4.48 10-10 10H42z" fill="url(#load-logo-cloud)" />
          </svg>
        </div>
      </div>

      <div className="text-center space-y-2 relative z-10 select-none">
        <p className="text-md-on-surface font-semibold text-lg sm:text-xl tracking-tight select-none">
          {message}
        </p>
        {subtext && (
          <p className="text-md-on-surface-variant text-[10px] uppercase font-semibold tracking-wide animate-pulse-slow">
            {subtext}
          </p>
        )}
        {/* Animated dots */}
        <div className="flex items-center justify-center gap-1.5 pt-2">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="w-1.5 h-1.5 rounded-full bg-md-primary/40"
              style={{
                animation: "dots-bounce 1.4s ease-in-out infinite",
                animationDelay: `${i * 0.16}s`,
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
