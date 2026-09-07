"""Generate top-safe portrait focal points with OpenCV YuNet face detection."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageOps


PROJECT_ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = PROJECT_ROOT / "assets" / "unsorted"
OVERRIDES_PATH = PROJECT_ROOT / "assets" / "focus-overrides.json"
SUPPORTED_EXTENSIONS = {".avif", ".jpeg", ".jpg", ".png", ".webp"}


def load_detector(model_path: Path) -> cv2.FaceDetectorYN:
    if not model_path.is_file():
        raise FileNotFoundError(f"YuNet model not found: {model_path}")
    return cv2.FaceDetectorYN.create(str(model_path), "", (320, 320), 0.62, 0.3, 5000)


def load_image(path: Path) -> tuple[Image.Image, np.ndarray]:
    with Image.open(path) as source:
        image = ImageOps.exif_transpose(source).convert("RGB")
    return image, cv2.cvtColor(np.asarray(image), cv2.COLOR_RGB2BGR)


def detect_primary_face(image: np.ndarray, detector: cv2.FaceDetectorYN) -> tuple[int, int, int, int] | None:
    height, width = image.shape[:2]
    scale = min(1.0, 1100 / max(width, height))
    working = cv2.resize(image, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA) if scale < 1 else image
    detector.setInputSize((working.shape[1], working.shape[0]))
    _, faces = detector.detect(working)
    if faces is None or len(faces) == 0:
        return None

    def score(face: np.ndarray) -> float:
        x, y, face_width, face_height = face[:4]
        confidence = float(face[14])
        center_x = (x + face_width / 2) / working.shape[1]
        center_y = (y + face_height / 2) / working.shape[0]
        centrality = 1 - min(0.45, abs(center_x - 0.5) * 0.55)
        upper_bias = 1 - min(0.3, max(0, center_y - 0.58) * 0.7)
        return face_width * face_height * confidence * centrality * upper_bias

    x, y, face_width, face_height = max(faces, key=score)[:4]
    inverse_scale = 1 / scale
    return tuple(round(value * inverse_scale) for value in (x, y, face_width, face_height))


def make_preview(records: list[dict], output_path: Path) -> None:
    columns, cell_width, cell_height = 5, 230, 245
    rows = (len(records) + columns - 1) // columns
    sheet = Image.new("RGB", (columns * cell_width, rows * cell_height), "#111318")
    draw = ImageDraw.Draw(sheet)

    for index, record in enumerate(records):
        image = record["image"].copy()
        face = record["face"]
        if face:
            box_draw = ImageDraw.Draw(image)
            x, y, width, height = face
            box_draw.rectangle((x, y, x + width, y + height), outline="#d6ff51", width=max(3, image.width // 300))
        image.thumbnail((cell_width - 12, cell_height - 38), Image.Resampling.LANCZOS)
        left = (index % columns) * cell_width + (cell_width - image.width) // 2
        top = (index // columns) * cell_height + 4
        sheet.paste(image, (left, top))
        label = f"{record['filename']}  x={record['focus_x']}  {'face' if face else 'fallback'}"
        draw.text(((index % columns) * cell_width + 6, (index // columns) * cell_height + cell_height - 27), label, fill="#f4f1e8")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(output_path, quality=90)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", type=Path, required=True, help="Path to OpenCV Zoo's YuNet ONNX model.")
    parser.add_argument("--preview", type=Path, help="Optional contact sheet showing detected face boxes.")
    args = parser.parse_args()
    detector = load_detector(args.model.resolve())
    overrides: dict[str, dict[str, int]] = {}
    records: list[dict] = []

    paths = sorted(
        (path for path in SOURCE_DIR.iterdir() if path.is_file() and path.suffix.lower() in SUPPORTED_EXTENSIONS),
        key=lambda path: path.name.casefold(),
    )
    detected = 0
    for path in paths:
        pil_image, cv_image = load_image(path)
        face = detect_primary_face(cv_image, detector)
        if face:
            x, _, width, _ = face
            focus_x = round(max(20, min(80, ((x + width / 2) / pil_image.width) * 100)))
            detected += 1
        else:
            focus_x = 50
        # Keeping y at zero guarantees that cover cropping never removes the top edge.
        overrides[path.name] = {"x": focus_x, "y": 0}
        records.append({"filename": path.name, "image": pil_image, "face": face, "focus_x": focus_x})

    OVERRIDES_PATH.write_text(json.dumps(overrides, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    if args.preview:
        make_preview(records, args.preview.resolve())
    print(f"Detected a primary face in {detected}/{len(paths)} images; wrote {OVERRIDES_PATH.relative_to(PROJECT_ROOT)}.")


if __name__ == "__main__":
    main()
