interface BreadcrumbProps {
  folderName: string | null;
  onBackToRoot: () => void;
}

export function Breadcrumb({ folderName, onBackToRoot }: BreadcrumbProps) {
  return (
    <nav className="flex items-center gap-2 mb-4">
      <button
        onClick={onBackToRoot}
        className="flex items-center gap-2 text-md-on-surface-variant hover:text-md-primary transition-colors font-semibold cursor-pointer text-sm"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
        </svg>
        My Drive
      </button>
      {folderName && (
        <>
          <svg
            className="w-4 h-4 text-md-outline"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 5l7 7-7 7"
            />
          </svg>
          <span className="text-md-on-surface font-semibold">{folderName}</span>
        </>
      )}
    </nav>
  );
}
