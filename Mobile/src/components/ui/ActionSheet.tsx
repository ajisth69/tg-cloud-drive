import React, { useEffect, useState, useRef } from "react";
import { createPortal } from "react-dom";
import { registerBackHandler } from "../../lib/back";
import { pushOverlay, popOverlay } from "../../lib/sheetStack";

export interface SheetAction {
  id: string;
  label: string;
  icon?: React.ReactNode;
  danger?: boolean;
  accent?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}

interface ActionSheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  actions: SheetAction[];
}

/** Bottom sheet de acciones (mobile-first: sin variante de escritorio). */
export function ActionSheet({
  open,
  onClose,
  title,
  subtitle,
  actions,
}: ActionSheetProps) {
  const [closing, setClosing] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const closingRef = useRef(false);

  useEffect(() => {
    closingRef.current = closing;
  }, [closing]);

  const doClose = () => {
    setClosing(true);
    setTimeout(() => {
      setClosing(false);
      onClose();
    }, 200);
  };

  // Stable ref so the back-handler registration effect never re-runs
  const doCloseRef = useRef(doClose);
  useEffect(() => {
    doCloseRef.current = doClose;
  }, [doClose]);

  // Hardware/gesture back closes the action sheet
  useEffect(() => {
    if (!open) return;
    return registerBackHandler(() => {
      if (closingRef.current) return false;
      doCloseRef.current();
      return true;
    }, 100);
  }, [open]);

  // Avisa que hay un overlay abierto (el dock se oculta para no tapar opciones)
  useEffect(() => {
    if (!open && !closing) return;
    pushOverlay();
    return () => popOverlay();
  }, [open, closing]);

  useEffect(() => {
    if (!open) return;
    const handleOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) doClose();
    };
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [open]);

  if (!open && !closing) return null;

  const inClass = closing ? "animate-sheet-exit" : "animate-sheet-enter";

  // Portal a <body>: los overlays deben competir en z-index con el dock
  // (z-40) directamente; dentro de <main> (z-auto) pierden siempre.
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-end justify-center">
      <div
        className={`absolute inset-0 bg-black/40 ${closing ? "animate-backdrop-exit" : "animate-backdrop-enter"}`}
        onClick={doClose}
      />
      <div
        ref={ref}
        className={`relative w-full bg-md-surface-container-high rounded-t-[28px] bottom-nav-safe border-t border-md-outline-variant/20 ${inClass}`}
        style={{ boxShadow: "var(--md-elevation-3)", maxHeight: "85dvh", overflowY: "auto", WebkitBackdropFilter: "blur(24px)" }}
      >
        <div className="flex justify-center pt-2.5 pb-1 select-none">
          <div className="w-9 h-1 rounded-full bg-md-outline-variant/70" />
        </div>
        {(title || subtitle) && (
          <div className="px-5 pt-2 pb-1 select-none">
            {title && (
              <p className="text-sm font-semibold text-md-on-surface tracking-tight truncate">{title}</p>
            )}
            {subtitle && (
              <p className="text-[11px] text-md-on-surface-variant mt-0.5 truncate">{subtitle}</p>
            )}
          </div>
        )}
        <div className="p-2.5 pb-3">
          {actions.map((a) => (
            <button
              key={a.id}
              disabled={a.disabled}
              onClick={() => {
                doClose();
                a.onClick?.();
              }}
              className={`w-full flex items-center gap-3.5 px-4 py-3 rounded-lg text-sm font-medium transition-colors cursor-pointer disabled:opacity-40 min-h-[48px] ${
                a.danger
                  ? "text-md-error hover:bg-md-error-container/30"
                  : a.accent
                    ? "text-md-primary font-semibold hover:bg-md-primary-container/40"
                    : "text-md-on-surface hover:bg-md-surface-container"
              }`}
            >
              {a.icon && <span className="shrink-0 text-md-on-surface-variant">{a.icon}</span>}
              <span className="truncate">{a.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body
  );
}