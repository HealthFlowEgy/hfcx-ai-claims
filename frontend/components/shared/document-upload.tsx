'use client';

import * as React from 'react';
import { useCallback, useRef, useState } from 'react';
import { FileText, Image, Upload, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';

/**
 * Reusable document upload component (SRS FR-PP-004).
 *
 * Supports drag-and-drop + click-to-browse.  Validates file type
 * (PDF, JPEG, PNG) and size (max 10 MB) on the client side before
 * invoking the `onUpload` callback.
 *
 * RTL-aware via Tailwind logical properties and `dir` inheritance.
 */

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const ACCEPTED_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];
const ACCEPT_STRING = '.pdf,.jpg,.jpeg,.png';

export interface DocumentUploadProps {
  onUpload: (file: File) => void | Promise<void>;
  /** Optional external progress value 0-100. */
  progress?: number;
  /** Disable interactions while uploading. */
  disabled?: boolean;
  className?: string;
}

function fileIcon(type: string) {
  if (type === 'application/pdf') {
    return <FileText className="size-8 text-hcx-danger" aria-hidden />;
  }
  return <Image className="size-8 text-hcx-primary" aria-hidden />;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function DocumentUpload({
  onUpload,
  progress,
  disabled = false,
  className,
}: DocumentUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);

  const validate = useCallback((f: File): string | null => {
    if (!ACCEPTED_TYPES.includes(f.type)) {
      return 'Unsupported file type. Please upload PDF, JPEG, or PNG.';
    }
    if (f.size > MAX_FILE_SIZE) {
      return `File exceeds 10 MB limit (${formatSize(f.size)}).`;
    }
    if (f.size === 0) {
      return 'File is empty.';
    }
    return null;
  }, []);

  const handleFile = useCallback(
    (f: File) => {
      const err = validate(f);
      if (err) {
        setError(err);
        setFile(null);
        return;
      }
      setError(null);
      setFile(f);
      onUpload(f);
    },
    [validate, onUpload],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragActive(false);
      if (disabled) return;
      const dropped = e.dataTransfer.files[0];
      if (dropped) handleFile(dropped);
    },
    [disabled, handleFile],
  );

  const onDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      if (!disabled) setDragActive(true);
    },
    [disabled],
  );

  const onDragLeave = useCallback(() => setDragActive(false), []);

  const onInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const selected = e.target.files?.[0];
      if (selected) handleFile(selected);
      // Reset input so the same file can be re-selected.
      e.target.value = '';
    },
    [handleFile],
  );

  const clearFile = useCallback(() => {
    setFile(null);
    setError(null);
  }, []);

  return (
    <Card className={cn('overflow-hidden', className)}>
      {/* Drop zone */}
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-label="Upload document"
        onClick={() => !disabled && inputRef.current?.click()}
        onKeyDown={(e) => {
          if (!disabled && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        className={cn(
          'flex cursor-pointer flex-col items-center justify-center gap-3 border-2 border-dashed p-8 transition-colors',
          dragActive && !disabled
            ? 'border-hcx-primary bg-hcx-primary/5'
            : 'border-border',
          disabled && 'pointer-events-none opacity-50',
        )}
      >
        <Upload className="size-10 text-hcx-text-muted" aria-hidden />
        <p className="text-sm text-hcx-text-muted">
          Drag &amp; drop a file here, or click to browse
        </p>
        <p className="text-xs text-hcx-text-muted">
          PDF, JPEG, PNG — max 10 MB
        </p>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT_STRING}
        onChange={onInputChange}
        className="hidden"
        aria-hidden
      />

      {/* Error */}
      {error && (
        <div className="px-4 py-2 text-sm text-hcx-danger" role="alert">
          {error}
        </div>
      )}

      {/* File preview */}
      {file && !error && (
        <div className="flex items-center gap-3 px-4 py-3">
          {fileIcon(file.type)}
          <div className="min-w-0 flex-1 space-y-1">
            <p className="truncate text-sm font-medium text-hcx-text">
              {file.name}
            </p>
            <p className="text-xs text-hcx-text-muted">
              {formatSize(file.size)} &middot; {file.type}
            </p>
            {progress != null && progress >= 0 && (
              <Progress value={progress} className="h-1.5" />
            )}
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={(e) => {
              e.stopPropagation();
              clearFile();
            }}
            aria-label="Remove file"
            disabled={disabled}
          >
            <X className="size-4" />
          </Button>
        </div>
      )}
    </Card>
  );
}
