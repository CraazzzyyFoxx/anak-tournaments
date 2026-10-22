"""An unreachable object store fails fast, as a 503 the client can name.

It used to take botocore's defaults -- 60 s connect/read timeouts and five
legacy-mode attempts -- and then surface the raw ``EndpointConnectionError`` as
a generic ``500 internal error``: the admin uploading an image waited most of a
minute to learn nothing.
"""

from __future__ import annotations

import time
from unittest import IsolatedAsyncioTestCase

from shared.clients.s3 import S3Client, StorageUnavailableError
from shared.rpc.common import envelope


class _Session:
    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc) -> bool:
        return False


class _Logger:
    def exception(self, *args, **kwargs) -> None:
        return None


class TestUnreachableStorage(IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        # Port 1 on loopback refuses at once, so the clock measures retries, not the network.
        self.s3 = S3Client(access_key="k", secret_key="s", endpoint_url="http://127.0.0.1:1", bucket_name="aqt")
        await self.s3.start()

    async def test_every_operation_raises_storage_unavailable_quickly(self) -> None:
        for name, call in (
            ("put_object", lambda: self.s3.put_object("assets/x.png", b"x", "image/png", public=True)),
            ("delete_prefix", lambda: self.s3.delete_prefix("avatars/workspaces/1/")),
            ("get_object", lambda: self.s3.get_object("logs/1.txt")),
        ):
            with self.subTest(name):
                started = time.monotonic()
                with self.assertRaises(StorageUnavailableError) as caught:
                    await call()
                # Two attempts; Windows spends ~2 s on each refused connect. The old defaults took 20 s here.
                self.assertLess(time.monotonic() - started, 10)
                self.assertEqual(caught.exception.status_code, 503)

    async def test_the_rpc_envelope_names_it(self) -> None:
        async def op(_session):
            await self.s3.put_object("assets/x.png", b"x", "image/png")

        reply = await envelope(_Logger(), "assets.upload", op, session_factory=_Session)

        self.assertEqual(reply["error"]["code"], "unavailable")
        self.assertEqual([f["code"] for f in reply["error"]["details"]["fields"]], ["storage_unavailable"])
