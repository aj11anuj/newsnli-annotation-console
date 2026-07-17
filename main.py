import json
import os
import re
from pathlib import Path

from fastapi import FastAPI, File, Form, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

app = FastAPI(title="NewsNLI Audio Annotator")

BASE_DIR = Path(__file__).resolve().parent
RECORDINGS_DIR = BASE_DIR / "recordings"
PROGRESS_FILE = RECORDINGS_DIR / ".progress.json"
PUBLIC_DIR = BASE_DIR / "public"


def _sanitize(name: str) -> str:
    """Remove .csv extension and replace unsafe filesystem characters."""
    name = re.sub(r"\.csv$", "", name, flags=re.IGNORECASE)
    return re.sub(r"[^a-zA-Z0-9_\-\s]", "_", name).strip()


# ──────────────────── API routes ────────────────────


@app.post("/api/save-audio")
async def save_audio(
    audio: UploadFile = File(...),
    folderName: str = Form(...),
    sampleNumber: str = Form("0"),
    premise: str = Form(""),
    hypothesis: str = Form(""),
    category: str = Form(""),
):
    safe_folder = _sanitize(folderName)
    folder_path = RECORDINGS_DIR / safe_folder
    folder_path.mkdir(parents=True, exist_ok=True)

    filename = f"sample_{sampleNumber}.webm"
    file_path = folder_path / filename

    contents = await audio.read()
    file_path.write_bytes(contents)

    # ── Update the annotations manifest CSV ──
    try:
        _update_manifest(folder_path, int(sampleNumber), filename, premise, hypothesis, category)
    except PermissionError:
        from fastapi import HTTPException
        raise HTTPException(
            status_code=400,
            detail="Could not write to annotations.csv. Please close it in Excel or other programs first."
        )
    except Exception as e:
        from fastapi import HTTPException
        raise HTTPException(status_code=500, detail=f"Failed to update manifest: {str(e)}")

    print(f"  > Saved: {file_path}")
    return {"success": True, "filename": filename, "path": str(file_path)}


def _update_manifest(folder_path: Path, sample_num: int, audio_filename: str,
                     premise: str, hypothesis: str, category: str):
    """Create or update annotations.csv with the audio_path column."""
    import csv

    manifest_path = folder_path / "annotations.csv"
    fieldnames = ["sample_number", "premise", "hypothesis", "category", "audio_path"]

    # Read existing rows (if any)
    rows: dict[int, dict] = {}
    if manifest_path.exists():
        with open(manifest_path, "r", encoding="utf-8", newline="") as f:
            reader = csv.DictReader(f)
            for row in reader:
                try:
                    rows[int(row["sample_number"])] = row
                except (KeyError, ValueError):
                    continue

    # Upsert the current sample with Excel/Sheets Hyperlink formula
    rows[sample_num] = {
        "sample_number": str(sample_num),
        "premise": premise,
        "hypothesis": hypothesis,
        "category": category,
        "audio_path": f'=HYPERLINK("{audio_filename}", "{audio_filename}")',
    }

    # Write back sorted by sample number
    with open(manifest_path, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for key in sorted(rows.keys()):
            writer.writerow(rows[key])


@app.post("/api/save-progress")
async def save_progress(body: dict):
    csv_name = body.get("csvName", "")
    current_index = body.get("currentIndex", 0)
    total_samples = body.get("totalSamples", 0)

    RECORDINGS_DIR.mkdir(parents=True, exist_ok=True)

    progress: dict = {}
    if PROGRESS_FILE.exists():
        try:
            progress = json.loads(PROGRESS_FILE.read_text(encoding="utf-8"))
        except Exception:
            progress = {}

    from datetime import datetime, timezone

    progress[csv_name] = {
        "currentIndex": current_index,
        "totalSamples": total_samples,
        "lastUpdated": datetime.now(timezone.utc).isoformat(),
    }
    PROGRESS_FILE.write_text(json.dumps(progress, indent=2), encoding="utf-8")
    return {"success": True}


@app.get("/api/load-progress")
async def load_progress():
    if PROGRESS_FILE.exists():
        try:
            progress = json.loads(PROGRESS_FILE.read_text(encoding="utf-8"))
            return {"success": True, "progress": progress}
        except Exception:
            pass
    return {"success": True, "progress": {}}


@app.get("/api/check-recordings/{folder_name}")
async def check_recordings(folder_name: str):
    safe_folder = _sanitize(folder_name)
    folder_path = RECORDINGS_DIR / safe_folder

    if not folder_path.exists():
        return {"success": True, "recorded": []}

    recorded = []
    for f in folder_path.iterdir():
        if f.name.startswith("sample_") and f.name.endswith(".webm"):
            try:
                num = int(f.stem.replace("sample_", ""))
                recorded.append(num)
            except ValueError:
                continue

    return {"success": True, "recorded": sorted(recorded)}


# ──────────────── No-cache middleware ────────────────

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request


class NoCacheMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
        return response


app.add_middleware(NoCacheMiddleware)


# ──────────────── Serve frontend ────────────────

# Mount static assets (css, js)
app.mount("/css", StaticFiles(directory=str(PUBLIC_DIR / "css")), name="css")
app.mount("/js", StaticFiles(directory=str(PUBLIC_DIR / "js")), name="js")


@app.get("/")
async def serve_index():
    return FileResponse(
        str(PUBLIC_DIR / "index.html"),
        headers={"Cache-Control": "no-store"},
    )


# ──────────────── Entrypoint ────────────────

if __name__ == "__main__":
    import uvicorn

    print()
    print("  +------------------------------------------+")
    print("  |   NewsNLI Audio Annotator is running!    |")
    print("  |                                          |")
    print("  |   Open: http://localhost:3000             |")
    print("  +------------------------------------------+")
    print()
    uvicorn.run(app, host="127.0.0.1", port=3000)
