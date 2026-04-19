import enum
from collections.abc import Sequence
from dataclasses import dataclass


class AttachmentFeedbackState(str, enum.Enum):
    ALREADY_PROCESSED = "already_processed"
    UPLOADED_QUEUED = "uploaded_queued"
    PROCESSED_OK = "processed_ok"
    PROCESSED_FAILED = "processed_failed"
    UPLOAD_FAILED = "upload_failed"
    TIMED_OUT = "timed_out"


@dataclass(frozen=True, slots=True)
class AttachmentFeedbackResult:
    filename: str
    state: AttachmentFeedbackState
    error_message: str | None = None


@dataclass(frozen=True, slots=True)
class MessageFeedbackSummary:
    reactions: tuple[str, ...]
    reply_text: str | None


_UPLOAD_ACCEPTED_STATES = {
    AttachmentFeedbackState.ALREADY_PROCESSED,
    AttachmentFeedbackState.UPLOADED_QUEUED,
    AttachmentFeedbackState.PROCESSED_OK,
    AttachmentFeedbackState.PROCESSED_FAILED,
    AttachmentFeedbackState.TIMED_OUT,
}
_PROBLEM_STATES = {
    AttachmentFeedbackState.PROCESSED_FAILED,
    AttachmentFeedbackState.UPLOAD_FAILED,
    AttachmentFeedbackState.TIMED_OUT,
}


def _format_result_line(result: AttachmentFeedbackResult) -> str | None:
    if result.state is AttachmentFeedbackState.ALREADY_PROCESSED:
        return None
    if result.state is AttachmentFeedbackState.PROCESSED_OK:
        return f"✅ {result.filename} — загружен и обработан"
    if result.state is AttachmentFeedbackState.UPLOADED_QUEUED:
        return f"✅ {result.filename} — загружен и поставлен в обработку"
    if result.state is AttachmentFeedbackState.PROCESSED_FAILED:
        suffix = f": {result.error_message}" if result.error_message else ""
        return f"⚠️ {result.filename} — загружен, но обработка завершилась ошибкой{suffix}"
    if result.state is AttachmentFeedbackState.TIMED_OUT:
        return f"⚠️ {result.filename} — загружен, но итог обработки еще не подтвердился"
    suffix = f": {result.error_message}" if result.error_message else ""
    return f"❌ {result.filename} — не удалось загрузить или поставить в обработку{suffix}"


def build_message_feedback(
    results: Sequence[AttachmentFeedbackResult],
    *,
    wait_for_result: bool,
) -> MessageFeedbackSummary:
    has_uploaded = any(result.state in _UPLOAD_ACCEPTED_STATES for result in results)
    has_problem = any(result.state in _PROBLEM_STATES for result in results)

    reactions: list[str] = []
    if has_uploaded:
        reactions.append("✅")
    if has_problem and has_uploaded:
        reactions.append("⚠️")
    elif has_problem:
        reactions.append("❌")

    reply_lines = [line for result in results if (line := _format_result_line(result)) is not None]
    reply_text = None
    if wait_for_result and len(reply_lines) > 1:
        reply_text = "Результат обработки логов:\n" + "\n".join(reply_lines)

    return MessageFeedbackSummary(reactions=tuple(reactions), reply_text=reply_text)
