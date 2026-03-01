import os
import io
import csv
import json
import requests as req_lib
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from datetime import datetime, timedelta, date
from functools import wraps

from flask import Flask, request, jsonify, send_from_directory, Response, stream_with_context
from flask_sqlalchemy import SQLAlchemy
from flask_cors import CORS
from flask_jwt_extended import (
    JWTManager, create_access_token, jwt_required, get_jwt_identity
)
from werkzeug.security import generate_password_hash, check_password_hash
from dotenv import load_dotenv

from expense_model import predict_expenses, detect_anomalies, get_spending_insights

load_dotenv()

# ─── App Setup ────────────────────────────────────────────────────────────────
BASE_DIR = os.path.abspath(os.path.dirname(__file__))
STATIC_DIR = os.path.join(BASE_DIR, 'static')

app = Flask(__name__, static_folder=STATIC_DIR, static_url_path='')
CORS(app)

app.config['SQLALCHEMY_DATABASE_URI'] = f"sqlite:///{os.path.join(BASE_DIR, 'data', 'expenses.db')}"
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['JWT_SECRET_KEY'] = os.environ.get('JWT_SECRET_KEY', 'spendly-super-secret-key-32bytes!')
app.config['JWT_ACCESS_TOKEN_EXPIRES'] = timedelta(days=7)
app.config['JWT_TOKEN_LOCATION'] = ['headers']
app.config['JWT_HEADER_NAME'] = 'Authorization'
app.config['JWT_HEADER_TYPE'] = 'Bearer'

db = SQLAlchemy(app)
jwt = JWTManager(app)

# ─── JWT Error Handlers ───────────────────────────────────────────────────────
@jwt.unauthorized_loader
def unauthorized_callback(reason):
    return jsonify({'error': 'Missing or invalid token', 'reason': reason}), 401

@jwt.invalid_token_loader
def invalid_token_callback(reason):
    return jsonify({'error': 'Invalid token', 'reason': reason}), 401

@jwt.expired_token_loader
def expired_token_callback(jwt_header, jwt_data):
    return jsonify({'error': 'Token expired. Please log in again.'}), 401

# ─── Models ───────────────────────────────────────────────────────────────────
class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    email = db.Column(db.String(120), unique=True, nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)
    monthly_income = db.Column(db.Float, default=0.0)
    currency = db.Column(db.String(10), default='INR')
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    expenses = db.relationship('Expense', backref='user', lazy=True, cascade='all, delete-orphan')
    budgets = db.relationship('Budget', backref='user', lazy=True, cascade='all, delete-orphan')
    goals = db.relationship('Goal', backref='user', lazy=True, cascade='all, delete-orphan')


class Expense(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    date = db.Column(db.String(20), nullable=False)
    category = db.Column(db.String(50), nullable=False)
    amount = db.Column(db.Float, nullable=False)
    notes = db.Column(db.String(255), default='')
    is_recurring = db.Column(db.Boolean, default=False)
    recurring_day = db.Column(db.Integer, default=None)   # day of month (1-28)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            'id': self.id,
            'date': self.date,
            'category': self.category,
            'amount': self.amount,
            'notes': self.notes,
            'is_recurring': self.is_recurring,
            'recurring_day': self.recurring_day,
            'created_at': self.created_at.isoformat()
        }


