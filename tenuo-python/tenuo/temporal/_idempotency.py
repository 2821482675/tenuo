"""Retry-stable operation identifiers for Tenuo-protected Activities."""

from __future__ import annotations

import contextvars
import hashlib
from contextlib import contextmanager
from typing import Iterator, Optional

from tenuo.temporal.exceptions import TenuoContextError


_DOMAIN = b"tenuo.temporal.idempotency.v1\x00"
_current_key: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar(
    "tenuo_temporal_idempotency_key", default=None
)


def _derive_idempotency_key(
    warrant_id: str,
    workflow_run_id: str,
    activity_id: str,
) -> str:
    """Derive an opaque key with unambiguous, versioned framing."""
    digest = hashlib.sha256()
    digest.update(_DOMAIN)
    for value in (warrant_id, workflow_run_id, activity_id):
        encoded = value.encode("utf-8")
        digest.update(len(encoded).to_bytes(8, "big"))
        digest.update(encoded)
    return f"tnu_op_v1_{digest.hexdigest()}"


@contextmanager
def _activity_idempotency_context(
    warrant_id: str,
    workflow_run_id: str,
    activity_id: str,
) -> Iterator[str]:
    """Install the key while a successfully authorized Activity executes."""
    if not warrant_id or not workflow_run_id or not activity_id:
        raise TenuoContextError(
            "Cannot derive an idempotency key without warrant, workflow run, and activity identifiers."
        )
    key = _derive_idempotency_key(warrant_id, workflow_run_id, activity_id)
    token = _current_key.set(key)
    try:
        yield key
    finally:
        _current_key.reset(token)


def current_idempotency_key() -> str:
    """Return this authorized Activity's stable downstream idempotency key.

    The key is identical across Temporal retry attempts for the same scheduled
    Activity, and differs across warrants, workflow runs, and Activity IDs.
    Call this only from an Activity running behind Tenuo's worker interceptor.
    """
    key = _current_key.get()
    if key is None:
        raise TenuoContextError(
            "No Tenuo Activity idempotency context is active. Call "
            "current_idempotency_key() from an authorized Activity running "
            "behind TenuoWorkerInterceptor."
        )
    return key
