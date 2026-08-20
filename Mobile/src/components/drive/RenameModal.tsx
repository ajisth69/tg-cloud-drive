import React, { useState, useEffect } from "react";
import { Modal } from "../ui/Modal";
import { Input } from "../ui/Input";
import { Button } from "../ui/Button";

interface RenameModalProps {
  open: boolean;
  onClose: () => void;
  initialName: string;
  itemType: "file" | "folder";
  onSubmit: (newName: string) => void;
}

export function RenameModal({
  open,
  onClose,
  initialName,
  itemType,
  onSubmit,
}: RenameModalProps) {
  const [name, setName] = useState(initialName);

  useEffect(() => {
    if (open) {
      setName(initialName);
    }
  }, [open, initialName]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed && trimmed !== initialName) {
      onSubmit(trimmed);
    }
    onClose();
  };

  const isFolder = itemType === "folder";

  return (
    <Modal
      open={open}
      onClose={onClose}
      sheet
      title={isFolder ? "Rename Folder" : "Rename File"}
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        <Input
          label={isFolder ? "Folder Name" : "File Name"}
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          icon={
            isFolder ? (
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
                />
              </svg>
            ) : (
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                />
              </svg>
            )
          }
        />
        <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2">
          <Button variant="ghost" type="button" onClick={onClose} className="w-full sm:w-auto justify-center">
            Cancel
          </Button>
          <Button type="submit" disabled={!name.trim() || name.trim() === initialName} className="w-full sm:w-auto justify-center">
            Rename
          </Button>
        </div>
      </form>
    </Modal>
  );
}
