import React, { useEffect, useState, useRef } from "react";
import { createPortal } from "react-dom";
import { registerBackHandler } from "../../lib/back";
import { pushOverlay, popOverlay } from "../../lib/sheetStack";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  size?: "sm" | "md" | "lg" | "xl" | "2xl" | "3xl";
  noPadding?: boolean;
  /** Force bottom-sheet presentation even on desktop */
  sheet?: boolean;
  children: React.ReactNode;
}

export function Modal({
  open,
  onClose,
  title,
  size = "md",
  noPadding = false,
  sheet = false,
  children,
}: ModalProps) {
  const [closing, setClosing] = useState(false);
  const modalRef = useRef<HTMLDivElement | null>(null);
  const closingRef = useRef(false);

  useEffect(() => {
    closingRef.current = closing;
  }, [closing]);

  const handleClose = () => {
    setClosing(true);
    setTimeout(() => {
      setClosing(false);
      onClose();
    }, 220);
  };

  // Stable ref so the back-handler registration effect never re-runs
  const handleCloseRef = useRef(handleClose);
  useEffect(() => {
    handleCloseRef.current = handleClose;
  }, [handleClose]);

  // Hardware/gesture back closes the topmost open modal
  useEffect(() => {
    if (!open) return;
    return registerBackHandler(() => {
      if (closingRef.current) return false;
      handleCloseRef.current();
      return true;
    }, 100);
  }, [open]);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    if (open) {
      document.addEventListener("keydown", handleEsc);
      document.body.style.overflow = "hidden";
    }
    return () => {
      document.removeEventListener("keydown", handleEsc);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  // Avisa que hay un overlay abierto (el dock se oculta para no tapar contenido)
  useEffect(() => {
    if (!open && !closing) return;
    pushOverlay();
    return () => popOverlay();
  }, [open, closing]);

  // Focus trap
  useEffect(() => {
    if (!open || !modalRef.current) return;
    const focusable = modalRef.current.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (focusable.length > 0) focusable[0].focus();
  }, [open]);

  if (!open && !closing) return null;

  const sizeClasses: Record<string, string> = {
    sm: "max-w-sm",
    md: "max-w-md",
    lg: "max-w-lg",
    xl: "max-w-2xl",
    "2xl": "max-w-3xl",
    "3xl": "max-w-4xl",
  };

  // Drive-style presentation: bottom sheet on phones, centered dialog on larger screens
  const isSheet = sheet;
  const sheetClasses = isSheet
    ? "w-full rounded-t-[28px] sm:rounded-[28px] sm:max-w-md"
    : `w-full ${sizeClasses[size]}`;

  // Portal a <body>: los overlays deben competir en z-index con el dock
  // (z-40) directamente; dentro de <main> (z-auto) pierden siempre.
  return createPortal(
    <div
      className={`fixed inset-0 z-50 flex ${isSheet ? "items-end justify-center" : "items-center justify-center p-4"}`}
    >
      {/* Scrim */}
      <div
        className={`absolute inset-0 bg-black/40 ${closing ? "animate-backdrop-exit" : "animate-backdrop-enter"}`}
        onClick={handleClose}
      />
      {/* Panel */}
      <div
        ref={modalRef}
        className={`relative bg-md-surface-container-high ${isSheet ? "bottom-nav-safe" : ""} ${noPadding ? "p-0 overflow-hidden" : "p-5 sm:p-6 overflow-y-auto scrollbar-thin"} ${sheetClasses} mx-auto border border-md-outline-variant/20 ${
          isSheet
            ? `max-h-[92dvh] ${closing ? "animate-sheet-exit" : "animate-sheet-enter"}`
            : `max-h-[90vh] ${closing ? "animate-spring-out" : "animate-spring-in"}`
        }`}
        style={{ boxShadow: "var(--md-elevation-3)", WebkitBackdropFilter: "blur(24px)" }}
      >
        {isSheet && (
          <div className="flex justify-center pt-2 pb-1 select-none shrink-0">
            <div className="w-9 h-1 rounded-full bg-md-outline-variant/70" />
          </div>
        )}
        {title && (
          <div className="flex items-center justify-between mb-4 select-none">
            <h3 className="text-lg font-bold text-md-on-surface tracking-tight">{title}</h3>
            <button
              onClick={handleClose}
              className="text-md-on-surface-variant hover:text-md-on-surface transition-all p-2 rounded-full hover:bg-md-surface-container-highest cursor-pointer active:scale-90"
              title="Close"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        )}
        <div className={title && !noPadding ? "space-y-4" : ""}>
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
}