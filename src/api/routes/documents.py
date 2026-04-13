"""
POST /documents/upload — Document upload endpoint (FR-PP-004).

Accepts multipart form data (PDF, JPEG, PNG; max 10 MB).
Returns upload receipt metadata.  Actual blob storage to MinIO
is deferred to a follow-up integration task.
"""
from __future__ import annotations

import uuid

import structlog
from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

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

    The endpoint validates the file type and size, then returns a
    receipt with ``document_id``.  The binary payload is *not* persisted
    yet — MinIO integration is a separate task.
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

    log.info(
        "document_uploaded",
        document_id=document_id,
        claim_id=claim_id,
        document_type=document_type,
        filename=filename,
        content_type=file.content_type,
        size_bytes=size_bytes,
    )

    # TODO: persist to MinIO (minio_bucket_documents) in follow-up task.

    return DocumentUploadResponse(
        document_id=document_id,
        filename=filename,
        content_type=file.content_type or "application/octet-stream",
        size_bytes=size_bytes,
    )
