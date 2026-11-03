import io
import json
import os
import unittest
from unittest.mock import MagicMock, patch

import controller


class NotionControllerTests(unittest.TestCase):
    def test_missing_token_blocks_before_request(self):
        with patch.dict(os.environ, {}, clear=True), patch.object(controller.urllib.request, "urlopen") as request:
            with self.assertRaisesRegex(controller.NotionControllerError, "NOTION_API_KEY"):
                controller.search("my docs")
            request.assert_not_called()

    def test_invalid_page_id_is_rejected(self):
        with self.assertRaises(controller.NotionControllerError):
            controller.retrieve_page("not-a-page-id")

    def test_append_text_splits_into_safe_rich_text_chunks(self):
        payload = {"children": []}
        response = MagicMock()
        response.read.return_value = json.dumps({"results": []}).encode()
        response.__enter__.return_value = response
        with patch.dict(os.environ, {"NOTION_API_KEY": "test-secret"}), patch.object(
            controller.urllib.request, "urlopen", return_value=response
        ) as request:
            controller.append_text("0123456789abcdef0123456789abcdef", "x" * 2000)
        body = json.loads(request.call_args.args[0].data.decode())
        self.assertEqual(len(body["children"]), 2)
        self.assertLessEqual(len(body["children"][0]["paragraph"]["rich_text"][0]["text"]["content"]), 1800)


if __name__ == "__main__":
    unittest.main()
