import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.feedback import (
    AttachmentFeedbackResult,
    AttachmentFeedbackState,
    build_message_feedback,
    upload_reactions,
)


def _result(state: AttachmentFeedbackState, error: str | None = None) -> AttachmentFeedbackResult:
    return AttachmentFeedbackResult(filename="match-1.log", state=state, error_message=error)


def test_upload_reactions_say_how_much_of_the_message_went_out() -> None:
    queued, failed = _result(AttachmentFeedbackState.UPLOADED_QUEUED), _result(AttachmentFeedbackState.UPLOAD_FAILED)
    assert upload_reactions([queued, queued]) == ("ok",)
    assert upload_reactions([queued, failed]) == ("ok", "warn")
    assert upload_reactions([failed]) == ("error",)


def test_a_processed_log_is_a_reaction_without_a_reply() -> None:
    summary = build_message_feedback(_result(AttachmentFeedbackState.PROCESSED_OK))
    assert summary.reactions == ("ok",)
    assert summary.reply_text is None


def test_single_awaiting_link_result_is_truthful_and_actionable() -> None:
    summary = build_message_feedback(_result(AttachmentFeedbackState.AWAITING_LINK))
    assert summary.reactions == ("ok", "warn")
    assert "администратору" in summary.reply_text and "привязать" in summary.reply_text
    assert "обработан" not in summary.reply_text


def test_single_failed_result_includes_its_own_error() -> None:
    summary = build_message_feedback(_result(AttachmentFeedbackState.PROCESSED_FAILED, "job-specific"))
    assert summary.reactions == ("ok", "warn")
    assert ":owt_warn: match-1.log" in summary.reply_text and "job-specific" in summary.reply_text


def test_a_failure_before_the_job_existed_keeps_ok_and_says_so() -> None:
    summary = build_message_feedback(_result(AttachmentFeedbackState.UPLOAD_FAILED, "Object storage unavailable"))
    assert summary.reactions == ("ok", "warn")
    assert "не удалось загрузить" in summary.reply_text and "Object storage unavailable" in summary.reply_text
