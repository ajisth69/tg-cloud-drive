interface ProgressBarProps {
  value: number; // 0-100, or -1 for indeterminate
  size?: "sm" | "md";
  color?: "brand" | "accent" | "success";
  showLabel?: boolean;
}

export function ProgressBar({
  value,
  size = "md",
  color = "brand",
  showLabel = false,
}: ProgressBarProps) {
  const isIndeterminate = value < 0;

  const heights: Record<string, string> = {
    sm: "h-1",
    md: "h-1", /* M3 linear progress track = 4dp */
  };

  const colors: Record<string, string> = {
    brand: "bg-md-primary",
    accent: "bg-md-tertiary",
    success: "bg-success",
  };

  const trackColors: Record<string, string> = {
    brand: "bg-md-primary-container",
    accent: "bg-md-tertiary-container",
    success: "bg-success-container",
  };

  const clampedValue = Math.min(100, Math.max(0, value));

  return (
    <div className="w-full">
      {showLabel && !isIndeterminate && (
        <div className="flex justify-end mb-1">
          <span className="text-[10px] font-medium text-md-on-surface-variant tabular-nums">
            {Math.round(clampedValue)}%
          </span>
        </div>
      )}
      <div
        className={`relative w-full rounded-full overflow-hidden ${heights[size]} ${trackColors[color]}`}
      >
        {isIndeterminate ? (
          <div
            className={`absolute ${heights[size]} rounded-full ${colors[color]} animate-progress-indeterminate`}
          />
        ) : (
          <div
            className={`${heights[size]} rounded-full ${colors[color]} transition-all duration-500 ease-out`}
            style={{ width: `${clampedValue}%` }}
          >
            {/* Animated shine overlay */}
            {clampedValue > 0 && clampedValue < 100 && (
              <div
                className="absolute inset-0 rounded-full opacity-30"
                style={{
                  background: "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.35) 50%, transparent 100%)",
                  backgroundSize: "200% 100%",
                  animation: "progress-shine 2s ease-in-out infinite",
                }}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
