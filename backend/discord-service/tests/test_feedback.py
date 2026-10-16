import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.feedback import (
    AttachmentFeedbackResult,
    AttachmentFeedbackState,
    build_message_feedback,
)


def test_build_message_feedback_replies_for_live_multi_log_results() -> None:
    summary = build_message_feedback(
        [
            AttachmentFeedbackResult(
                filename="match-1.log",
                state=AttachmentFeedbackState.PROCESSED_OK,
            ),
            AttachmentFeedbackResult(
                filename="match-2.log",
                state=AttachmentFeedbackState.PROCESSED_FAILED,
                error_message="missing MatchEnd",
            ),
        ],
        wait_for_result=True,
    )

    assert summary.reactions == ("ok", "warn")
    assert summary.reply_text is not None
    assert "match-1.log" in summary.reply_text
    assert "match-2.log" in summary.reply_text
    assert "missing MatchEnd" in summary.reply_text
    # Shortcodes, not characters: the bot swaps them for its own emoji when it sends.
    assert ":owt_ok: match-1.log" in summary.reply_text
    assert ":owt_warn: match-2.log" in summary.reply_text


def test_build_message_feedback_replies_for_distinct_successful_uploads() -> None:
    summary = build_message_feedback(
        [
            AttachmentFeedbackResult(
                filename="match-1.log",
                state=AttachmentFeedbackState.PROCESSED_OK,
            ),
            AttachmentFeedbackResult(
                filename="match-2.log",
                state=AttachmentFeedbackState.PROCESSED_OK,
            ),
        ],
        wait_for_result=True,
    )

    assert summary.reactions == ("ok",)
    assert "match-1.log" in summary.reply_text and "match-2.log" in summary.reply_text


def test_build_message_feedback_rescan_acknowledges_queued_bytes_not_a_filename_hit() -> None:
    summary = build_message_feedback(
        [
            AttachmentFeedbackResult(
                filename="match-1.log",
                state=AttachmentFeedbackState.UPLOADED_QUEUED,
            ),
            AttachmentFeedbackResult(
                filename="match-2.log",
                state=AttachmentFeedbackState.UPLOADED_QUEUED,
            ),
        ],
        wait_for_result=False,
    )

    assert summary.reactions == ("ok",)
    assert summary.reply_text is None


def test_build_message_feedback_reacts_on_history_rescan_when_mixed() -> None:
    summary = build_message_feedback(
        [
            AttachmentFeedbackResult(
                filename="match-1.log",
                state=AttachmentFeedbackState.UPLOADED_QUEUED,
            ),
            AttachmentFeedbackResult(
                filename="match-2.log",
                state=AttachmentFeedbackState.UPLOAD_FAILED,
                error_message="boom",
            ),
        ],
        wait_for_result=False,
    )

    assert summary.reactions == ("ok", "warn")


def test_build_message_feedback_reacts_on_history_rescan_for_new_queued_log() -> None:
    summary = build_message_feedback(
        [
            AttachmentFeedbackResult(
                filename="match-1.log",
                state=AttachmentFeedbackState.UPLOADED_QUEUED,
            ),
        ],
        wait_for_result=False,
    )

    assert summary.reactions == ("ok",)


def test_build_message_feedback_skips_reply_for_single_live_result() -> None:
    summary = build_message_feedback(
        [
            AttachmentFeedbackResult(
                filename="match-1.log",
                state=AttachmentFeedbackState.PROCESSED_OK,
            ),
        ],
        wait_for_result=True,
    )

    assert summary.reactions == ("ok",)
    assert summary.reply_text is None


def test_single_awaiting_link_result_is_truthful_and_actionable() -> None:
    summary = build_message_feedback(
        [AttachmentFeedbackResult(filename="awaiting.log", state=AttachmentFeedbackState.AWAITING_LINK)],
        wait_for_result=True,
    )
    assert summary.reactions == ("ok", "warn")
    assert "администратору" in summary.reply_text and "привязать" in summary.reply_text
    assert "обработан" not in summary.reply_text


def test_single_failed_result_includes_its_own_error() -> None:
    summary = build_message_feedback(
        [
            AttachmentFeedbackResult(
                filename="bad.log", state=AttachmentFeedbackState.PROCESSED_FAILED, error_message="job-specific"
            )
        ],
        wait_for_result=True,
    )
    assert "job-specific" in summary.reply_text
