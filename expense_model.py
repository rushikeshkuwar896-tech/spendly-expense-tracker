import pandas as pd
import numpy as np

CATEGORIES = ['Food', 'Rent', 'Travel', 'Shopping', 'Bills', 'Health', 'Entertainment', 'Education', 'Other']


def predict_expenses(df):
    """Predicts next month's total spending using linear regression on monthly aggregates."""
    if len(df) < 5:
        return None
    try:
        df = df.copy()
        df['Date'] = pd.to_datetime(df['Date'])
        monthly = df.set_index('Date').resample('ME')['Amount'].sum().reset_index()

        if len(monthly) < 2:
            return round(float(monthly['Amount'].iloc[0]), 2)

        X = np.arange(len(monthly)).reshape(-1, 1)
        y = monthly['Amount'].values

        from sklearn.linear_model import LinearRegression
        model = LinearRegression().fit(X, y)
        prediction = model.predict([[len(monthly)]])[0]
        return round(max(0, float(prediction)), 2)
    except Exception:
        return None


def detect_anomalies(df):
    """Detects spending outliers using Isolation Forest."""
    if len(df) < 5:
        return pd.DataFrame()
    try:
        from sklearn.ensemble import IsolationForest
        df = df.copy()
        amounts = df[['Amount']].values
        model = IsolationForest(contamination=0.1, random_state=42)
        df['anomaly_flag'] = model.fit_predict(amounts)
        return df[df['anomaly_flag'] == -1].drop(columns=['anomaly_flag'])
    except Exception:
        return pd.DataFrame()


def get_spending_insights(df, monthly_income: float) -> list:
    """Returns a list of plain English spending insight strings."""
    insights = []
    if df.empty or monthly_income <= 0:
        return insights

    try:
        df = df.copy()
        df['Amount'] = df['Amount'].astype(float)
        df['Date'] = pd.to_datetime(df['Date'])

        total = df['Amount'].sum()
        by_cat = df.groupby('Category')['Amount'].sum()
        top_cat = by_cat.idxmax()
        top_pct = (by_cat[top_cat] / total * 100) if total > 0 else 0

        savings_rate = ((monthly_income - total) / monthly_income * 100) if monthly_income > 0 else 0

        # Savings insight
        if savings_rate >= 30:
            insights.append(f"🎉 Excellent! You're saving {savings_rate:.0f}% of your income. Keep it up!")
        elif savings_rate >= 15:
            insights.append(f"👍 Good saving rate of {savings_rate:.0f}%. Aim for 30%+ for financial freedom.")
        elif savings_rate > 0:
            insights.append(f"⚠️ Your saving rate is {savings_rate:.0f}%. Try to cut back on non-essentials.")
        else:
            insights.append(f"🚨 You're overspending! You've spent ₹{total - monthly_income:,.0f} more than your income.")

        # Top category insight
        if top_pct > 40:
            insights.append(f"📊 {top_cat} alone takes up {top_pct:.0f}% of your spending — consider setting a budget for it.")

        # Weekly spending pattern
        df['week'] = df['Date'].dt.isocalendar().week
        weekly_avg = df.groupby('week')['Amount'].sum().mean()
        if weekly_avg > (monthly_income / 4 * 0.7):
            insights.append(f"📅 You average ₹{weekly_avg:,.0f}/week — that's a fast pace. Track daily spending!")

        # Food spending check
        if 'Food' in by_cat and (by_cat['Food'] / total * 100) > 30:
            insights.append(f"🍔 Food expenses are unusually high at {(by_cat['Food'] / total * 100):.0f}% of spending. Meal prep can help!")

        # Entertainment check
        if 'Entertainment' in by_cat and by_cat['Entertainment'] > monthly_income * 0.1:
            insights.append(f"🎬 Entertainment spending exceeds 10% of income. Look for free alternatives!")

        if not insights:
            insights.append("✅ Your spending looks balanced. Add a budget to stay on track!")

    except Exception:
        pass

    return insights