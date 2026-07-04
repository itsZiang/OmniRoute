"use client";

/**
 * AddToPoolModal — bulk paste reserve keys into the key pool.
 *
 * Accepts `name|key` lines or bare-key lines (one per line). Empty lines
 * ignored. Parsing is server-side; the modal just collects the raw textarea.
 */

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/shared/components";

interface AddToPoolModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (lines: string) => Promise<void>;
  disabled?: boolean;
}

export default function AddToPoolModal({ open, onClose, onSubmit, disabled }: AddToPoolModalProps) {
  const t = useTranslations();
  const [lines, setLines] = useState("");

  if (!open) return null;

  const handleSubmit = async () => {
    if (!lines.trim()) return;
    await onSubmit(lines);
    setLines("");
  };

  const handleClose = () => {
    setLines("");
    onClose();
  };

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
      onClick={handleClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="bg-white dark:bg-zinc-900 rounded-lg shadow-xl max-w-xl w-full p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold mb-1">
          {t("keyPoolAddToPool") || "Add keys to pool"}
        </h3>
        <p className="text-sm text-gray-500 mb-4">
          {t("keyPoolAddHelp") ||
            'One key per line. Use "name|key" to add a label, or paste bare keys.'}
        </p>
        <textarea
          value={lines}
          onChange={(e) => setLines(e.target.value)}
          rows={10}
          className="w-full p-3 border rounded font-mono text-sm"
          placeholder={"My OpenAI key|sk-...\nAnother key|sk-...\nsk-barekey-no-name"}
          disabled={disabled}
          autoFocus
        />
        <div className="flex justify-end gap-2 mt-4">
          <Button color="ghost" onClick={handleClose} disabled={disabled}>
            {t("cancel") || "Cancel"}
          </Button>
          <Button onClick={handleSubmit} disabled={disabled || !lines.trim()}>
            {t("keyPoolAdd") || "Add to pool"}
          </Button>
        </div>
      </div>
    </div>
  );
}