class Budget(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    category = db.Column(db.String(50), nullable=False)
    limit_amount = db.Column(db.Float, nullable=False)

    __table_args__ = (db.UniqueConstraint('user_id', 'category'),)

    def to_dict(self):
        return {
            'id': self.id,
            'category': self.category,
            'limit_amount': self.limit_amount
        }


class Goal(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    name = db.Column(db.String(100), nullable=False)
    target_amount = db.Column(db.Float, nullable=False)
    saved_amount = db.Column(db.Float, default=0.0)
    deadline = db.Column(db.String(20), nullable=True)  # YYYY-MM-DD
    emoji = db.Column(db.String(10), default='🎯')
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'target_amount': self.target_amount,
            'saved_amount': self.saved_amount,
            'deadline': self.deadline,
            'emoji': self.emoji,
            'created_at': self.created_at.isoformat()
        }

# ─── Auth Routes ──────────────────────────────────────────────────────────────
@app.route('/api/auth/register', methods=['POST'])
def register():
    data = request.get_json()
    required = ['name', 'email', 'password']
    if not all(k in data for k in required):
        return jsonify({'error': 'Missing required fields'}), 400

    if User.query.filter_by(email=data['email'].lower()).first():
        return jsonify({'error': 'Email already registered'}), 409

    user = User(
        name=data['name'].strip(),
        email=data['email'].lower().strip(),
        password_hash=generate_password_hash(data['password']),
        monthly_income=float(data.get('monthly_income', 0)),
        currency=data.get('currency', 'INR')
    )
    db.session.add(user)
    db.session.commit()

    token = create_access_token(identity=str(user.id))
    return jsonify({
        'token': token,
        'user': {'id': user.id, 'name': user.name, 'email': user.email,
                 'monthly_income': user.monthly_income, 'currency': user.currency}
    }), 201


@app.route('/api/auth/login', methods=['POST'])
def login():
    data = request.get_json()
    user = User.query.filter_by(email=data.get('email', '').lower()).first()
    if not user or not check_password_hash(user.password_hash, data.get('password', '')):
        return jsonify({'error': 'Invalid email or password'}), 401

    token = create_access_token(identity=str(user.id))
    return jsonify({
        'token': token,
        'user': {'id': user.id, 'name': user.name, 'email': user.email,
                 'monthly_income': user.monthly_income, 'currency': user.currency}
    })


@app.route('/api/auth/profile', methods=['GET', 'PUT'])
@jwt_required()
def profile():
    user_id = int(get_jwt_identity())
    user = User.query.get_or_404(user_id)

    if request.method == 'GET':
        return jsonify({'id': user.id, 'name': user.name, 'email': user.email,
                        'monthly_income': user.monthly_income, 'currency': user.currency,
                        'created_at': user.created_at.isoformat()})

    data = request.get_json()
    if 'name' in data:
        user.name = data['name'].strip()
    if 'monthly_income' in data:
        user.monthly_income = float(data['monthly_income'])
    if 'currency' in data:
        user.currency = data['currency']
    if 'password' in data and data['password']:
        user.password_hash = generate_password_hash(data['password'])
    db.session.commit()
    return jsonify({'message': 'Profile updated successfully'})

# ─── Expense Routes ───────────────────────────────────────────────────────────
CATEGORIES = ['Food', 'Rent', 'Travel', 'Shopping', 'Bills', 'Health', 'Entertainment', 'Education', 'Other']

@app.route('/api/expenses', methods=['GET', 'POST'])
@jwt_required()
def expenses():
    user_id = int(get_jwt_identity())

    if request.method == 'POST':
        data = request.get_json()
        if not all(k in data for k in ['date', 'category', 'amount']):
            return jsonify({'error': 'Missing required fields'}), 400

        expense = Expense(
            user_id=user_id,
            date=data['date'],
            category=data['category'],
            amount=float(data['amount']),
            notes=data.get('notes', ''),
            is_recurring=bool(data.get('is_recurring', False)),
        )
        db.session.add(expense)
        db.session.commit()

        # Check budget alert (if email notifications enabled for user - assuming based on env var)
        try:
            check_and_send_budget_alert(user_id, data['category'], expense)
        except Exception as e:
            print(f"Error checking/sending budget alert: {e}")

        return jsonify(expense.to_dict()), 201

    # GET - with optional filters
    query = Expense.query.filter_by(user_id=user_id)
    if category := request.args.get('category'):
        query = query.filter_by(category=category)
    if search := request.args.get('search'):
        query = query.filter(
            db.or_(Expense.notes.ilike(f'%{search}%'), Expense.category.ilike(f'%{search}%'))
        )
    start = request.args.get('start')
    end = request.args.get('end')
    if start:
        query = query.filter(Expense.date >= start)
    if end:
        query = query.filter(Expense.date <= end)

    expenses_list = query.order_by(Expense.date.desc()).all()
    return jsonify([e.to_dict() for e in expenses_list])


@app.route('/api/expenses/<int:expense_id>', methods=['PUT', 'DELETE'])
@jwt_required()
def expense_detail(expense_id):
    user_id = int(get_jwt_identity())
    expense = Expense.query.filter_by(id=expense_id, user_id=user_id).first_or_404()

    if request.method == 'DELETE':
        db.session.delete(expense)
        db.session.commit()
        return jsonify({'message': 'Deleted'})

    data = request.get_json()
    if 'date' in data:
        expense.date = data['date']
    if 'category' in data:
        expense.category = data['category']
    if 'amount' in data:
        expense.amount = float(data['amount'])
    if 'notes' in data:
        expense.notes = data['notes']
    if 'is_recurring' in data:
        expense.is_recurring = bool(data['is_recurring'])
    if 'recurring_day' in data:
        expense.recurring_day = int(data['recurring_day']) if data['recurring_day'] else None
    db.session.commit()
    return jsonify(expense.to_dict())

# ─── Recurring Expense Check ──────────────────────────────────────────────────
@app.route('/api/recurring/check', methods=['POST'])
@jwt_required()
def check_recurring():
    """Auto-create recurring expenses for the current month if not already created."""
    user_id = int(get_jwt_identity())
    today = date.today()
    current_month_prefix = today.strftime('%Y-%m')

    # Find all recurring templates
    recurring = Expense.query.filter_by(user_id=user_id, is_recurring=True).all()
    created = []

    for template in recurring:
        if not template.recurring_day:
            continue
        target_date = f"{current_month_prefix}-{template.recurring_day:02d}"
        # Check if already logged this month for this category+amount
        exists = Expense.query.filter_by(
            user_id=user_id,
            date=target_date,
            category=template.category,
            amount=template.amount
        ).filter(Expense.id != template.id).first()

        if not exists and today.day >= template.recurring_day:
            new_exp = Expense(
                user_id=user_id,
                date=target_date,
                category=template.category,
                amount=template.amount,
                notes=f"[Auto] {template.notes or template.category}",
                is_recurring=False
            )
            db.session.add(new_exp)
            created.append(new_exp.category)

    db.session.commit()
    return jsonify({'created': created, 'count': len(created)})

# ─── Analytics Routes ─────────────────────────────────────────────────────────
@app.route('/api/analytics/summary', methods=['GET'])
@jwt_required()
def analytics_summary():
    user_id = int(get_jwt_identity())
    user = User.query.get(user_id)
    expenses = Expense.query.filter_by(user_id=user_id).all()

    if not expenses:
        return jsonify({
            'total_spent': 0, 'savings': 0, 'savings_pct': 0,
            'by_category': {}, 'monthly_trend': [], 'prediction': None,
            'anomalies': [], 'insights': [], 'top_category': None
        })

    import pandas as pd
    df = pd.DataFrame([e.to_dict() for e in expenses])
    df['amount'] = df['amount'].astype(float)
    df['Date'] = pd.to_datetime(df['date'])
    df['Amount'] = df['amount']
    df['Category'] = df['category']

    total_spent = float(df['amount'].sum())
    income = user.monthly_income or 0
    savings = max(0, income - total_spent)
    savings_pct = (savings / income * 100) if income > 0 else 0

    by_category = df.groupby('category')['amount'].sum().to_dict()

    monthly = (
        df.set_index('Date')
        .resample('ME')['Amount']
        .sum()
        .reset_index()
    )
    monthly_trend = [
        {'month': row['Date'].strftime('%b %Y'), 'total': round(row['Amount'], 2)}
        for _, row in monthly.iterrows()
    ]

    prediction = predict_expenses(df)
    anomaly_df = detect_anomalies(df)
    anomalies = []
    if not anomaly_df.empty:
        anomalies = anomaly_df[['date', 'category', 'amount', 'notes']].to_dict('records')

    insights = get_spending_insights(df, income)
    top_category = max(by_category, key=by_category.get) if by_category else None

    return jsonify({
        'total_spent': round(total_spent, 2),
        'savings': round(savings, 2),
        'savings_pct': round(savings_pct, 1),
        'by_category': {k: round(v, 2) for k, v in by_category.items()},
        'monthly_trend': monthly_trend,
        'prediction': prediction,
        'anomalies': anomalies,
        'insights': insights,
        'top_category': top_category
    })


@app.route('/api/analytics/weekly', methods=['GET'])
@jwt_required()
def analytics_weekly():
    user_id = int(get_jwt_identity())
    expenses = Expense.query.filter_by(user_id=user_id).all()
    if not expenses:
        return jsonify([])

    import pandas as pd
    df = pd.DataFrame([e.to_dict() for e in expenses])
    df['Date'] = pd.to_datetime(df['date'])
    df['amount'] = df['amount'].astype(float)
    df['day'] = df['Date'].dt.day_name()

    day_order = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
    weekly = df.groupby('day')['amount'].sum().reindex(day_order, fill_value=0)
    return jsonify({'labels': list(weekly.index), 'values': [round(v, 2) for v in weekly.values]})


@app.route('/api/analytics/heatmap', methods=['GET'])
@jwt_required()
def analytics_heatmap():
    """Returns day-of-month spending totals for the current or specified month."""
    user_id = int(get_jwt_identity())
    month_str = request.args.get('month', date.today().strftime('%Y-%m'))

    expenses = Expense.query.filter(
        Expense.user_id == user_id,
        Expense.date.like(f'{month_str}%')
    ).all()

    heatmap = {i: 0.0 for i in range(1, 32)}
    for e in expenses:
        try:
            day = int(e.date.split('-')[2])
            heatmap[day] = round(heatmap[day] + e.amount, 2)
        except Exception:
            pass

    return jsonify({'month': month_str, 'data': heatmap})

# ─── Email Notifications ──────────────────────────────────────────────────────
def send_email(to_email, subject, html_content):
    """Helper to send an email using SMTP credentials from env."""
    smtp_server = os.environ.get('SMTP_SERVER')
    smtp_port = os.environ.get('SMTP_PORT', 587)
    smtp_user = os.environ.get('SMTP_USERNAME')
    smtp_pass = os.environ.get('SMTP_PASSWORD')

    if not all([smtp_server, smtp_user, smtp_pass]):
        print("SMTP credentials not configured. Skipping email.")
        return False

    msg = MIMEMultipart('alternative')
    msg['Subject'] = subject
    msg['From'] = f"Spendly Alerts <{smtp_user}>"
    msg['To'] = to_email

    msg.attach(MIMEText(html_content, 'html'))

    try:
        server = smtplib.SMTP(smtp_server, int(smtp_port))
        server.starttls()
        server.login(smtp_user, smtp_pass)
        server.sendmail(smtp_user, to_email, msg.as_string())
        server.quit()
        return True
    except Exception as e:
        print(f"Failed to send email: {e}")
        return False

def check_and_send_budget_alert(user_id, category, new_expense):
    """Check if the new expense pushes the category budget over 80% or 100% and email."""
    user = User.query.get(user_id)
    budget = Budget.query.filter_by(user_id=user_id, category=category).first()
    if not budget:
        return

    current_month = date.today().strftime('%Y-%m')
    expenses_this_month = Expense.query.filter(
        Expense.user_id == user_id,
        Expense.category == category,
        Expense.date.like(f'{current_month}%')
    ).all()
    
    total_spent = sum(e.amount for e in expenses_this_month)
    spent_before = total_spent - new_expense.amount
    
    limit = budget.limit_amount
    pct_now = (total_spent / limit) * 100
    pct_before = (spent_before / limit) * 100

    sym = {'INR': '₹', 'USD': '$', 'EUR': '€', 'GBP': '£'}.get(user.currency, '₹')

    # Trigger threshold logic
    threshold = None
    if pct_now >= 100 and pct_before < 100:
        threshold = "100%"
        status_color = "#ef4444" # red
        title = f"🚨 Budget Exceeded for {category}"
    elif pct_now >= 80 and pct_before < 80:
        threshold = "80%"
        status_color = "#f59e0b" # yellow
        title = f"⚠️ Budget Alert for {category} (80% used)"

    if threshold:
        html = f"""
        <div style="font-family: sans-serif; padding: 20px; color: #333;">
            <h2 style="color: {status_color};">{title}</h2>
            <p>Hi {user.name},</p>
            <p>Your recent expense of <strong>{sym}{new_expense.amount:,.2f}</strong> on <strong>{category}</strong> 
               has pushed your monthly spending to <strong>{sym}{total_spent:,.2f}</strong>.</p>
            <p>This means you have reached <strong>{pct_now:.1f}%</strong> of your {sym}{limit:,.2f} budget for {category}.</p>
            <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
            <p style="font-size: 12px; color: #999;">You received this because email notifications are enabled in your Spendly app.</p>
        </div>
        """
        send_email(user.email, title, html)

@app.route('/api/settings/test-email', methods=['POST'])
@jwt_required()
def test_email():
    """Endpoint to send a test email to the current user."""
    user_id = int(get_jwt_identity())
    user = User.query.get(user_id)
    
    html = f"""
    <div style="font-family: sans-serif; padding: 20px; color: #333;">
        <h2 style="color: #6366f1;">Test Email from Spendly 📬</h2>
        <p>Hi {user.name},</p>
        <p>If you're reading this, your email notification configuration is working perfectly!</p>
        <p>You will now receive automatic email alerts when your category budgets cross 80% or 100%.</p>
    </div>
    """
    success = send_email(user.email, "Spendly Test Email", html)
    
    if success:
        return jsonify({"message": "Test email sent successfully"}), 200
    return jsonify({"error": "Failed to send email. Check SMTP credentials in .env and server logs."}), 500

# ─── Budget Routes ─────────────────────────────────────────────────────────────
@app.route('/api/budgets', methods=['GET', 'POST'])
@jwt_required()
def budgets():
    user_id = int(get_jwt_identity())

    if request.method == 'POST':
        data = request.get_json()
        existing = Budget.query.filter_by(user_id=user_id, category=data['category']).first()
        if existing:
            existing.limit_amount = float(data['limit_amount'])
        else:
            budget = Budget(user_id=user_id, category=data['category'],
                            limit_amount=float(data['limit_amount']))
            db.session.add(budget)
        db.session.commit()
        return jsonify({'message': 'Budget saved'})

    budgets_list = Budget.query.filter_by(user_id=user_id).all()

    current_month = date.today().strftime('%Y-%m')
    expenses = Expense.query.filter(
        Expense.user_id == user_id,
        Expense.date.like(f'{current_month}%')
    ).all()

    spent_by_cat = {}
    for e in expenses:
        spent_by_cat[e.category] = spent_by_cat.get(e.category, 0) + e.amount

    result = []
    for b in budgets_list:
        spent = spent_by_cat.get(b.category, 0)
        result.append({
            **b.to_dict(),
            'spent': round(spent, 2),
            'percentage': round((spent / b.limit_amount * 100) if b.limit_amount > 0 else 0, 1)
        })

    return jsonify(result)


@app.route('/api/budgets/<int:budget_id>', methods=['DELETE'])
@jwt_required()
def delete_budget(budget_id):
    user_id = int(get_jwt_identity())
    budget = Budget.query.filter_by(id=budget_id, user_id=user_id).first_or_404()
    db.session.delete(budget)
    db.session.commit()
    return jsonify({'message': 'Deleted'})


@app.route('/api/categories', methods=['GET'])
def get_categories():
    return jsonify(CATEGORIES)

# ─── Goal Routes ──────────────────────────────────────────────────────────────
@app.route('/api/goals', methods=['GET', 'POST'])
@jwt_required()
def goals():
    user_id = int(get_jwt_identity())

    if request.method == 'POST':
        data = request.get_json()
        if not data.get('name') or not data.get('target_amount'):
            return jsonify({'error': 'Name and target amount are required'}), 400
        goal = Goal(
            user_id=user_id,
            name=data['name'].strip(),
            target_amount=float(data['target_amount']),
            saved_amount=float(data.get('saved_amount', 0)),
            deadline=data.get('deadline'),
            emoji=data.get('emoji', '🎯')
        )
        db.session.add(goal)
        db.session.commit()
        return jsonify(goal.to_dict()), 201

    goals_list = Goal.query.filter_by(user_id=user_id).order_by(Goal.created_at.desc()).all()
    return jsonify([g.to_dict() for g in goals_list])


@app.route('/api/goals/<int:goal_id>', methods=['PUT', 'DELETE'])
@jwt_required()
def goal_detail(goal_id):
    user_id = int(get_jwt_identity())
    goal = Goal.query.filter_by(id=goal_id, user_id=user_id).first_or_404()

    if request.method == 'DELETE':
        db.session.delete(goal)
        db.session.commit()
        return jsonify({'message': 'Deleted'})

    data = request.get_json()
    if 'name' in data:
        goal.name = data['name'].strip()
    if 'target_amount' in data:
        goal.target_amount = float(data['target_amount'])
    if 'saved_amount' in data:
        goal.saved_amount = float(data['saved_amount'])
    if 'deadline' in data:
        goal.deadline = data['deadline']
    if 'emoji' in data:
        goal.emoji = data['emoji']
    db.session.commit()
    return jsonify(goal.to_dict())

# ─── Export Routes ────────────────────────────────────────────────────────────
@app.route('/api/export/csv', methods=['GET'])
@jwt_required()
def export_csv():
    user_id = int(get_jwt_identity())
    expenses = Expense.query.filter_by(user_id=user_id).order_by(Expense.date.desc()).all()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(['Date', 'Category', 'Amount', 'Notes', 'Recurring'])
    for e in expenses:
        writer.writerow([e.date, e.category, e.amount, e.notes or '', 'Yes' if e.is_recurring else 'No'])

    output.seek(0)
    filename = f"spendly_export_{date.today().isoformat()}.csv"
    return Response(
        output.getvalue(),
        mimetype='text/csv',
        headers={'Content-Disposition': f'attachment; filename={filename}'}
    )


@app.route('/api/export/pdf', methods=['GET'])
@jwt_required()
def export_pdf():
    user_id = int(get_jwt_identity())
    user = User.query.get(user_id)
    expenses = Expense.query.filter_by(user_id=user_id).order_by(Expense.date.desc()).all()

    try:
        from reportlab.lib.pagesizes import A4
        from reportlab.lib import colors
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
        from reportlab.lib.units import cm
        from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
        from reportlab.lib.enums import TA_CENTER

        buf = io.BytesIO()
        doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=2*cm, rightMargin=2*cm,
                                 topMargin=2*cm, bottomMargin=2*cm)
        styles = getSampleStyleSheet()
        story = []

        # Title
        title_style = ParagraphStyle('title', parent=styles['Title'],
                                      fontSize=22, textColor=colors.HexColor('#7c3aed'),
                                      alignment=TA_CENTER)
        story.append(Paragraph('💸 Spendly — Expense Report', title_style))
        story.append(Spacer(1, 0.3*cm))
        story.append(Paragraph(f'<font size="10" color="#64748b">Generated for {user.name} | {date.today().strftime("%d %b %Y")}</font>',
                               ParagraphStyle('sub', parent=styles['Normal'], alignment=TA_CENTER)))
        story.append(Spacer(1, 0.6*cm))

        # Summary
        total = sum(e.amount for e in expenses)
        income = user.monthly_income or 0
        savings = max(0, income - total)
        sym = {'INR': '₹', 'USD': '$', 'EUR': '€', 'GBP': '£'}.get(user.currency, '₹')

        summary_data = [
            ['Total Expenses', 'Monthly Income', 'Savings'],
            [f'{sym}{total:,.2f}', f'{sym}{income:,.2f}', f'{sym}{savings:,.2f}']
        ]
        summary_table = Table(summary_data, colWidths=[5.5*cm, 5.5*cm, 5.5*cm])
        summary_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#7c3aed')),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, 0), 11),
            ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
            ('FONTNAME', (0, 1), (-1, 1), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 1), (-1, 1), 13),
            ('BACKGROUND', (0, 1), (-1, 1), colors.HexColor('#f5f3ff')),
            ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.HexColor('#f5f3ff')]),
            ('BOX', (0, 0), (-1, -1), 1, colors.HexColor('#7c3aed')),
            ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#e2e8f0')),
            ('TOPPADDING', (0, 0), (-1, -1), 8),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
        ]))
        story.append(summary_table)
        story.append(Spacer(1, 0.6*cm))

        # Expense Table
        story.append(Paragraph('<b>Transaction Details</b>', styles['Heading2']))
        story.append(Spacer(1, 0.3*cm))

        table_data = [['Date', 'Category', 'Notes', 'Amount']]
        for e in expenses:
            table_data.append([
                e.date, e.category, (e.notes or '—')[:40],
                f'{sym}{e.amount:,.2f}'
            ])

        col_widths = [3*cm, 3.5*cm, 8*cm, 3*cm]
        exp_table = Table(table_data, colWidths=col_widths, repeatRows=1)
        exp_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#1e293b')),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, -1), 9),
            ('ALIGN', (3, 0), (3, -1), 'RIGHT'),
            ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#f8fafc')]),
            ('GRID', (0, 0), (-1, -1), 0.3, colors.HexColor('#e2e8f0')),
            ('TOPPADDING', (0, 0), (-1, -1), 5),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
            ('LEFTPADDING', (0, 0), (-1, -1), 6),
        ]))
        story.append(exp_table)

        doc.build(story)
        buf.seek(0)
        filename = f"spendly_report_{date.today().isoformat()}.pdf"
        return Response(
            buf.getvalue(),
            mimetype='application/pdf',
            headers={'Content-Disposition': f'attachment; filename={filename}'}
        )
    except Exception as ex:
        return jsonify({'error': f'PDF generation failed: {str(ex)}'}), 500

