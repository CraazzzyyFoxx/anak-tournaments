"""What the bot puts back on a log-upload message: reactions and a reply.

Two moments. When the message's log files go out, its verdict reactions are
reconciled to what the hand-off achieved (:func:`upload_reactions`). When
stats-service later answers for one file, that answer only adds to them
(:func:`build_message_feedback`) and replies only when the file needs a look.

Reactions are emoji *names* (``src.ui``) and reply lines carry shortcodes:
discord-service resolves both to the uploaded application emoji, or to the
Unicode fallback while none is uploaded. Reply wording is ``copy``'s, in the
guild's language.
"""

import enum
from collections.abc import Sequence
from dataclasses import dataclass

from src.interactions import copy
from src.ui import emoji


class AttachmentFeedbackState(str, enum.Enum):
    UPLOADED_QUEUED = "uploaded_queued"
    PROCESSED_OK = "processed_ok"
    PROCESSED_FAILED = "processed_failed"
    UPLOAD_FAILED = "upload_failed"
    AWAITING_LINK = "awaiting_link"


@dataclass(frozen=True, slots=True)
class AttachmentFeedbackResult:
    filename: str
    state: AttachmentFeedbackState
    error_message: str | None = None


@dataclass(frozen=True, slots=True)
class MessageFeedbackSummary:
    # Emoji names, not the character the reader ends up seeing.
    reactions: tuple[str, ...]
    reply_text: str | None


def _format_result_line(result: AttachmentFeedbackResult, locale: copy.Locale) -> str:
    if result.state is AttachmentFeedbackState.AWAITING_LINK:
        return f"{emoji('warn')} {copy.text(locale, 'log_awaiting_link', filename=result.filename)}"
    suffix = f": {result.error_message}" if result.error_message else ""
    if result.state is AttachmentFeedbackState.PROCESSED_FAILED:
        return f"{emoji('warn')} {copy.text(locale, 'log_processing_failed', filename=result.filename)}{suffix}"
    return f"{emoji('error')} {copy.text(locale, 'log_upload_failed', filename=result.filename)}{suffix}"


def upload_reactions(results: Sequence[AttachmentFeedbackResult]) -> tuple[str, ...]:
    """``ok`` when every log file went out, ``ok`` + ``warn`` when some did, ``error`` when none did."""
    queued = sum(result.state is AttachmentFeedbackState.UPLOADED_QUEUED for result in results)
    if queued == len(results):
        return ("ok",)
    return ("ok", "warn") if queued else ("error",)


def build_message_feedback(result: AttachmentFeedbackResult, locale: copy.Locale) -> MessageFeedbackSummary:
    """One file's stats verdict: ``ok``, plus ``warn`` and a reply naming the file when it needs a look.

    ``ok`` stays on a problem too: the upload itself went through, which is all
    that reaction ever claimed. A success replies nothing -- the reaction says it.
    """
    if result.state is AttachmentFeedbackState.PROCESSED_OK:
        return MessageFeedbackSummary(reactions=("ok",), reply_text=None)
    return MessageFeedbackSummary(reactions=("ok", "warn"), reply_text=_format_result_line(result, locale))
