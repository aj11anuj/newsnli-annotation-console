# NewsNLI Audio Annotator

A lightweight, local web application designed for dataset annotators to record high-quality speech samples for Natural Language Inference (NLI) sentence pairs. Built with **FastAPI** (Python) on the backend and **Vanilla HTML/CSS/JS** on the frontend, featuring a beautiful dark-mode interface with micro-animations.

## Key Features

- **CSV Dataset Uploading:** Drag and drop your NLI dataset to parse instantly.
- **Hover-to-Record:** Recording starts automatically when hovering over the record button—no clicking required. Moving the cursor away stops recording, saves the audio, and auto-advances to the next sample.
- **Session Auto-Resume:** Tracks annotator progress. If they reopen the app or reload the page, they pick up right where they left off.
- **Organized Local Storage:** Automatically creates directories named after the uploaded CSV file inside the `recordings/` folder.
- **Automated Excel-Ready Manifest:** Saves audio files dynamically as `sample_{number}.webm` and automatically generates/updates an `annotations.csv` file inside the dataset's folder. The audio paths in this sheet are written as Excel-ready `=HYPERLINK()` formulas for one-click listening.

## Getting Started

### 1. Prerequisites
Make sure you have **Python 3.8+** installed.

### 2. Installation
Clone the repository and install the required dependencies:
```bash
pip install -r requirements.txt
```

### 3. Running the Server
Run the local FastAPI server:
```bash
python main.py
```
After starting the server, open your browser and navigate to:
```
http://localhost:3000
```

### 4. Watch the demo of the application
```
https://youtu.be/-hamYYG2wY4
```

## Dataset Format

### Input CSV Requirement
The uploaded CSV file must contain at least the following column headers (case-insensitive):
- `premise`: The main statement or context.
- `hypothesis`: The proposed statement to test against the premise.
- `category` (optional): The NLI label (e.g., *Entailment*, *Contradiction*, *Neutral*).

### Output Directory Structure
As annotators record, files are written directly to the project directory:
```
NewsNLI/
├── recordings/
│   └── <Uploaded_CSV_Filename>/
│       ├── annotations.csv    # Merged dataset containing text and audio paths
│       ├── sample_0.webm      # Audio recording for sample 0
│       ├── sample_1.webm      # Audio recording for sample 1
│       └── ...
```

### `annotations.csv` Format
The output manifest file matches each recording back to its original row:

| sample_number | premise | hypothesis | category | audio_path |
| :--- | :--- | :--- | :--- | :--- |
| 0 | Sentence... | Another sentence... | Entailment | `=HYPERLINK("sample_0.webm", "sample_0.webm")` |
| 1 | Sentence... | Another sentence... | Neutral | `=HYPERLINK("sample_1.webm", "sample_1.webm")` |

*(Opening this file in Microsoft Excel or Google Sheets converts the `audio_path` cells into clickable play links.)*

## Technical Stack
- **Backend:** FastAPI (Starlette + Uvicorn)
- **Frontend:** HTML5, CSS3 Custom Properties, Vanilla ES6 JavaScript (MediaRecorder API)
- **Styling:** Premium dark-mode glassmorphism with responsive flexbox layouts