# ─── FX Rates Proxy ───────────────────────────────────────────────────────────
@app.route('/api/fx/rates', methods=['GET'])
def fx_rates():
    """Proxy free exchange rate API to avoid CORS issues. No API key required."""
    try:
        base = request.args.get('base', 'USD')
        r = req_lib.get(f'https://open.er-api.com/v6/latest/{base}', timeout=5)
        data = r.json()
        return jsonify({'base': base, 'rates': data.get('rates', {})})
    except Exception:
        # Fallback static rates relative to USD if API is down
        fallback = {'USD': 1, 'INR': 83.5, 'EUR': 0.93, 'GBP': 0.79}
        return jsonify({'base': 'USD', 'rates': fallback})

# ─── AI Chat ──────────────────────────────────────────────────────────────────
@app.route('/api/chat', methods=['POST'])
@jwt_required()
def ai_chat():
    user_id = int(get_jwt_identity())
    user = User.query.get(user_id)
    data = request.get_json()
    message = data.get('message', '').strip()
    if not message:
        return jsonify({'error': 'Empty message'}), 400

    # Build financial context
    expenses = Expense.query.filter_by(user_id=user_id).order_by(Expense.date.desc()).limit(100).all()
    sym = {'INR': '₹', 'USD': '$', 'EUR': '€', 'GBP': '£'}.get(user.currency, '₹')

    by_cat = {}
    total = 0
    for e in expenses:
        by_cat[e.category] = by_cat.get(e.category, 0) + e.amount
        total += e.amount

    cat_summary = ', '.join([f"{k}: {sym}{v:,.0f}" for k, v in sorted(by_cat.items(), key=lambda x: -x[1])])
    month_expenses = [e for e in expenses if e.date.startswith(date.today().strftime('%Y-%m'))]
    month_total = sum(e.amount for e in month_expenses)

    context = (
        f"User: {user.name}, Currency: {user.currency}, Monthly Income: {sym}{user.monthly_income:,.0f}. "
        f"Total all-time expenses: {sym}{total:,.0f}. "
        f"This month's spending: {sym}{month_total:,.0f}. "
        f"Spending by category: {cat_summary}. "
        f"Recent transactions (last 5): " +
        ', '.join([f"{e.date} {e.category} {sym}{e.amount:,.0f}" for e in expenses[:5]]) + "."
    )

    groq_key = os.environ.get('GROQ_API_KEY')
    if groq_key:
        try:
            from groq import Groq
            client = Groq(api_key=groq_key)
            completion = client.chat.completions.create(
                model='llama-3.3-70b-versatile',
                messages=[
                    {'role': 'system', 'content': (
                        'You are Spendly AI, a friendly and concise personal finance assistant. '
                        'Answer the user\'s question based on their financial data. '
                        'Be helpful, specific, and keep responses under 3 sentences. '
                        f'Financial context: {context}'
                    )},
                    {'role': 'user', 'content': message}
                ],
                max_tokens=200
            )
            reply = completion.choices[0].message.content
            return jsonify({'reply': reply})
        except Exception as ex:
            pass  # Fall through to rule-based

    # Rule-based fallback (no API key needed)
    msg_lower = message.lower()
    if any(w in msg_lower for w in ['total', 'spent', 'spend', 'much']):
        reply = f"You've spent {sym}{total:,.0f} total, with {sym}{month_total:,.0f} this month."
    elif any(w in msg_lower for w in ['top', 'most', 'highest', 'biggest']):
        if by_cat:
            top = max(by_cat, key=by_cat.get)
            reply = f"Your highest spending category is {top} at {sym}{by_cat[top]:,.0f}."
        else:
            reply = "No expenses recorded yet. Add your first expense to get started!"
    elif any(w in msg_lower for w in ['sav', 'saving']):
        savings = max(0, user.monthly_income - month_total) if user.monthly_income else 0
        pct = (savings / user.monthly_income * 100) if user.monthly_income else 0
        reply = f"Your estimated savings this month are {sym}{savings:,.0f} ({pct:.0f}% of income)."
    elif any(w in msg_lower for w in ['food', 'rent', 'travel', 'shopping', 'bills', 'health', 'entertainment', 'education']):
        cat = next((c for c in CATEGORIES if c.lower() in msg_lower), None)
        if cat and cat in by_cat:
            reply = f"You've spent {sym}{by_cat[cat]:,.0f} on {cat} in total."
        else:
            reply = f"No spending recorded for that category yet."
    elif any(w in msg_lower for w in ['income', 'earn', 'salary']):
        reply = f"Your monthly income is set to {sym}{user.monthly_income:,.0f}. You can update this in Settings."
    elif any(w in msg_lower for w in ['tip', 'advice', 'suggest', 'help', 'improve']):
        if by_cat:
            top = max(by_cat, key=by_cat.get)
            reply = f"Your top spending is {top}. Consider setting a budget for it in the Budgets section to stay on track!"
        else:
            reply = "Start by logging your expenses. Then set category budgets to track your spending better!"
    else:
        reply = (
            f"I can help you analyze your finances! You've spent {sym}{total:,.0f} total "
            f"across {len(by_cat)} categories. Ask me about your top categories, savings, or specific spending!"
        )

    return jsonify({'reply': reply})

