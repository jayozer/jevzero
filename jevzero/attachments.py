"""Local rendering of attachment bytes to page images. Bytes never leave this module."""

import base64
import io

import pypdfium2 as pdfium
from PIL import Image

IMAGE_MIMES = {"image/png", "image/jpeg", "image/gif", "image/webp"}
SUPPORTED = IMAGE_MIMES | {"application/pdf"}
MAX_BYTES = 15_000_000
MAX_SIDE = 1568
MAX_PAGES = 8
DEFAULT_PAGES = 3
SCALE = 1.5  # 108 dpi: body text stays readable, tokens stay bounded.


def unsupported_reason(meta):
    """A reason to skip the fetch entirely, decided from metadata alone."""
    if not meta.get("id"):
        return "inline"
    if meta.get("mime") not in SUPPORTED:
        return "unsupported_type"
    if meta.get("size", 0) > MAX_BYTES:
        return "too_large"
    return None


def shrink(image):
    image = image.convert("RGB")
    image.thumbnail((MAX_SIDE, MAX_SIDE))
    return image


def data_url(image, fmt="PNG"):
    out = io.BytesIO()
    image.save(out, fmt, **({"quality": 85} if fmt == "JPEG" else {}))
    mime = "image/jpeg" if fmt == "JPEG" else "image/png"
    return f"data:{mime};base64," + base64.b64encode(out.getvalue()).decode()


def render_pages(data, mime, limit=DEFAULT_PAGES):
    """Return (data_urls, total_pages, reason). A reason means nothing is sent."""
    limit = max(1, min(int(limit), MAX_PAGES))
    if len(data) > MAX_BYTES:
        return [], 0, "too_large"
    if mime in IMAGE_MIMES:
        try:
            with Image.open(io.BytesIO(data)) as image:
                image.load()
                return [data_url(shrink(image), "JPEG" if mime == "image/jpeg" else "PNG")], 1, None
        except (OSError, ValueError, Image.DecompressionBombError):
            return [], 0, "unreadable_image"
    if mime != "application/pdf":
        return [], 0, "unsupported_type"
    try:
        pdf = pdfium.PdfDocument(data)  # Raises for a password or a broken file.
    except pdfium.PdfiumError:
        return [], 0, "unreadable_pdf"
    try:
        total = len(pdf)
        if total == 0:
            return [], 0, "unreadable_pdf"
        urls = []
        for index in range(min(total, limit)):
            page = pdf[index]
            bitmap = page.render(scale=SCALE)
            urls.append(data_url(shrink(bitmap.to_pil())))
            page.close()
        return urls, total, None
    except pdfium.PdfiumError:
        return [], 0, "unreadable_pdf"
    finally:
        pdf.close()
