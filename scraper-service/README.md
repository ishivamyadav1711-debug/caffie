# Leads Scraper (Python Reddit & Hacker News Intelligence)

A standalone Python scraper service that extracts real discussions from **Reddit** and **Hacker News**, scores purchase and keyword match intent as a percentage (0–100%), and sorts results percentage-wise (highest match first).

## Features

- **Multi-Platform Real-Time Scraping**: Queries Reddit JSON search (with resilient Arctic-Shift fallback) and Hacker News Algolia search API.
- **Wheel Alloy Percentage Selector**: Interactive percentage threshold slider and presets (0%+, 50%+, 70%+, 85%+) to filter leads based on match relevance and intent signals.
- **Percentage-Wise Sorting**: All results are automatically calculated and sorted from highest percentage to lowest percentage.
- **Interactive UI Dashboard**: Built-in modern single-page dashboard served directly at `http://localhost:8000`.
- **RESTful API**: Standardized JSON endpoints (`/scrape` and `/health`) for easy integration into downstream workflows.
- **Data Export**: One-click export to CSV and JSON.

## Quickstart

### 1. Install Dependencies
```bash
pip install -r requirements.txt
```

### 2. Run the Service
```bash
python main.py
```
Or with Uvicorn:
```bash
uvicorn main:app --host 127.0.0.1 --port 8000 --reload
```

### 3. Access Dashboard & API
- **Web UI Dashboard**: [http://localhost:8000](http://localhost:8000)
- **Interactive API Docs (Swagger)**: [http://localhost:8000/docs](http://localhost:8000/docs)
- **Health Check**: [http://localhost:8000/health](http://localhost:8000/health)

## REST API Examples

### GET Request with Wheel Alloy Query & 70% Filter
```bash
curl "http://127.0.0.1:8000/scrape?keyword=wheel%20alloy&min_percentage=70&limit=20"
```

### POST Request
```bash
curl -X POST "http://127.0.0.1:8000/scrape" \
     -H "Content-Type: application/json" \
     -d '{"keyword": "looking for alloy wheels", "min_percentage": 50, "limit": 25}'
```

### Response Schema
```json
{
  "success": true,
  "keyword": "wheel alloy",
  "min_percentage": 70,
  "count": 12,
  "results": [
    {
      "platform": "reddit",
      "author": "car_enthusiast",
      "title": "Looking for 18-inch wheel alloy recommendations",
      "text": "Need recommendations for durable forged alloy wheels with 5x114.3 PCD...",
      "url": "https://www.reddit.com/r/Wheels/...",
      "match_percentage": 92,
      "intent_signal": "Exact phrase match • Automotive context (alloy, wheel, rims) • Active buyer/recommendation intent"
    }
  ]
}
```
