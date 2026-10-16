"""What the bot puts back on a log-upload message: reactions and a reply.

Reactions are emoji *names* (``shared.domain.discord_ui``) and reply lines
carry shortcodes: discord-service resolves both to the uploaded application
emoji, or to the Unicode fallback while none is uploaded.
"""

import enum
from collections.abc import Sequence
from dataclasses import dataclass

from shared.domain.discord_ui import emoji


class AttachmentFeedbackState(str, enum.Enum):
    UPLOADED_QUEUED = "uploaded_queued"
    PROCESSED_OK = "processed_ok"
    PROCESSED_FAILED = "processed_failed"
    UPLOAD_FAILED = "upload_failed"
    AWAITING_LINK = "awaiting_link"
    TIMED_OUT = "timed_out"


@dataclass(frozen=True, slots=True)
class AttachmentFeedbackResult:
    filename: str
    state: AttachmentFeedbackState
    error_message: str | None = None


@dataclass(frozen=True, slots=True)
class MessageFeedbackSummary:
    # ``None`` means "leave the message's reactions untouched"; an empty/filled
    # tuple means "reconcile the bot's reactions to exactly these" -- by emoji
    # name, not by the character the reader ends up seeing.
    reactions: tuple[str, ...] | None
    reply_text: str | None


_UPLOAD_ACCEPTED_STATES = {
    AttachmentFeedbackState.UPLOADED_QUEUED,
    AttachmentFeedbackState.PROCESSED_OK,
    AttachmentFeedbackState.PROCESSED_FAILED,
    AttachmentFeedbackState.TIMED_OUT,
    AttachmentFeedbackState.AWAITING_LINK,
}
_PROBLEM_STATES = {
    AttachmentFeedbackState.PROCESSED_FAILED,
    AttachmentFeedbackState.UPLOAD_FAILED,
    AttachmentFeedbackState.TIMED_OUT,
    AttachmentFeedbackState.AWAITING_LINK,
}


def _format_result_line(result: AttachmentFeedbackResult) -> str | None:
    if result.state is AttachmentFeedbackState.PROCESSED_OK:
        return f"{emoji('ok')} {result.filename} — загружен и обработан"
    if result.state is AttachmentFeedbackState.UPLOADED_QUEUED:
        return f"{emoji('ok')} {result.filename} — загружен и поставлен в обработку"
    if result.state is AttachmentFeedbackState.AWAITING_LINK:
        return f"{emoji('warn')} {result.filename} — загружен; администратору нужно привязать лог к игре и повторить обработку"
    if result.state is AttachmentFeedbackState.PROCESSED_FAILED:
        suffix = f": {result.error_message}" if result.error_message else ""
        return f"{emoji('warn')} {result.filename} — загружен, но обработка завершилась ошибкой{suffix}"
    if result.state is AttachmentFeedbackState.TIMED_OUT:
        return f"{emoji('warn')} {result.filename} — загружен, но итог обработки еще не подтвердился"
    suffix = f": {result.error_message}" if result.error_message else ""
    return f"{emoji('error')} {result.filename} — не удалось загрузить или поставить в обработку{suffix}"


def build_message_feedback(
    results: Sequence[AttachmentFeedbackResult],
    *,
    wait_for_result: bool,
) -> MessageFeedbackSummary:
    has_uploaded = any(result.state in _UPLOAD_ACCEPTED_STATES for result in results)
    has_problem = any(result.state in _PROBLEM_STATES for result in results)

    reactions: list[str] = []
    if has_uploaded:
        reactions.append("ok")
    if has_problem and has_uploaded:
        reactions.append("warn")
    elif has_problem:
        reactions.append("error")

    reply_lines = [line for result in results if (line := _format_result_line(result)) is not None]
    reply_text = None
    if wait_for_result and reply_lines and (len(reply_lines) > 1 or has_problem):
        reply_text = ("Результат обработки логов:\n" if len(reply_lines) > 1 else "") + "\n".join(reply_lines)

    return MessageFeedbackSummary(reactions=tuple(reactions), reply_text=reply_text)
