"""Canonical ingest: the trust boundary every producer's match document crosses."""

from src.services.ingest.validation import (
    DocumentRejected,
    IngestIssue,
    ValidatedDocument,
    load_document,
    validate_document,
)

__all__ = ("DocumentRejected", "IngestIssue", "ValidatedDocument", "load_document", "validate_document")
