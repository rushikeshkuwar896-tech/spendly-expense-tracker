# 💸 Spendly — AI Expense Intelligence

A **premium, production-ready expense tracker** built with Flask and a stunning glassmorphism frontend. Powered by AI predictions and anomaly detection.

![Python](https://img.shields.io/badge/Python-3.9+-blue) ![Flask](https://img.shields.io/badge/Flask-3.0+-green) ![SQLite](https://img.shields.io/badge/DB-SQLite-orange)

## ✨ Features

- 🔐 **JWT Authentication** — Secure register/login, multi-user support
- 📊 **Interactive Dashboard** — Live KPIs, Chart.js trend & donut charts
- 💳 **Full Expense CRUD** — Add, edit, delete with category filtering & search
- 🤖 **AI Insights** — Linear trend prediction + IsolationForest anomaly detection
- 🎯 **Budget Manager** — Per-category limits with live progress bars
- 📈 **Analytics** — Monthly bar chart, category pie, weekday heatmap
- ⚙️ **Settings** — Profile edit, password change, currency selection
- 📱 **Fully Responsive** — Mobile sidebar, touch-friendly UI
- 🚀 **Deploy-Ready** — gunicorn + Procfile for Railway/Render/Heroku

## 🚀 Quick Start (Local)

```bash
# 1. Clone or navigate to project
cd "expense tracker"

# 2. Create & activate virtual environment
python3 -m venv venv
source venv/bin/activate  # macOS/Linux
# venv\Scripts\activate   # Windows

# 3. Install dependencies
pip install -r requirements.txt

# 4. Set up environment (optional)
cp .env.example .env
# Edit .env and set JWT_SECRET_KEY

# 5. Run the app
python app.py

# Open http://localhost:5000
```

## 🌐 Deploy to Railway (Free)

1. Push to GitHub
2. Go to [railway.app](https://railway.app) → **New Project → Deploy from GitHub**
3. Select your repo
4. Add environment variable: `JWT_SECRET_KEY` = (any long random string)
5. Railway auto-detects the `Procfile` and deploys

## 🌐 Deploy to Render (Free)

1. Push to GitHub
2. Go to [render.com](https://render.com) → **New → Web Service**
3. Connect your repo
4. Set **Build Command**: `pip install -r requirements.txt`
5. Set **Start Command**: `gunicorn app:app`
6. Add environment variable: `JWT_SECRET_KEY`
7. Click **Create Web Service**

## 📁 Project Structure

```
expense tracker/
├── app.py              # Flask REST API server
├── expense_model.py    # ML predictions & AI insights
├── data_handler.py     # Legacy (replaced by SQLAlchemy)
├── requirements.txt    # Python dependencies
├── Procfile            # Deployment process file
├── .env.example        # Environment template
├── data/
│   └── expenses.db     # SQLite database (auto-created)
└── static/
    ├── index.html      # SPA frontend
    ├── css/
    │   └── styles.css  # Premium design system
    └── js/
        └── app.js      # SPA logic & API client
```

## 🛡️ API Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/auth/register` | ❌ | Create account |
| POST | `/api/auth/login` | ❌ | Login & get JWT |
| GET/PUT | `/api/auth/profile` | ✅ | View/update profile |
| GET/POST | `/api/expenses` | ✅ | List/create expenses |
| PUT/DELETE | `/api/expenses/:id` | ✅ | Edit/delete expense |
| GET | `/api/analytics/summary` | ✅ | Full analytics summary |
| GET | `/api/analytics/weekly` | ✅ | Weekday spending |
| GET/POST | `/api/budgets` | ✅ | List/set budgets |
| DELETE | `/api/budgets/:id` | ✅ | Remove budget |