# ─── Static Frontend ──────────────────────────────────────────────────────────
@app.route('/')
@app.route('/<path:path>')
def serve_frontend(path=''):
    if path and os.path.exists(os.path.join(STATIC_DIR, path)):
        return send_from_directory(STATIC_DIR, path)
    return send_from_directory(STATIC_DIR, 'index.html')

# ─── Init ─────────────────────────────────────────────────────────────────────
def run_migrations():
    """Add new columns to existing tables if they don't exist."""
    import sqlite3
    db_path = os.path.join(BASE_DIR, 'data', 'expenses.db')
    if not os.path.exists(db_path):
        return  # Fresh DB — create_all will handle it
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()

    # Check existing columns on expense table
    cur.execute("PRAGMA table_info(expense)")
    expense_cols = {row[1] for row in cur.fetchall()}

    migrations = [
        ("expense", "is_recurring", "INTEGER NOT NULL DEFAULT 0"),
        ("expense", "recurring_day", "INTEGER"),
    ]
    for table, col, col_def in migrations:
        if col not in expense_cols:
            try:
                cur.execute(f"ALTER TABLE {table} ADD COLUMN {col} {col_def}")
                print(f"✅ Migration: added {table}.{col}")
            except Exception as e:
                print(f"⚠️  Migration skipped ({table}.{col}): {e}")

    conn.commit()
    conn.close()

def init_db():
    os.makedirs(os.path.join(BASE_DIR, 'data'), exist_ok=True)
    run_migrations()   # Run before create_all so new tables get created cleanly
    with app.app_context():
        db.create_all()

if __name__ == '__main__':
    init_db()
    port = int(os.environ.get('PORT', 8080))
    app.run(debug=True, host='127.0.0.1', port=port)