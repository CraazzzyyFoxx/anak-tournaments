"""Match-log size cap: one message, every enforcement path."""


def match_log_oversize_message(nbytes: int, max_bytes: int, *, filename: str | None = None) -> str | None:
    if nbytes <= max_bytes:
        return None
    who = f"Log file {filename}" if filename else "Log file"
    return f"{who} exceeds the maximum size of {max_bytes} bytes"
