import { useState } from "react";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";

interface CreateFolderModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (name: string) => void;
}

export function CreateFolderModal({
  open,
  onClose,
  onSubmit,
}: CreateFolderModalProps) {
  const [name, setName] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim()) {
      onSubmit(name.trim());
      setName("");
      onClose();
    }
  };

  return (
    <Modal open={open} onClose={onClose} sheet noPadding>
      <div className="flex flex-col max-h-[calc(92dvh_-_28px)] bottom-nav-safe select-none">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-3 pb-2 shrink-0">
          <div className="min-w-0">
            <h2 className="text-lg font-bold tracking-tight text-md-on-surface">Create New Folder</h2>
            <p className="text-[10px] text-md-on-surface-variant font-medium mt-0.5">
              Organize your files in a new folder
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-11 h-11 rounded-full text-md-on-surface-variant hover:text-md-on-surface hover:bg-md-surface-container-highest transition-all flex items-center justify-center cursor-pointer active:scale-90 shrink-0 focus-visible:ring-2 focus-visible:ring-md-primary outline-none"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 pb-4 space-y-5 scrollbar-thin">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-[10px] font-bold uppercase tracking-[0.12em] text-md-on-surface-variant px-1 mb-2.5 block">
                Folder Name
              </label>
              <div className="rounded-3xl bg-md-surface-container border border-md-outline-variant/20 p-3.5">
                <div className="flex items-center gap-3 px-3 py-3 rounded-2xl bg-md-surface-container-lowest border border-md-outline-variant focus-within:border-md-primary focus-within:ring-2 focus-within:ring-md-primary/15 transition-all">
                  <svg className="w-4.5 h-4.5 text-md-on-surface-variant shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                  </svg>
                  <input
                    type="text"
                    placeholder="e.g. Project Files, Photos, Music..."
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    autoFocus
                    className="flex-1 min-w-0 bg-transparent outline-none text-sm text-md-on-surface placeholder:text-md-outline"
                  />
                </div>
              </div>
            </div>

            <div className="flex gap-3 pt-1">
              <Button
                variant="ghost"
                type="button"
                onClick={onClose}
                className="flex-1 justify-center"
                size="lg"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={!name.trim()}
                className="flex-1 justify-center"
                size="lg"
              >
                Create Folder
              </Button>
            </div>
          </form>
        </div>
      </div>
    </Modal>
  );
}