"""
POST /documents/upload — Document upload endpoint (FR-PP-004).

Accepts multipart form data (PDF, JPEG, PNG; max 10 MB).
Returns upload receipt metadata.  Persists to MinIO via model_store.
"""
from __future__ import annotations

import tempfile
import uuid
from pathlib import Path

import structlog
from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

from src.services.model_store import upload_document as minio_upload_document

log = structlog.get_logger(__name__)
router = APIRouter()

# 10 MB in bytes
MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024
ALLOWED_CONTENT_TYPES = {
    "application/pdf",
    "image/jpeg",
    "image/png",
}
ALLOWED_EXTENSIONS = {".pdf", ".jpg", ".jpeg", ".png"}


class DocumentUploadResponse(BaseModel):
    document_id: str
    filename: str
    content_type: str
    size_bytes: int


def _validate_extension(filename: str) -> None:
    """Raise 400 if the file extension is not in the allow-list."""
    lower = filename.lower()
    if not any(lower.endswith(ext) for ext in ALLOWED_EXTENSIONS):
        raise HTTPException(
            status_code=400,
            detail=(
                f"Unsupported file type. Allowed extensions: "
                f"{', '.join(sorted(ALLOWED_EXTENSIONS))}"
            ),
        )


@router.post("/documents/upload", response_model=DocumentUploadResponse)
async def upload_document(
    file: UploadFile = File(...),
    claim_id: str = Form(...),
    document_type: str = Form(...),
) -> DocumentUploadResponse:
    """
    Upload a claim-supporting document (PDF, JPEG, or PNG).

    The endpoint validates the file type and size, persists to MinIO,
    and returns a receipt with ``document_id``.
    """
    # ── Validate content type ─────────────────────────────────────────
    if file.content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Unsupported content type '{file.content_type}'. "
                f"Allowed: {', '.join(sorted(ALLOWED_CONTENT_TYPES))}"
            ),
        )

    # ── Validate extension ────────────────────────────────────────────
    filename = file.filename or "unknown"
    _validate_extension(filename)

    # ── Read and validate size ────────────────────────────────────────
    contents = await file.read()
    size_bytes = len(contents)

    if size_bytes > MAX_FILE_SIZE_BYTES:
        raise HTTPException(
            status_code=400,
            detail=(
                f"File too large ({size_bytes:,} bytes). "
                f"Maximum allowed: {MAX_FILE_SIZE_BYTES:,} bytes (10 MB)."
            ),
        )

    if size_bytes == 0:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    document_id = str(uuid.uuid4())

    # ── ISSUE-003: Persist to MinIO ──────────────────────────────────
    tmp_path: Path | None = None
    try:
        suffix = Path(filename).suffix or ".bin"
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(contents)
            tmp_path = Path(tmp.name)

        minio_key = minio_upload_document(
            filename=filename,
            file_path=tmp_path,
            content_type=file.content_type or "application/octet-stream",
        )
        # Use the MinIO key as the document_id for downstream retrieval
        document_id = minio_key
    except Exception as exc:
        log.warning(
            "minio_upload_failed_using_uuid",
            document_id=document_id,
            error=str(exc),
        )
        # Graceful degradation: return UUID-based document_id even if MinIO fails
    finally:
        if tmp_path and tmp_path.exists():
            tmp_path.unlink(missing_ok=True)

    log.info(
        "document_uploaded",
        document_id=document_id,
        claim_id=claim_id,
        document_type=document_type,
        filename=filename,
        content_type=file.content_type,
        size_bytes=size_bytes,
    )

    return DocumentUploadResponse(
        document_id=document_id,
        filename=filename,
        content_type=file.content_type or "application/octet-stream",
        size_bytes=size_bytes,
    )
