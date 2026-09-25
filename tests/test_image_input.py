import base64
from pathlib import Path
import tempfile
import unittest

from aidream.image_input import (
    MAX_IMAGE_BYTES,
    ImageAttachment,
    ImageInputError,
    build_multimodal_message,
    load_image_attachment,
)


PNG = b"\x89PNG\r\n\x1a\n" + b"test-image"


class ImageInputTests(unittest.TestCase):
    def test_loads_image_and_uses_detected_mime_even_with_wrong_extension(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "image.txt"
            path.write_bytes(PNG)
            attachment = load_image_attachment(path)
            self.assertEqual(attachment.mime_type, "image/png")
            self.assertEqual(attachment.size_bytes, len(PNG))
            self.assertEqual(attachment.data_uri,
                             "data:image/png;base64," + base64.b64encode(PNG).decode())

    def test_rejects_empty_and_non_raster_files(self):
        with tempfile.TemporaryDirectory() as temp:
            for data in (b"", b"not an image", b"<svg></svg>"):
                path = Path(temp) / "image.png"
                path.write_bytes(data)
                with self.subTest(data=data), self.assertRaises(ImageInputError):
                    load_image_attachment(path)

    def test_rejects_oversized_file_before_loading(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "large.png"
            path.write_bytes(b"\x89PNG\r\n\x1a\n" + b"0" * MAX_IMAGE_BYTES)
            with self.assertRaisesRegex(ImageInputError, "limit"):
                load_image_attachment(path)

    def test_rejects_missing_file(self):
        with tempfile.TemporaryDirectory() as temp:
            with self.assertRaisesRegex(ImageInputError, "Could not read"):
                load_image_attachment(Path(temp) / "missing.png")

    def test_builds_openai_compatible_multimodal_message(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "image.png"
            path.write_bytes(PNG)
            image = load_image_attachment(path)
            message = build_multimodal_message("What is in this picture?", [image])
            self.assertEqual(message, {
                "role": "user",
                "content": [
                    {"type": "text", "text": "What is in this picture?"},
                    {"type": "image_url", "image_url": {"url": image.data_uri}},
                ],
            })

    def test_builder_rejects_forged_data_uri(self):
        forged = ImageAttachment(None, "image/png", len(PNG), "data:image/png;base64,Zm9v")
        with self.assertRaisesRegex(ImageInputError, "does not match"):
            build_multimodal_message("", [forged])

    def test_builder_rejects_assistant_role(self):
        with self.assertRaisesRegex(ImageInputError, "roles"):
            build_multimodal_message("", [], role="assistant")


if __name__ == "__main__":
    unittest.main()
